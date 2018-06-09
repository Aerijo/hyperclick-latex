const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { escapeRegExp } = require("lodash");
const { Range, Emitter, CompositeDisposable } = require("atom");

const { getRootFilePath, UniqueDocumentTree, DocumentTree } = require("./document-parser");
const { isFilePath, isPackageOrClass, isEnvDelim, isRef, isCitation, getBraceContents } = require("./context-helpers");
const { openFileTextEditor, selectMatchingEnvDelims } = require("../lib2/utilities");

const thresholdLineLength = 100;


function gotoLabelDefinition(editor, point, braceContents, emitter) {
  let refID = braceContents.value;
  // first it does a cursory search of the current file, getting into more complicated behaviour if it fails.
  let searchTerm = new RegExp(`\\\\label\\{${escapeRegExp(refID)}\\}`);
  let scanRange = new Range([0, 0], point);
  let matchFound = false;
  editor.scan(searchTerm, scanRange, ({match, range, stop}) => {
    editor.setCursorBufferPosition(range.end);
    matchFound = true;
    stop();
  });

  if (matchFound) { return; }

  // if not found, we initiate a document tree of unique file paths.
  // the following disposables look for events emitted from the tree, which can be expected after running tree.findMatch()
  let documentTree = new UniqueDocumentTree(getRootFilePath(editor));
  let disposables = new CompositeDisposable();
  disposables.add(
    documentTree.emitter.on("begin-tree-search", () => {
      emitter.emit("begin-tree-search", refID);
    }),
    documentTree.emitter.on("finishedWithoutSuccess", () => {
      atom.notifications.addWarning(`Label declaration for reference \`${refID}\` not found`, {dismissable: true});
      emitter.emit("end-tree-search", refID);
      disposables.dispose();
    }),
    documentTree.emitter.on("endPatternInPath", (path) => {
      emitter.emit("end-tree-search", refID);
      openLocatedFile(path, editor)
      .then((editor) => {
        editor.scan(searchTerm, ({ range, stop }) => {
          editor.setCursorBufferPosition(range.end);
          stop();
        });
      });
      disposables.dispose();
    })
  );

  documentTree.findMatch(searchTerm);
}

function gotoCitation(editor, point, braceContents, emitter) {
  return;
}

function openTexdocDocumentation(packageName, emitter) {
  if (!packageName.match(/[\w@_\-]+/)) {
    atom.notifications.addWarning(`Package name \`${packageName}\` is invalid`, { dismissable: true });
    return;
  }

  if (typeof emmitter !== "undefined") {
    emitter.emit("begin-open-docs", packageName);
  }

  let child = child_process.spawn("texdoc", [packageName]);
  child.stdout.setEncoding("utf-8");

  child.stdout.on('data', (data) => {
    atom.notifications.addInfo("`texdoc` says:", {description: data, dismissable: true});
  });

  child.on('close', (code, signal) => {
    if (code !== 0) { console.error(`texdoc exited with nonzero code ${code}`); }

    if (typeof emmitter !== "undefined") {
      emitter.emit("end-open-docs", packageName);
    }
  });
}

function openLocatedFile(filePath, editor) {
  return openFileTextEditor(filePath,
    {
      filePath: editor.getPath(),
      currentDir: editor.getDirectoryPath(),
      jumpToInputCommand: false,
      setRoot: false,
      editor,
    }
  );
}

function openClickedFile(fileInfo, editor) {
  let isTexFile = /^(input|include|includeonly)$/.test(fileInfo.command);
  return openFileTextEditor(fileInfo.path,
    {
      filePath: editor.getPath(),
      currentDir: editor.getDirectoryPath(),
      parentCommand: fileInfo.command,
      jumpToInputCommand: isTexFile,
      setRoot: isTexFile,
      makeFile: isTexFile,
      editor,
      getRootPath
    }
  );
}

function getRootPath(relTo, editor, newFilePath) {
  let newFileFolder = path.dirname(newFilePath);
  let relPath;

  if (relTo === "Project root") {
    let projectRootFile = getRootFilePath(editor);
    relPath = path.relative(newFileFolder, projectRootFile);
  } else {
    let callingFilePath = editor.getPath();
    relPath = path.relative(newFileFolder, callingFilePath);
  }

  if (path.dirname(relPath) === ".") {
    relPath = "./" + relPath;
  }

  return relPath;
}


module.exports = {
  priority: 1,
  grammarScopes: [ 'text.tex.latex', 'text.tex.latex.tikz' ],

  emitter: new Emitter(),

  getSuggestion(editor, point) {
    /**
    * We look for:
    *  - Environment delimiter -> select it and it's pair
    *  - Reference             -> go to label
    *  - Citation              -> open in .bib file
    *  - Package name          -> open texdoc docs
    *  - File path             -> open file / make in needed
    *  - Section               -> Fold / unfold that section
    */

    let emitter = this.emitter;
    let context = {
      editor,
      point,
      line: editor.lineTextForBufferRow(point.row),
      index: point.column,
      scopes: editor.scopeDescriptorForBufferPosition(point).getScopesArray()
    };

    let braceContents = getBraceContents(editor, point, context);
    if (braceContents !== null) {
      context.braceContents = braceContents;
      context.startIndex = braceContents.range.start.column;
      context.range = braceContents.range;
      context.value = braceContents.value;

      let envDelimType = isEnvDelim(editor, point, context);
      if (envDelimType !== false) {
        return {
          range: braceContents.range,
          callback() { selectMatchingEnvDelims(editor, point, context, envDelimType); }
        };
      }

      let refCommand = isRef(editor, point, context);
      if (refCommand !== false) {
        return {
          range: braceContents.range,
          callback() { gotoLabelDefinition(editor, point, braceContents, emitter); }
        };
      }

      let citeCommand = isCitation(editor, point, context);
      if (citeCommand !== false) {
        return {
          range: braceContents.range,
          callback() { gotoCitation(editor, point, braceContents, emitter); }
        };
      }

      if (isPackageOrClass(editor, point, context)) {
        return {
          range: braceContents.range,
          callback() { openTexdocDocumentation(braceContents.value, emitter); }
        };
      }

      let filePathInfo = isFilePath(editor, point, context);
      if (filePathInfo !== false) {
        return {
          range: filePathInfo.range,
          callback() { openClickedFile(filePathInfo, editor); }
        };
      }

    } else {
      // if not in braces, we could try checking the scopes from the grammar
      // check if file path (for !TeX root directive)
    }
  }
};
