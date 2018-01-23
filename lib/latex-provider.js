const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const _ = require("lodash");
const { Range } = require("atom");

function isPackageOrClass(editor, point, lineStart) {
  if (lineStart.match(/\\(?:usepackage|documentclass)(?:\[.*?\])?\{$/)) {
    return true;
  }

  // If the simple check doesn't work, try with scope (provided by grammar package) support.
  // will not work (or will lead to strange results) if the package does not follow `language-latex` conventions
  let scopes = editor.scopeDescriptorForBufferPosition(point).getScopesArray();
  let includes = scopes.includes("support.class.latex", 1); // first index is always root scope, so skip it
  return includes;
}

/*
// Not needed, as callback behaviour is same for package.
function isClass(editor, line, wordStartIndex) {
  if (line.slice(0, wordStartIndex).match(/\\documentclass\{$/)) {
    return true;
  } else {
    return false;
  }
}

*/

function isEnvDelim(lineStart) {
  return lineStart.match(/\\(?:begin|end)\{$/);
}

function gotoMatchingEnvDelim(editor, point, braceContents) { // word is an object with prop. word, wordStartIndex & wordEndIndex
  let nestCount = 0;
  let line = editor.lineTextForBufferRow(point.row);

  let sanBraceContents = _.escapeRegExp(braceContents.braceContents); // sanitize (escape) special characters

  let searchTerm = new RegExp(`\\\\(begin|end)\\{${sanBraceContents}\\}`, "g");
  let match = line.slice(0, braceContents.braceStartIndex).match(/\\(begin|end)\{$/);

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
    console.error("hyperclick-latex: gotoMatchingEnvDelim() must be given a valid delimiter. The following did not work", match);
    return;
  }
}

function isRef(line, lineIndex) {
  let startLabel = line.slice(0, lineIndex).match(/\\(?:auto|name|page|eq|cpage|c|labelc)?ref(?:\*)?\{([^\}]*)$/i);
  if (!startLabel) { return false; }

  let endLabel = line.slice(lineIndex).match(/^(.*?)\}/);
  if (!endLabel) { return false; }

  let labelStartIndex = startLabel[1].match("{") + startLabel.index;
  let labelEndIndex = endLabel[0].match("}") + lineIndex - 1;

  return {
    label: startLabel[1] + endLabel[1],
    labelStartIndex,
    labelEndIndex
  };
}

function gotoLabelDefinition(editor, point, label) {
  // can be improved to recursively scan any input files above it, in itself and in the root file.
  let searchTerm = new RegExp(`\\\\label\\{${label}\\}`);
  let scanRange = new Range([0, 0], point);
  let matchFound = false;
  editor.backwardsScanInBufferRange(searchTerm, scanRange, ({match, range, stop}) => {
    editor.setCursorBufferPosition(range.end);
    matchFound = true;
    stop();
  });

  if (!matchFound) { atom.notifications.addWarning(`Label declaration for reference \`${label}\` not found`); }
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

  let magicFilePattern = /^%\s*!T[eE]X\s+(root|bib)\s*=\s*(.*)$/;
  match = magicFilePattern.exec(line);
  if (match !== null) {
    let fileStartIndex = line.indexOf(match[2]) - 1;
    let fileEndIndex = line.length;
    if (fileStartIndex < index && index < fileEndIndex) {
      return { path: match[2], fileStartIndex, fileEndIndex, parentCommand: match[1] };
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

function openFile(filePath, editor, parentCommand) {
  let currentDir = path.dirname(editor.getPath());
  let targetFile = path.resolve(currentDir, filePath.trim());
  if (!fs.existsSync(targetFile) && !path.extname(targetFile)) {// if the file without an extension doesn't exist, try and guess
    if (parentCommand.match("bib")) {
      targetFile += ".bib";
    } else {
      targetFile += ".tex";
    }
  }

  if (!fs.existsSync(targetFile)) {
    atom.notifications.addWarning(`File does not exist:\n${targetFile}`, {dismissable: true});
    return;
  }

  atom.workspace.open(targetFile);
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
  grammarScopes: [ 'text.tex.latex' ],

  getSuggestion(editor, point) {
    let lineNum = point.row;
    let lineIndex = point.column - 1; // convert to 0 based index; use this from here onwards
    let line = editor.lineTextForBufferRow(lineNum);
    // let currentChar = line.charAt(lineIndex); // for debugging where the click is registered

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

    let label = isRef(line, lineIndex);
    if (label) {
      return {
        range: new Range([lineNum, label.labelStartIndex], [lineNum, label.labelEndIndex]),
        callback() { gotoLabelDefinition(editor, point, label.label); }
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
