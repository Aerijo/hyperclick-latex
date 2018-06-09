const { Range } = require("atom");

module.exports = { isFilePath, isPackageOrClass, isEnvDelim, isRef, isCitation, getBraceContents };

function isFilePath(editor, point, context) {
  /**
  * Notes on syntax of file path commands:
  * - \input only takes a single path; minimal def. is just file name.
  * - \include takes comma separated list of paths, just file name is also minimal requirement
  * - Other commands:
  *   - \includeonly,
  *   - \includegraphics,
  *   - \inputminted ; special consideration needed for \inputminted{lang}{file},
  *   - \addbibresource ; must be full path name,
  *   - !TeX root = NOTE: This one won't be picked up by the brace contents; maybe transfer to separate function?
  */

  let fileRegex = /\\(input|include(?:only|graphics)?|addbibresource)\s*(?:\[.*?\])?\s*\{[^\}]*$/;
  let mintedRegex = /\\(inputminted)\s*\{[^\}]*\}\s*\{[^\}]*$/;
  let magicFileRegex = /^\s*%\s*!T[eE]X\s+(root|bib)\s*=\s*(.*)$/;

  let line = context.line;
  let index = context.index;
  let fileMatch = line.slice(0, index).match(fileRegex);
  if (fileMatch === null) { return false; } // can be expanded on to use grammar once I write it

  let fileCommand = fileMatch[1];
  if (fileCommand === "input") {
    return {
      command: fileCommand,
      range: context.range,
      path: context.value
    };
  }

  if (fileCommand === "include" || fileCommand === "includeonly") {
    return {
      command: fileCommand,
      range: context.range,
      path: context.value
    };
  }

  if (fileCommand === "includegraphics") {
    return {
      command: fileCommand,
      range: context.range,
      path: context.value
    };
  }
}


// function isFilePath(line, index) {
//   // TODO: Add support for comma separated paths
//   let filePattern = /\\(input|include(?:only)?|addbibresource)\s*\{(.+?)\}/g;
//   let match;
//   while ((match = filePattern.exec(line)) !== null) { // assign the result to match, then check if match is true
//     let contentStartIndex = match[0].indexOf("{") + match.index + 1;
//     let contentEndIndex = match[0].indexOf("}") + match.index - 1;
//     if ((contentStartIndex <= contentEndIndex) && (contentStartIndex <= index && index <= contentEndIndex)) {
//
//       let paths = line.slice(contentStartIndex, contentEndIndex + 1).split(/,/); // +1 to include the last char as well
//
//       if (paths.length === 1) {
//         return {
//           path: match[2],
//           fileStartIndex: contentStartIndex,
//           fileEndIndex: contentEndIndex + 1,
//           parentCommand: match[1] // used for things like guessing file extension
//         };
//       } else if (paths.length > 1 ) {
//         let runningIndex = contentStartIndex - 1; // char immediately before the first path char (so the { )
//         for (let i = 0; i < paths.length; i++) {
//           if (runningIndex < index && index <= runningIndex + paths[i].length + 1 ) {
//             return {
//               path: paths[i].trim(),
//               fileStartIndex: runningIndex + 1,
//               fileEndIndex: runningIndex + paths[i].length + 1,
//               parentCommand: match[1]
//             };
//           } else {
//             runningIndex += paths[i].length + 1; // +1 for the comma that was removed
//           }
//         }
//       }
//     }
//   }
//
//   let magicFilePattern = /^%\s*!T[eE]X\s+(root|bib)\s*=\s*(.*)$/;
//   match = magicFilePattern.exec(line);
//   if (match !== null) {
//     let fileStartIndex = line.indexOf(match[2]) - 1;
//     let fileEndIndex = line.length;
//     if (fileStartIndex < index && index < fileEndIndex) {
//       return { path: match[2], fileStartIndex, fileEndIndex, parentCommand: match[1] };
//     }
//   }
//
//   return false;
// }


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
