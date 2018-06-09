/*
  COPIED FROM autocomplete-latex v0.9.0
*/

const fs = require("fs");
const path = require("path");

module.exports = { findBibFile };

/*
  Attempts to find the .bib file using a number of methods, with the following priority:
    1. Magic bib comment in current file
    2. Path given by `\addbibresource{...}`
    3. Find the root file given by magic comment
    4. Repeat steps 1 & 2 on this root file
    5. Give up and return false
*/
function findBibFile(editor) {
  let fileText = editor.getText();
  let magicBibPath = fileText.match(/% !T[eE]X bib =\s*(.*)/);
  if (magicBibPath) { // if bib path explicity set, go with that one
    return path.resolve(editor.getDirectoryPath(), magicBibPath[1]);
  }

  let bibPath = fileText.match(/\\addbibresource(?:\[.*?\])?\{(.*?)\}/);
  if (bibPath) {
    bibPath[1] = bibPath[1].trim();
    return path.resolve(editor.getDirectoryPath(), bibPath[1]);
  }

  let rootFile = fileText.match(/% !T[eE]X root =\s*(.*)/);
  if (!rootFile) { return false; }

  rootFile = path.resolve(editor.getDirectoryPath(), rootFile[1]);
  try {
    fileText = fs.readFileSync(rootFile, "utf-8");
  } catch (err) {
    // Fails silently.
    console.warn(`hyperclick-latex could not find root file:\n${err}`);
    return false;
  }

  let rootFilePath = path.dirname(rootFile);

  magicBibPath = fileText.match(/% !T[eE]X bib =\s*(.*)/);
  if (magicBibPath) { // if bib path explicity set, go with that one
    return path.resolve(rootFilePath, magicBibPath[1]);
  }

  bibPath = fileText.match(/\\addbibresource\{(.*?)\}/);
  if (bibPath) {
    return path.resolve(rootFilePath, bibPath[1]);
  }

  // Could also look for \input{} files, as they may contain labels/bib paths

  return false;
}
