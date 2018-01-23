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

function isEnvDelim(line, wordStartIndex) {
  if (line.slice(0, wordStartIndex).match(/\\(begin|end)\{$/)) {
    return true;
  } else {
    return false;
  }
}

function findMatchEnvDelim(editor, point, word) { // word is an object with prop. word, wordStartIndex & wordEndIndex
  let nestCount = 0;
  let line = editor.lineTextForBufferRow(point.row);
  let searchTerm = new RegExp(`\\\\(begin|end)\\{${word.word}\\}`, "g");
  let match = line.slice(0, word.wordStartIndex).match(/\\(begin|end)\{$/);
  if (match[1] === "begin") { // we search down
    // first though, we get to the end of the current line.
    // TODO: This is perfect for cleaning up. Much was copy and pasted. Several times.
    while ((match = searchTerm.exec(line.slice(point.column))) !== null) {
      if (match[1] === "begin") {
        nestCount += 1;
      } else if (match[1] === "end") {
        if (nestCount > 0) { nestCount -= 1; continue; }
        editor.setCursorBufferPosition([point.row, match.index + point.column]);
        return;
      }
    }

    for (let i = point.row + 1; i < editor.getLineCount(); i++) {
      line = editor.lineTextForBufferRow(i);
      while ((match = searchTerm.exec(line)) !== null) {
        if (match[1] === "begin") {
          nestCount += 1;
        } else if (match[1] === "end") {
          if (nestCount > 0) { nestCount -= 1; continue; }
          editor.setCursorBufferPosition([i, match.index]);
          return;
        }
      }
    }

    atom.notifications.addWarning(`Closing delimiter for environment \`${word.word}\` not found`);
    return;

  } else if (match[1] === "end") { // we search up
    // first though, we get to the beginning of the current line.
    // TODO: This is perfect for cleaning up.

    let stack = []; // stack up the occurrences in each line and then evaluate it backwards before the next
    while ((match = searchTerm.exec(line.slice(0, point.column))) !== null) {
      stack.push(match);
    }

    for (let i = stack.length - 1; i >= 0; i--) {
      let match = stack[i];
      if (match[1] === "end") {
        nestCount += 1;
      } else if (match[1] === "begin") {
        if (nestCount > 0) { nestCount -= 1; continue; }
        editor.setCursorBufferPosition([point.row, match.index]);
        return;
      }
    }

    for (let i = point.row - 1; i > 0; i--) {
      stack = []; // reset the stack on each new line
      line = editor.lineTextForBufferRow(i);
      while ((match = searchTerm.exec(line)) !== null) {
        stack.push(match);
      }

      for (let j = stack.length - 1; j >= 0; j--) {
        let stackMatch = stack[j];
        if (stackMatch[1] === "end") {
          nestCount += 1;
        } else if (stackMatch[1] === "begin") {
          if (nestCount > 0) { nestCount -= 1; continue; }
          editor.setCursorBufferPosition([i, stackMatch.index]);
          return;
        }
      }
    }
    atom.notifications.addWarning(`Opening delimiter for environment \`${word.word}\` not found`);
    return;
  } else {
    console.error("findMatchEnvDelim() must be given a valid delimiter");
    return;
  }
}

function isFilePath(line, index) {
  // TODO: Add support for comma separated paths
  let filePattern = /\\(input|include(?:only)?|addbibresource)\s*\{(.+?)\}/g;
  let match;
  while ((match = filePattern.exec(line)) !== null) { // assign the result to match, then check if match is true
    let commandStartIndex = match[0].indexOf("{") + match.index;
    let commandEndIndex = match[0].indexOf("}") + match.index;
    if (commandStartIndex < index && index < commandEndIndex) {

      return {
        path: match[2],
        fileStartIndex: commandStartIndex,
        fileEndIndex: commandEndIndex,
        parentCommand: match[1] // useful for things like guessing file extension
      };
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
  if (!packageName.match(/[\w@_\-]+/)) {
    atom.notifications.addWarning(`Package name \`${packageName}\` is invalid`);
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
  } else if (!path.extname(targetFile)) { // if the file without an extension doesn't exist, try and guess

  } else {
    atom.notifications.addWarning(`File does not exist:\n${targetFile}`, {dismissable: true})
  }
}

function getWordFromLineIndex(line, index) {
  let word = "";
  let wordStartIndex = /[\w@_\-]*$/.exec(line.slice(0, index + 1)).index; // index+1 to include the clicked character as well
  let wordEndIndex = /^([\w@_\-]*)/.exec(line.slice(index))[1].length + index;
  word = line.slice(wordStartIndex, wordEndIndex);
  return { word, wordStartIndex, wordEndIndex };
}

module.exports = {
  priority: 1,
  grammarScopes: [ 'text.tex.latex' ],

  getSuggestion(editor, point) {
    let lineNum = point.row
    let lineIndex = point.column - 1; // convert to 0 based index; use this from here onwards
    let line = editor.lineTextForBufferRow(lineNum);
    let filePath;
    let word;
    let currentChar = line.charAt(lineIndex);

    word = getWordFromLineIndex(line, lineIndex);

    if (word.word.length > 0 && (isPackage(line, word.wordStartIndex) || isClass(line, word.wordStartIndex))) {
      return {
        range: new Range([lineNum, word.wordStartIndex], [lineNum, word.wordEndIndex]),
        callback() { openTexdocDocumentation(word.word); }
      }
    } else if (!!(filePath = isFilePath(line, lineIndex)) === true) {
      return {
        range: new Range([lineNum, filePath.fileStartIndex], [lineNum, filePath.fileEndIndex]),
        callback() { openFile(filePath.path, editor); }
      }
    } else if (word.word.length > 0 && isEnvDelim(line, word.wordStartIndex)) {
      return {
        range: new Range([lineNum, word.wordStartIndex], [lineNum, word.wordEndIndex]),
        callback() { findMatchEnvDelim(editor, point, word); }
      }
    } else {
      return undefined;
    }
  }
}
