/*
  Tools to get information about the document structure.

  The main one here is UniqueDocumentTree. This class generates
  an array of file paths that are reached in a given document. They
  are not guaranteed to be in any particular order, and duplicate
  imports are ignored (hence "Unique").

  Another useful one is DocumentTree.

*/
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const { Emitter } = require("atom");

const filePathPattern = /\\(input|include(?:only)?)\s*\{(.+?)\}/g;

class Node {
  constructor(value, parent, terminator = false, root = false, tree = null) {
    this.value = value;
    this.parent = parent;
    this.children = [];
    this.uncategorisedChildren = [];
    this.leaf = terminator; // defaults to being a branch node
    this.root = root;
    this.tree = tree ? tree : parent.tree; // if (tree) { this.tree = tree; } else { this.tree = parent.tree; }
  }

  newChild(value, terminator = false) {
    return new Node(value, this, terminator, false, this.tree);
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
    this.emitter.emit("begin-tree-search");
    let node = this.rootNode;
    let pendingRecursive = 0; // used to see how many calls are yet to return. When 0, the search has failed.
    let stillGoing = true; // used to cancel any pending calls

    let recursive = function(node, searchTerm) {
      pendingRecursive += 1;

      if (pendingRecursive >= 100) {
        atom.notifications.addError("hyperclick-latex has failed to find the label due to too many recursive calls. Please report this error", { dismissable: true });
        stillGoing = false;
        pendingRecursive -= 1;
        return;
      }
      if (!stillGoing) {
        pendingRecursive -= 1;
        return;
      } // this will close any pending calls that are no longer required
      let currentPath = node.value;


      let pathArray = node.tree.pathArray;

      // Get all the file paths in the current file / node and store them as unsorted
      fs.readFile(currentPath, "utf8", (err, data) => {
        if (err) { console.error("Cannot read file:", err); return; }
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
            let newPaths = pathsFromMatch(currentPath, match);
            for (let i = 0; i < newPaths.length; i++) {
              // we only want new paths from here on out
              let newPath = newPaths[i];
              if (pathArray.includes(newPath) || !fs.existsSync(newPath)) { continue; }
              if (fs.lstatSync(newPath).isDirectory()) { continue; }
              node.children.push(new Node(newPath, node));
            }
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
        if (pendingRecursive === 0 && stillGoing) { // true when the last remaining search ends, regardless of when it started.
          node.tree.emitter.emit("finishedWithoutSuccess");
        }
      });
    };

    // initiate the first call
    recursive(node, searchTerm);
  }
}

class DocTreeNode { // like node, but with properties specific to document trees and linking other Nodes.
  constructor(filePath, parentNode, leaf = false, root = false, tree = null) {
    this.filePath = filePath;
    this.parents = parentNode ? [parentNode] : []; // unordered
    this.children = []; // ordered by where the file is included in the document
    this.infiniteLoop = false; // true means that following paths in this file will lead back to this file.
    this.leaf = leaf; // defaults to being a branch node
    this.root = root;
    this.tree = tree ? tree : parent.tree; // if (tree) { this.tree = tree; } else { this.tree = parent.tree; }

  }
}

class DocumentTree {
  constructor(rootFile) {
    this.emitter = new Emitter();
    this.rootNode = new DocTreeNode(rootFile, null, false, true, this);

    this.nodes = new Map(); // stores as filePath:node pairs
    this.nodes.set(rootFile, this.rootNode);
  }

  onFinishbuild(callback) {
    return this.emitter.on("end-build-nodes", callback);
  }

  generateNodes() { // makes a node for each file in the document
    // this is effectively a rewrite of the UDC version
    this.emitter.emit("begin-build-nodes");
    let pendingResolves = 0;
    let handledFiles = {};

    let closeThread = () => {
      pendingResolves -= 1;
      if (pendingResolves <= 0) { this.emitter.emit("end-build-nodes"); }
    };

    let resolve = (currentNode) => {
      pendingResolves += 1; // tally of active processes
      fs.readFile(currentNode.filePath, "utf8", (err, data) => { // this
        if (err) { console.error(err); return closeThread(); }

        let match = filePathPattern.exec(data);
        if (match === null) {
          currentNode.leaf = true;
          return closeThread();
        }

        while (match !== null) {
          let newPaths = pathsFromMatch(currentNode.filePath, match); // filters out non existent paths here (when resolving extensions)
          for (let i = 0; i < newPaths.length; i++) {
            let newPath = newPaths[i];

            if (this.nodes.has(newPath)) {
              let visitedNode = this.nodes.get(newPath);

              currentNode.children.push(visitedNode);
              visitedNode.parents.push(currentNode);

            } else {
              let newNode = new DocTreeNode(newPath, currentNode);
              this.nodes.set(newPath, newNode);
              currentNode.children.push(newNode);
              resolve(newNode);
            }
          }

          match = filePathPattern.exec(data);
        }

        return closeThread();
      });
    };

    /*
      Here we call resolve on the root node, which sets off the recursive solving.
    */

    resolve(this.rootNode);
  }

  onNewPath(callback) {
    return this.emitter.on("new-path", callback);
  }

  getLinearStructure() {
    /*
      Constructs an array of file nodes,
      ordered by when they appear in the document.

      Duplicates of paths are allowed, but infinite loops are prevented.
      The file that would loop is simply ignored the second time it appears
      in the same path from the root node.
    */

    let fileArray = [];
    let loopedFiles = [];

    let addFiles = (node, stack = []) => {
      if (stack.includes(node.filePath)) { loopedFiles.push(node.filePath); return; }

      fileArray.push(node.filePath);
      stack.push(node.filePath);

      let children = node.children;
      for (let i = 0; i < children.length; i++) {
        let child = children[i];
        addFiles(child, _.clone(stack));
      }
    };

    addFiles(this.rootNode);

    if (loopedFiles) { console.warn("Infinite loop detected in document structure", loopedFiles); }
    return fileArray;
  }

  getUniqueLinearStructure() {
    /*
      Same as getLinearStructure, but subsequent duplicate paths are removed.
    */
    return _.uniq(this.getLinearStructure());
  }
}

function pathsFromMatch(currentPath, match) { // needed to handle file extensions, etc.
  let pathsArray;
  if (match[1] === "input") {
    pathsArray = [match[2]];
  } else {
    pathsArray = match[2].split(/\s*,\s*/);
  }

  let appendExt = /^(?:input|include(?:only)?)$/.test(match[1]);

  return pathsArray
    .filter(p => /\S/.test(p))
    .map(p => {
      let absPath = path.resolve(path.dirname(currentPath), p);
      if (appendExt && !path.extname(absPath) && !fs.existsSync(absPath)) {
        absPath += ".tex";
      }
      return absPath;
    });
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

module.exports = { getRootFilePath, UniqueDocumentTree, DocumentTree };
