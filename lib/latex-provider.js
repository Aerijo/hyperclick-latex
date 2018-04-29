const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { escapeRegExp } = require("lodash");
const { Range, Emitter, CompositeDisposable } = require("atom");
const { isFilePath, getRootFilePath, UniqueDocumentTree, DocumentTree } = require("./document-parser");

const thresholdLineLength = 100;

const emitter = new Emitter();

function isPackageOrClass(editor, point, lineStart) {
  // if (lineStart.length > )
  if (lineStart.match(/\\(?:usepackage|documentclass)\s*(?:\[.*?\])?\{$/)) {
    return true;
  }

  // If the simple check doesn't work, try with scope (provided by grammar package) support.
  // will not work (or will lead to strange results) if the package does not follow `language-latex` conventions
  let scopes = editor.scopeDescriptorForBufferPosition(point).getScopesArray();
  let includes = scopes.includes("support.class.latex", 1); // first index is always root scope, so skip it
  return includes;
}

function isEnvDelim(lineStart) {
  return lineStart.match(/\\(?:begin|end)\s*\{$/);
}

function gotoMatchingEnvDelim(editor, point, braceContents) { // word is an object with prop. word, wordStartIndex & wordEndIndex
  let nestCount = 0;
  let line = editor.lineTextForBufferRow(point.row);

  let sanBraceContents = escapeRegExp(braceContents.braceContents); // sanitize (escape) special characters

  let searchTerm = new RegExp(`\\\\(begin|end)\\s*\\{${sanBraceContents}\\}`, "g");
  let match = line.slice(0, braceContents.braceStartIndex).match(/\\(begin|end)\s*\{$/);

  let matchFound = false;
  if (match[1] === "begin") { // we search down
    let finalPoint = editor.getBuffer().getEndPosition();
    let scanRange = new Range(point, finalPoint);
    editor.scanInBufferRange(searchTerm, scanRange, ({match, range, stop}) => {
      if (match[1] === "begin") {
        nestCount += 1;
      } else if (match[1] === "end") {
        if (nestCount > 0) { nestCount -= 1; return; }
        editor.setCursorBufferPosition(range.end);
        matchFound = true;
        stop();
      }
    });

    if (!matchFound) { atom.notifications.addWarning(`Closing delimiter for environment \`${braceContents.braceContents}\` not found`); }
    return;

  } else if (match[1] === "end") { // we search up
    let scanRange = new Range([0,0], point);
    editor.backwardsScanInBufferRange(searchTerm, scanRange, ({match, range, stop}) => {
      if (match[1] === "end") {
        nestCount += 1;
      } else if (match[1] === "begin") {
        if (nestCount > 0) { nestCount -= 1; return; }
        editor.setCursorBufferPosition(range.end);
        matchFound = true;
        stop();
      }
    });

    if (!matchFound) { atom.notifications.addWarning(`Opening delimiter for environment \`${braceContents.braceContents}\` not found`); }
    return;

  } else {
    return;
  }
}

function isRef(line, lineIndex) {
  let startRef = line.slice(0, lineIndex).match(/\\(?:auto|name|page|eq|cpage|c|labelc)?ref(?:\*)?\{([^\}]*)$/i);
  if (!startRef) { return false; }

  let endRef = line.slice(lineIndex).match(/^(.*?)\}/);
  if (!endRef) { return false; }
  let refStartIndex = startRef.index + startRef[0].match("{").index + 1;
  let refEndIndex = endRef[0].match("}").index + lineIndex;

  // console.log(refStartIndex, refEndIndex, line.slice(refStartIndex, refEndIndex), line);

  return {
    value: startRef[1] + endRef[1],
    refStartIndex,
    refEndIndex
  };
}

function gotoLabelDefinition(editor, point, ref) {

  // first it does a cursory search of the current file, getting into more complicated behaviour if it fails.
  let searchTerm = new RegExp(`\\\\label\\{${escapeRegExp(ref.value)}\\}`);
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
      emitter.emit("begin-tree-search", ref.value);
    }),
    documentTree.emitter.on("finishedWithoutSuccess", () => {
      atom.notifications.addWarning(`Label declaration for reference \`${ref.value}\` not found`, {dismissable: true});
      emitter.emit("end-tree-search", ref.value);
      disposables.dispose();
    }),
    documentTree.emitter.on("endPatternInPath", (path) => {
      openFile(path, editor).then((editor) => {
        editor.scan(searchTerm, ({ range, stop }) => {
          editor.setCursorBufferPosition(range.end);
          emitter.emit("end-tree-search", ref.value);
          stop();
        });
      });
      disposables.dispose();
    })
  );

  documentTree.findMatch(searchTerm);
}

