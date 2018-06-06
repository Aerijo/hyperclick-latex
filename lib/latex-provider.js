const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { escapeRegExp } = require("lodash");
const { Range, Emitter, CompositeDisposable } = require("atom");

const { getRootFilePath, UniqueDocumentTree, DocumentTree } = require("./document-parser");
const { isFilePath, isPackageOrClass, isEnvDelim, isRef, getBraceContents } = require("./context-helpers");
const { openClickedFile, selectMatchingEnvDelims } = require("../lib2/utilities");

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

  console.log(emitter);

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
      openFile(path, editor)
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

function openFile(filePath, editor) {
  return openClickedFile(filePath,
    {
      filePath: editor.getPath(),
      currentDir: editor.getDirectoryPath(),
      jumpToInputCommand: false,
      setRoot: false,
      editor,
    }
  );
}

function openFileClicked(filePath, editor, parentCommand) {
  return openClickedFile(filePath,
    {
      filePath: editor.getPath(),
      currentDir: editor.getDirectoryPath(),
      parentCommand,
      jumpToInputCommand: true,
      setRoot: true,
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

function getWordFromLineIndex(line, index) {
  let word = "";
  let wordStartIndex = /[\w@_\-]*$/.exec(line.slice(0, index + 1)).index; // index+1 to include the clicked character as well
  let wordEndIndex = /^([\w@_\-]*)/.exec(line.slice(index))[1].length + index;
  word = line.slice(wordStartIndex, wordEndIndex);
  return { word, wordStartIndex, wordEndIndex };
}

function getBraceContentsFromLineIndex(line, index) {
  let braceContents = "";
  let braceStartIndex = /[^\{]*$/.exec(line.slice(0, index + 1)).index; // index+1 to include the clicked character as well
  let braceEndIndex = /^([^\}]*)/.exec(line.slice(index))[1].length + index;
  braceContents = line.slice(braceStartIndex, braceEndIndex);
  return { braceContents, braceStartIndex, braceEndIndex };
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

      envDelimType = isEnvDelim(editor, point, context);
      if (envDelimType !== false) {
        return {
          range: braceContents.range,
          callback() { selectMatchingEnvDelims(editor, point, context, envDelimType); }
        };
      }

      refCommand = isRef(editor, point, context);
      if (refCommand !== false) {
        return {
          range: braceContents.range,
          callback() { gotoLabelDefinition(editor, point, braceContents, emitter); }
        };
      }

      if (isPackageOrClass(editor, point, context)) {
        return {
          range: braceContents.range,
          callback() { openTexdocDocumentation(braceContents.value, emitter); }
        };
      }

    } else {
      // if not in braces, we could try checking the scopes from the grammar
      // check if file path (for !TeX root directive)
    }
  }
};




//
// let lineNum   = point.row;
// let lineIndex = point.column;
// let line      = editor.lineTextForBufferRow(lineNum);
//
// // let currentChar = line.charAt(lineIndex); // for debugging where the click is registered
// // console.log(currentChar);                 // the precise position is a little sketchy
//
// let lineStart = "";
// let wordRange;
//
// let word = getWordFromLineIndex(line, lineIndex);
// if (word) {
//   lineStart = line.slice(0, word.wordStartIndex);
//   wordRange = new Range([lineNum, word.wordStartIndex], [lineNum, word.wordEndIndex]);
// }
//
// let braceStart = "";
// let braceRange;
//
// let braceContents = getBraceContentsFromLineIndex(line, lineIndex);
// if (braceContents) {
//   braceStart = line.slice(0, braceContents.braceStartIndex);
//   braceRange = new Range([lineNum, word.braceStartIndex], [lineNum, word.braceEndIndex]);
// }
//
// if (braceContents.braceContents.length > 0 && isEnvDelim(lineStart)) {
//   return {
//     range: wordRange,
//     callback() { selectMatchingEnvDelims(editor, point, braceContents, wordRange); }
//     // callback() { gotoMatchingEnvDelim(editor, point, braceContents); }
//   };
// }
//
// let ref = isRef(line, lineIndex);
// if (ref) {
//   return {
//     range: new Range([lineNum, ref.refStartIndex], [lineNum, ref.refEndIndex]),
//     callback() { gotoLabelDefinition(editor, point, ref); }
//   };
// }
//
// let filePath = isFilePath(line, lineIndex);
// if (filePath) {
//   return {
//     range: new Range([lineNum, filePath.fileStartIndex], [lineNum, filePath.fileEndIndex]),
//     callback() { openFileClicked(filePath.path, editor, filePath.parentCommand); }
//   };
// }
//
// if (word.word.length > 0 && (isPackageOrClass(editor, point, lineStart))) {
//   return {
//     range: wordRange,
//     callback() { openTexdocDocumentation(word.word); }
//   };
// }
