const { Range } = require("atom");

module.exports = { isFilePath, isPackageOrClass, isEnvDelim, isRef, isCitation, getBraceContents };

/**
* Notes on syntax of file path commands:
* - \input
*   - only takes a single path
*   - file name is minimal requirement
*   - outer whitespace is trimmed
* - \include, \includeonly
*   - takes comma separated list of paths,
*   - just file name is also minimal requirement
* - \includegraphics,
*   - entire contents are treated as path
*   - root path potentially set earlier; ENHANCEMENT: check root file for if the root path was set
* - Other commands:
*   - \inputminted ; special consideration needed for \inputminted{lang}{file},
*   - \addbibresource ; must be full path name,
*   - !TeX root = NOTE: This one won't be picked up by the brace contents; maybe transfer to separate function?
*/
function isFilePath(editor, point, context) {
  const fileRegex = /\\(input|include(?:only|graphics)?|addbibresource)\s*(?:\[.*?\])?\s*\{[^\}]*$/;
  const mintedRegex = /\\(inputminted)\s*\{[^\}]*\}\s*\{[^\}]*$/;
  const magicFileRegex = /^\s*%\s*!T[eE]X\s+(root|bib)\s*=\s*(.*)$/;

  let line = context.line;
  let index = context.index;
  let fileMatch = line.slice(0, index).match(fileRegex);
  if (fileMatch === null) { return false; } // can be expanded on to use grammar once I write it

  let fileCommand = fileMatch[1];

  if (fileCommand === "input") {
    let fileNameRegex = /^(\s*)(.*?)(\s*)$/;
    let nameMatch = context.value.match(fileNameRegex);

    let fileNameStartIndex = context.startIndex + nameMatch[1].length;
    let fileNameEndIndex = context.endIndex - nameMatch[3].length;

    if (index < fileNameStartIndex || index > fileNameEndIndex) {
      return false;
    } else {
      return {
        command: fileCommand,
        range: new Range([point.row, fileNameStartIndex], [point.row, fileNameEndIndex]),
        path: nameMatch[2]
      };
    }

  } else if (fileCommand === "include" || fileCommand === "includeonly") {
    let valueIndex = index - context.startIndex;

    let fileSectionStart = context.startIndex + context.value.lastIndexOf(",", valueIndex - 1);
    let fileSectionEnd   = context.startIndex + context.value.indexOf(",", valueIndex);

    if (fileSectionStart < context.startIndex) {
      fileSectionStart = context.startIndex;
    } else {
      fileSectionStart += 1;
    }
    if (fileSectionEnd < context.startIndex) { fileSectionEnd = context.endIndex; }

    if (fileSectionEnd - fileSectionStart < 1) { return false; }

    let fileNameRegex = /^(\s*)(.*?)(\s*)$/;
    let fileSection = context.line.slice(fileSectionStart, fileSectionEnd);
    let nameMatch = fileSection.match(fileNameRegex);

    let fileNameStartIndex = fileSectionStart + nameMatch[1].length;
    let fileNameEndIndex = fileSectionEnd - nameMatch[3].length;

    if (index < fileNameStartIndex || index > fileNameEndIndex) {
      return false;
    } else {
      return {
        command: fileCommand,
        range: new Range([point.row, fileNameStartIndex], [point.row, fileNameEndIndex]),
        path: nameMatch[2]
      };
    }

  } else if (fileCommand === "includegraphics") {
    return {
      command: fileCommand,
      range: context.range,
      path: context.value
    };
  }

  return {
    command: fileCommand,
    range: context.range,
    path: context.value
  };
}

function isPackageOrClass(editor, point, context) {
  let lineStart = context.line.slice(0, context.index);
  let pkgRegex = /\\(?:usepackage|documentclass)\s*(?:\[.*?\])?\{[^\}]*$/;
  if (lineStart.match(pkgRegex)) {
    return true;
  } else {
    return context.scopes.includes("support.class.latex"); // probably more consistent
  }
}

function isEnvDelim(editor, point, context) {
  let line = context.line;
  let index = context.index;
  let envRegex = /\\(begin|end)\s*\{[^\}]*$/;
  let env = line.slice(0, index).match(envRegex);
  if (env) {
    return env[1];
  } else {
    return false;
  }
}

function isRef(editor, point, context) {
  let line = context.line;

  let refRegex = /\\((?:auto|name|page|eq|cpage|c|labelc)?ref(?:\*)?)\s*\{[^\}]*$/i;
  let ref = line.slice(0, point.column).match(refRegex);
  if (ref) { let command = ref[1]; return command; }

  let scopes = context.scopes;
  if (scopes.includes("meta.reference.latex")) {
    return "UNKNOWN REF COMMAND"; // need to find better way to handle this
  }

  return false;
}

function isCitation(editor, point, context) {
  return false;
}

/**
* The given point represents the location of where the cursor
* would go if the user clicked. The indexing is to the left
* hand side of each character. I.e, if the line is
*
* >> "abc"
*
* - clicking to the left hand side of the "a" would make the
* Point [row, 0], and the character at index 0 is the "a".
*
* - clicking to the right of the "a" is Point [row, 1]
* and the character at that index is "b"
*
* TL;DR: I dislike fencepost off-by-one things. Each point
* is a space between letters and is "asscoiated" with the letter
* to it's right.
*
* NOTE: Needs work to properly handle "{} | {}"
*/
function getBraceContents(editor, point, context) {
  let index = point.column;
  let line = context.line;

  let contentsStartIndex = line.lastIndexOf("{", index - 1); // if charAt == "{", then they clicked to the left of it and shouldn't match
  let contentsEndIndex   = line.indexOf("}", index); // if charAt == "}", they clicked to left and it's fine

  if (contentsStartIndex === -1 || contentsEndIndex === -1) { return null; }

  let range = new Range([point.row, contentsStartIndex + 1], [point.row, contentsEndIndex]);
  let value = editor.getTextInBufferRange(range);

  return {
    value,
    range
  };
}
