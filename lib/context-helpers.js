const { Range } = require("atom");

module.exports = { isFilePath, isMagicFilePath, isPackageOrClass, isEnvDelim, isRef, isCitation, getBraceContents };

function isMagicFilePath(editor, point, context) {
  const line = context.line;
  const col = point.column;
  const magicFileRegex = /^\s*%\s*!T[eE]X\s+(root|bib)\s*=\s*/;

  let fileMatch = line.match(magicFileRegex);
  if (fileMatch === null) { return false; }

  let filePathStartCol = indexToLeftPointCol(fileMatch[0].length);
  if (point.column < filePathStartCol) { return false; }

  let fileCommand = fileMatch[1];
  let filePath = textRightOfCol(line, filePathStartCol);

  return {
    command: fileCommand,
    range: new Range([point.row, filePathStartCol], [point.row, line.length]),
    path: filePath
  };
}

/**
* Notes on syntax of file path commands:
* - Latex cannot find files with any whitepace
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
*   - \addbibresource ; must be full path name (including extension),
*   - !TeX root = ... <- this is handled by isMagicFilePath
*/
function isFilePath(editor, point, context) {
  const fileRegex = /\\(inputminted\s*\{[^\}]*\}|input|include(?:only|graphics)?|addbibresource)\s*(?:\[.*?\])?\s*\{[^\}]*$/;
  const line = context.line;

  let fileMatch = textLeftOfCol(line, point.column).match(fileRegex);
  if (fileMatch === null) { return false; } // can be expanded on to use grammar once I write it

  let fileCommand = fileMatch[1];

  if (fileCommand === "input") {
    let { range, value } = getNameRangeAndValue(point, context, { commaSeparated: false, stripTrailingWhiteSpace: true });

    if (range === null || !range.containsPoint(point)) {
      return false;
    } else {
      return {
        command: fileCommand,
        range,
        path: value
      };
    }

  } else if (fileCommand === "include" || fileCommand === "includeonly") {

    let { range, value } = getNameRangeAndValue(point, context, { commaSeparated: true, stripTrailingWhiteSpace: true });

    if (range === null || !range.containsPoint(point)) {
      return false;
    } else {
      return {
        command: fileCommand,
        range,
        path: value
      };
    }

  } else if (fileCommand === "includegraphics") {
    // I'm not sure what the syntax for image paths is right now.
    //  - whitespace is important, comma separated not supported
    // Actually resolving the path will be done in the callback though.
    let { range, value } = getNameRangeAndValue(point, context, { commaSeparated: false, stripTrailingWhiteSpace: false });

    if (range === null || !range.containsPoint(point)) {
      return false;
    } else {
      return {
        command: fileCommand,
        range,
        path: value
      };
    }
  }

  // generic return if no other specialised matches.
  // We assume the user uses commas as a delimiter, and only has trailing whitespace because it's NOT important.
  let { range, value } = getNameRangeAndValue(point, context, { commaSeparated: true, stripTrailingWhiteSpace: true });
  if (range === null || !range.containsPoint(point)) {
    return false;
  } else {
    return {
      command: fileCommand,
      range,
      path: value
    };
  }
}

function getNameRangeAndValue(point, context, options) {
  // IMPROVEMENT: USE A REGEX OF VALID WORD CHAR INSTEAD
  const line = context.line;
  const col  = point.column;

  let contentStartCol, contentEndCol, range, value;

  if (context.braceContents) {
    ({ contentStartCol, contentEndCol, range, value } = context.braceContents);
  } else {
    let startBraceIndex = lastIndexLeftOfCol(line, "{", col);
    let endBraceIndex = firstIndexRightOfCol(line, "}", col);

    contentStartCol = indexToRightPointCol(startBraceIndex);
    contentEndCol = endBraceIndex === -1 ? indexToRightPointCol(line.length) : indexToLeftPointCol(endBraceIndex);
    range = new Range([point.row, contentStartCol], [point.row, contentEndCol]);
    value = textInCols(line, contentStartCol, contentEndCol);
  }

  if (options.commaSeparated) {
    const oldStartCol = contentStartCol;
    let contents = getCommaContentsFromValueAndPointCol(value, col - oldStartCol);
    contentStartCol = oldStartCol + contents.startCol;
    contentEndCol   = oldStartCol + contents.endCol;
    value = contents.value;
    range.start.column = contentStartCol;
    range.end.column   = contentEndCol;
  }

  if (options.stripTrailingWhiteSpace) {
    let nameMatch = value.match(/^(\s*)(.*?)(\s*)$/);
    if (!/\S/.test(nameMatch[2])) { return {range: null, value: null}; }
    range = range.translate([0, nameMatch[1].length], [0, -nameMatch[3].length]);
  }

  if (col === range.start.column && charRightOfCol(line, col) === "{") {
    return {
      range: null,
      value: null
    };
  }

  if (col === range.end.column && charLeftOfCol(line, col) === "}") {
    return {
      range: null,
      value: null
    };
  }

  return {
    range,
    value
  };
}

function getCommaContentsFromValueAndPointCol(value, relCol) {
  let startCommaIndex = lastIndexLeftOfCol(value, ",", relCol);
  let endCommaIndex = firstIndexRightOfCol(value, ",", relCol);

  let startCol = indexToRightPointCol(startCommaIndex);
  let endCol = endCommaIndex === -1 ? value.length : indexToLeftPointCol(endCommaIndex);
  return {
    startCol,
    endCol,
    value: textInCols(value, startCol, endCol)
  };
}