function openTexdocDocumentation(packageName) {
  if (!packageName.match(/[\w@_\-]+/)) {
    atom.notifications.addWarning(`Package name \`${packageName}\` is invalid`);
    return;
  }

  emitter.emit("begin-open-docs", packageName);

  let child = child_process.spawn("texdoc", [packageName]);
  child.stdout.setEncoding("utf-8");
  child.stdout.on('data', (data) => {
    atom.notifications.addInfo("`texdoc` says:", {description: data, dismissable: true});
  });
  child.on('close', (code, signal) => {
    if (code !== 0) { console.log(`texdoc exited with nonzero code ${code}`); }

    emitter.emit("end-open-docs", packageName);
  });
}

function openFile(filePath, editor, parentCommand) {
  let currentDir = path.dirname(editor.getPath());
  let targetFile = path.resolve(currentDir, filePath.trim());
  if (!fs.existsSync(targetFile) && !path.extname(targetFile)) {// if the file without an extension doesn't exist, try and guess
    if (parentCommand && parentCommand.match("bib")) {
      targetFile += ".bib";
    } else {
      targetFile += ".tex";
    }
  }

  if (!fs.existsSync(targetFile)) {
    var notif = atom.notifications.addWarning(`File does not exist:\n${targetFile}`, {dismissable: true, buttons: [{text: "Make this file", onDidClick: makeFile}]});
    return;
  }

  function makeFile() {
    notif.dismiss();
    atom.workspace.open(targetFile).then((newEditor) => {
      let relTo = atom.config.get("hyperclick-latex.setRootFile")
      if (relTo !== "None") {
        let rootPath = getRootPath(relTo, editor, targetFile);
        newEditor.setText(`% !TEX root = ${rootPath}\n`);
      }
    });
  }

  let promForEditor = atom.workspace.open(targetFile);
  if (parentCommand === "root") {
    promForEditor.then((newEditor) => {
      let originalFile = path.basename(editor.getPath());
      newEditor.scan(new RegExp(`\\\\input\{.*?\\b${originalFile}\\b.*?\}`), ({range}) => {
        newEditor.setCursorBufferPosition(range.end);
      });
    });
  };
}

function getRootPath(relTo, editor, newFilePath) {
  let newFileFolder = path.dirname(newFilePath);
  let relPath;

  if (relTo === "Project root") {
    let projectRootFile = getRootFilePath(editor);
    relPath = path.relative(newFileFolder, projectRootFile);
  } else { // === "Calling file"
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

  emitter: emitter,

  getSuggestion(editor, point) {
    let lineNum = point.row;

    /*
      NOTE: The mouse-position-to-buffer-coordinate function seems to be a little
      quirky. E.g., try zooming in **really** close, and logging what character
      hyperclick thinks the mouse is over. I found it would change about halfway
      _through_ the character, and not at the character boundaries.

      Atom docs say the Point class is 0 indexed.
    */

    let lineIndex = point.column;
    let line = editor.lineTextForBufferRow(lineNum);

    // let currentChar = line.charAt(lineIndex); // for debugging where the click is registered
    // console.log(currentChar);                 // the precise position is a little sketchy

    let lineStart = "";
    let wordRange;

    let word = getWordFromLineIndex(line, lineIndex);
    if (word) {
      lineStart = line.slice(0, word.wordStartIndex);
      wordRange = new Range([lineNum, word.wordStartIndex], [lineNum, word.wordEndIndex]);
    }

    let braceStart = "";
    let braceRange;

    let braceContents = getBraceContentsFromLineIndex(line, lineIndex);
    if (braceContents) {
      braceStart = line.slice(0, braceContents.braceStartIndex);
      braceRange = new Range([lineNum, word.braceStartIndex], [lineNum, word.braceEndIndex]);
    }

    if (braceContents.braceContents.length > 0 && isEnvDelim(lineStart)) {
      return {
        range: wordRange,
        callback() { gotoMatchingEnvDelim(editor, point, braceContents); }
      };
    }

    let ref = isRef(line, lineIndex);
    if (ref) {
      return {
        range: new Range([lineNum, ref.refStartIndex], [lineNum, ref.refEndIndex]),
        callback() { gotoLabelDefinition(editor, point, ref); }
      };
    }

    let filePath = isFilePath(line, lineIndex);
    if (filePath) {
      return {
        range: new Range([lineNum, filePath.fileStartIndex], [lineNum, filePath.fileEndIndex]),
        callback() { openFile(filePath.path, editor, filePath.parentCommand); }
      };
    }

    if (word.word.length > 0 && (isPackageOrClass(editor, point, lineStart))) {
      return {
        range: wordRange,
        callback() { openTexdocDocumentation(word.word); }
      };
    }

    return undefined;
  }
};
