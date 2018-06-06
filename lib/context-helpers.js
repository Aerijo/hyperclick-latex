const { Range } = require("atom");

module.exports = { isFilePath, isPackageOrClass, isEnvDelim, isRef, getBraceContents };

function isFilePath(editor, point, context) {
  /**
  * Notes on syntax of file path commands:
  * - \input only takes a single path; minimal def. is just file name.
  * - \include takes comma separated list of paths, just file name is also minimal requirement
  * - Other commands:
  *   - \includeonly,
  *   - \includegraphics,
  *   - \inputminted,
  *   - \addbibresource,
  *   - !TeX root = NOTE: This one won't be picked up by the brace contents; maybe transfer to separate function?
  */

  

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
  let index = context.startIndex;
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
