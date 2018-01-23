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

function gotoMatchingEnvDelim(editor, point, word) { // word is an object with prop. word, wordStartIndex & wordEndIndex
  let nestCount = 0;
  let line = editor.lineTextForBufferRow(point.row);
  let searchTerm = new RegExp(`\\\\(begin|end)\\{${word.word}\\}`, "g");
  let match = line.slice(0, word.wordStartIndex).match(/\\(begin|end)\{$/);

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

    if (!matchFound) { atom.notifications.addWarning(`Closing delimiter for environment \`${word.word}\` not found`); }
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

    if (!matchFound) { atom.notifications.addWarning(`Opening delimiter for environment \`${word.word}\` not found`); }
    return;

  } else {
    console.error("gotoMatchingEnvDelim() must be given a valid delimiter");
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
        callback() { gotoMatchingEnvDelim(editor, point, word); }
      }
    } else {
      return undefined;
    }
  }
}
