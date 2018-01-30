// tools to get information from the document
const fs = require("fs");
const path = require("path");
const { Emitter } = require("atom");

class Node {
  constructor(value, parent, terminator = false, root = false, tree = null) {
    this.value = value;
    this.parent = parent;
    this.children = [];
    this.uncategorisedChildren = [];
    this.leaf = terminator; // defaults to being a branch node
    this.root = root;
    if (!tree) { this.tree = parent.tree; }
    else { this.tree = tree; }
  }
}

class UniqueDocumentTree {
  constructor(rootFile) {
    this.emitter = new Emitter();
    this.rootNode = new Node(rootFile, null, false, true, this);
    this.pathArray = [rootFile];
  }

  emitNewPath(path) {
    this.emitter.emit("newPath", path);
  }

  findMatch(searchTerm) {
    let node = this.rootNode;
    let pendingRecursive = 0; // used to see how many calls are yet to return. When 0, the search has failed.
    let stillGoing = true; // used to cancel any pending calls

    let recursive = function(node, searchTerm) {
      pendingRecursive += 1;
      if (!stillGoing) {
        pendingRecursive -= 1;
        return;
      } // this will close any pending calls that are no longer required
      let currentPath = node.value;


      let pathArray = node.tree.pathArray;
      let filePathPattern = /\\(input|include(?:only)?)\s*\{(.+?)\}/g;

      // Get all the file paths in the current file / node and store them as unsorted
      fs.readFile(currentPath, "utf8", (err, data) => {
        if (err) { console.error(err); return; }
        let match = searchTerm.exec(data);
        if (match) {
          node.tree.emitter.emit("endPatternInPath", currentPath);
          stillGoing = false;
          return;
        }

        match = null;
        do {
          match = filePathPattern.exec(data);
          if (match) {
            let newPath = pathFromMatch(currentPath, match);
            // we only want new paths from here on out
            if (pathArray.includes(newPath) || !fs.existsSync(newPath)) { continue; }
            node.children.push(new Node(newPath, node));
          }
        } while (match);

        if (node.children.length === 0) { node.leaf = true; }

        for (let i = 0; i < node.children.length; i++) {
          let childNode = node.children[i];
          node.tree.pathArray.push(childNode.value);
          // console.log("starting new recursive call, pr currently: ", pendingRecursive);
          recursive(childNode, searchTerm);
        }

        pendingRecursive -= 1;
        if (pendingRecursive === 0) {
          node.tree.emitter.emit("finishedWithoutSuccess");
        }
      });
    };

    // initiate the first call
    recursive(node, searchTerm);
  }
}

function pathFromMatch(currentPath, match) { // needed to handled file extensions, etc.
  return path.resolve(path.dirname(currentPath), match[2]);
}

function getRootFilePath(editor) {
  let currentFilePath = editor.getPath();
  let fileText = editor.getText();

  let rootFilePath = fileText.match(/% !T[eE]X root =\s*(.*)/);

  if (rootFilePath) {
    rootFilePath = path.resolve(editor.getDirectoryPath(), rootFilePath[1]);
    if (!path.extname(rootFilePath)) {
      rootFilePath = rootFilePath.concat(".tex");
    }
    return rootFilePath;
  } else {
    return currentFilePath;
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


module.exports = { isFilePath, getRootFilePath, UniqueDocumentTree };