function isPackageOrClass(editor, point, context) {
  const lineStart = textLeftOfCol(context.line, point.column);
  const pkgRegex = /\\(usepackage|documentclass)\s*(?:\[.*?\])?\{[^\}]*$/;
  let match = lineStart.match(pkgRegex);

  if (match === null && !context.scopes.includes("support.class.latex")) { return false; }

  let comSep = match ? match[1] === "usepackage" : true; // documentclass is not comma separated

  let { range, value } = getNameRangeAndValue(point, context, { commaSeparated: comSep, stripTrailingWhiteSpace: true });

  if (range === null || !range.containsPoint(point)) {
    return false;
  } else {
    return {
      range,
      value
    };
  }
}

function isEnvDelim(editor, point, context) {
  const line = context.line;
  const envRegex = /\\(begin|end)\s*\{[^\}]*$/;
  let env = textLeftOfCol(line, point.column).match(envRegex);
  if (env) {
    return env[1];
  } else {
    return false;
  }
}

function isRef(editor, point, context) {
  const line = context.line;
  const refRegex = /\\((?:auto|name|page|eq|cpage|c|labelc)?ref(?:\*)?)\s*\{[^\}]*$/i;

  let ref = textLeftOfCol(line, point.column).match(refRegex);
  if (ref) { let command = ref[1]; return command; }

  let scopes = context.scopes;
  if (scopes.includes("constant.other.reference.latex")) { // "meta.reference.latex" is also applied to ref command
    return "UNKNOWN REF COMMAND"; // need to find better way to handle this
  }

  return false;
}

/**
In general, all but the {<key>} fields are optional.

command[][]{<key>}
cite[][]{<key>}
Cite[][]{<key>}
parencite[][]{<key>}
Parencite[][]{<key>}
footcite[][]{<key>}
footcitetext[][]{<key>}
textcite[][]{<key>}
Textcite[][]{<key>}
smartcite[][]{<key>}
Smartcite[][]{<key>}
cite*[][]{<key>}
parencite*[][]{<key>}
supercite{<key>}

         |---------| <- repeats indefinitely
cites()()[][]{<key>}
Cites()()[][]{<key>}
footcites()()[][]{<key>}
footcitetexts()()[][]{<key>}
textcites()()[][]{<key>}
Textcites()()[][]{<key>}
smartcites()()[][]{<key>}
Smartcites()()[][]{<key>}
supercites()()[][]{<key>}

autocite[][]{<key>}
Autocite[][]{<key>}
autocite*[][]{<key>}
Autocite*[][]{<key>}
autocites()()[][]{<key>}
Autocites()()[][]{<key>}
(not even finished...)
*/
function isCitation(editor, point, context) {
  // NOTE: Citations are hard to get right because they are so varied,
  //       so I'll leave this one to the grammar for now. It currently
  //       misses constructions like \cite()()[][]{}

  // let line = context.line;
  //
  // let citeRegex = /\\((?:auto|name|page|eq|cpage|c|labelc)?[cC]ite(?:\*)?)\s*\{[^\}]*$/i;
  // let cite = line.slice(0, point.column).match(citeRegex);
  // if (cite) { let command = cite[1]; return command; }

  let scopes = context.scopes;
  if (scopes.includes("constant.other.reference.citation.latex")) {
    return "UNKNOWN CITE COMMAND"; // need to find better way to handle this
  }

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
* NOTE: Needs work to properly handle cursor between like so "{} | {}"
*/
function getBraceContents(line, point) {
  const col = point.column;

  let bracketStartIndex = lastIndexLeftOfCol(line, "{", col);
  let minStartIndex     = lastIndexLeftOfCol(line, "}", col);
  let bracketEndIndex   = firstIndexRightOfCol(line, "}", col);
  let maxEndIndex       = firstIndexRightOfCol(line, "{", col);

  if (bracketStartIndex === -1 || bracketEndIndex === -1) { return null; }
  if (bracketStartIndex < minStartIndex || (bracketEndIndex > maxEndIndex && maxEndIndex !== -1)) { return null; }

  let contentStartCol = indexToRightPointCol(bracketStartIndex);
  let contentEndCol   = indexToLeftPointCol(bracketEndIndex);

  let range = new Range([point.row, contentStartCol], [point.row, contentEndCol]);
  let value = textInCols(line, contentStartCol, contentEndCol);

  return {
    contentStartCol,
    contentEndCol,
    value,
    range
  };
}


// Positioning functions
// So I don't have to keep track of (index <-> col <-> slice) conversions
indexToLeftPointCol  = index => index;
indexToRightPointCol = index => index + 1;
PointColToLeftIndex  = col => col - 1;
PointColToRightIndex = col => col;
textInCols           = (str, c1, c2) => str.slice(c1, c2);
textLeftOfCol        = (str, col) => str.slice(0, col);
textRightOfCol       = (str, col) => str.slice(col);
charLeftOfCol        = (str, col) => str.charAt(PointColToLeftIndex(col));
charRightOfCol       = (str, col) => str.charAt(PointColToRightIndex(col));
lastIndexLeftOfCol   = (str, search, col) => str.lastIndexOf(search, PointColToLeftIndex(col));
firstIndexRightOfCol = (str, search, col) => str.indexOf(search, PointColToRightIndex(col));

// For potential future use
getMatchColRange     = (str, regexStr, col) => {
  let startStr = textLeftOfCol(str, col);
  let endStr = textRightOfCol(str, col);

  let startRegex = new RegExp(regexStr + "$", "g");
  let endRegex = new RegExp("^" + regexStr, "g");

  let startMatch = startStr.match(startRegex);
  let endMatch = endStr.match(endRegex);

  startCol = startMatch ? col - startMatch[0].length : col;
  endCol   = endMatch ? col + endMatch[0].length : col;

  return [startCol, endCol];
};
