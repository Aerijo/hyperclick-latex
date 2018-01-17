const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { Range } = require("atom");

function isPackage(line, wordStartIndex) {
  if (line.slice(0, wordStartIndex).match(/\\usepackage\{$/)) {
    return true;
  } else {
    return false;
  }
}

function isClass(line, wordStartIndex) {
  if (line.slice(0, wordStartIndex).match(/\\documentclass\{$/)) {
    return true;
  } else {
    return false;
  }
}

function isFilePath(line, index) {
  let filePattern = /\\(?:input|include(?:only)?)\s*\{(.+?)\}/g;
  let match;
  while ((match = filePattern.exec(line)) !== null) { // assign the result to match, then check if match is true
    let fileStartIndex = match[0].indexOf("{") + match.index;
    let fileEndIndex = match[0].indexOf("}") + match.index;
    if (fileStartIndex < index && index < fileEndIndex) {
      return { path: match[1], fileStartIndex, fileEndIndex };
    } else {
      continue;
    }
  }

  let magicFilePattern = /^%\s*!T[eE]X\s+(?:root|bib)\s*=\s*(.*)$/;
  match = magicFilePattern.exec(line);
  if (match !== null) {
    let fileStartIndex = line.indexOf(match[1]) - 1;
    let fileEndIndex = line.length;
    if (fileStartIndex < index && index < fileEndIndex) {
      return { path: match[1], fileStartIndex, fileEndIndex };
    }
  }

  return false;
}

function openTexdocDocumentation(packageName) {
  if (!packageName.match(/[a-zA-Z0-9@_\-]+/)) {
    atom.notifications.addWarning(`Package name ${packageName} is invalid`);
  } else {
    let child = child_process.spawn("texdoc", [packageName]);
    child.stdout.setEncoding("utf-8");
    child.stdout.on('data', (data) => {
      atom.notifications.addInfo("`texdoc` says:", {description: data, dismissable: true});
    });
    child.on('close', (code, signal) => {
      if (code !== 0) { console.log(`texdoc exited with code ${code}`); }
    });

  }
}

function openFile(filePath, editor) {
  let currentDir = path.dirname(editor.getPath());
  let targetFile = path.resolve(currentDir, filePath.trim());
  if (fs.existsSync(targetFile)) {
    try {
      atom.workspace.open(targetFile);
    } catch (e) {
      atom.notifications.addWarning(`Could not open file. Error:`, {detail: e, dismissable: true})
    }
  } else {
    atom.notifications.addWarning(`File does not exist:\n${targetFile}`, {dismissable: true})
  }
}

function getWordFromLineIndex(line, index) {
  let word = "";
  let wordStartIndex = /[a-zA-Z0-9@_\-]*$/.exec(line.slice(0, index + 1)).index; // index+1 to include the clicked character as well
  let wordEndIndex = /^([a-zA-Z0-9@_\-]*)/.exec(line.slice(index))[1].length + index;
  word = line.slice(wordStartIndex, wordEndIndex);
  // console.log("word: ", word, " sIndex:", wordStartIndex, " eIndex:", wordEndIndex);
  return { word, wordStartIndex, wordEndIndex };
}

module.exports = {
  priority: 1,
  grammarScopes: [ 'text.tex.latex' ],

  getSuggestion(editor, point) {
    let line = editor.lineTextForBufferRow(point.row);
    let lineIndex = point.column - 1; // convert to 0 based index; use this from here onwards
    let filePath;
    let word;
    let currentChar = line.charAt(lineIndex);
    // console.log("char: ", currentChar, " point: ", point.toArray());

    word = getWordFromLineIndex(line, lineIndex);

    if (word.word.length > 0 && (isPackage(line, word.wordStartIndex) || isClass(line, word.wordStartIndex))) {
      // console.log("is class or package");
      return {
        range: new Range([point.row, word.wordStartIndex], [point.row, word.wordEndIndex]),
        callback() { openTexdocDocumentation(word.word); }
      }
    } else if (!!(filePath = isFilePath(line, lineIndex)) == true) {
      // console.log("is file: ", filePath);
      return {
        range: new Range([point.row, filePath.fileStartIndex], [point.row, filePath.fileEndIndex]),
        callback() { openFile(filePath.path, editor); }
      }
    } else {
      // console.log("not handled")
      return undefined;
    }
  }
}
