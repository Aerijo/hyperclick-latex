const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const { Range } = require("atom");
const { escapeRegExp } = require("lodash");

const { getRootFilePath, UniqueDocumentTree, DocumentTree } = require("./document-parser");
const { findBibFile } = require("./bib-tools");

module.exports = {
  openFileTextEditor,
  selectMatchingEnvDelims,
  openTexdocDocumentation,
  gotoLabelDefinition,
  gotoCitation,
  openClickedFile
};

function promToOpenFile(filePath, { isTexFile=true, currentDir="/", parentCommand="" }) {
  return new Promise((resolve, reject) => {
    let absFilePath = path.resolve(currentDir, filePath);

    if (fs.existsSync(absFilePath) && fs.lstatSync(absFilePath).isFile()) {
      return resolve(atom.workspace.open(absFilePath));
    }

    if (path.extname(absFilePath) !== "") { reject(absFilePath); }

    let allFiles;
    try {
      allFiles = fs.readdirSync(path.dirname(absFilePath)); // also gets directories
    } catch(error) {
      return reject(absFilePath); // will throw if directory itself doen't exist
    }

    let targetFileData = path.parse(absFilePath);
    let candidates = allFiles.filter(name => path.parse(name).name === targetFileData.name);

    for (let i = 0; i < candidates.length; i++) {
      let ext = path.extname(candidates[i]);
      if (isTexFile && !/^\.(?:tex|tikz|bib)$/.test(ext)) { continue; }
      candPath = absFilePath + ext;
      if (fs.lstatSync(candPath).isFile()) {
        return resolve(atom.workspace.open(candPath));
      }
    }
    return reject(absFilePath);
  });
}

function openFileTextEditor(targetFilePath, options) {
  return promToOpenFile(targetFilePath, options)
  .then((editor) => { // on success
    if (typeof editor === "undefined") { return; }
    if (options.jumpToInputCommand === true) {
      let originalFile = path.basename(options.filePath);
      let sanOriginalFile = escapeRegExp(originalFile);
      let commandRegex = new RegExp(`\\\\(?:input|include)\{.*?\\b${sanOriginalFile}\\b.*?\}`);
      editor.scan(commandRegex, ({ range, stop }) => {
        editor.setCursorBufferPosition(range.end);
        stop();
      });
    }

    return editor;

  }, (newFilePath) => { // on fail; file does not exist

    let noExt = path.extname(newFilePath) === "";
    if (noExt && /^(root|input|include|includeonly)$/.test(options.parentCommand)) {
      newFilePath += ".tex";
    } else if (noExt && /^bib$/.test(options.parentCommand)) {
      newFilePath += ".bib";
    }

    let msg = `File does not exist:\n${newFilePath}`;

    if (!options.makeFile) {
      atom.notifications.addWarning(msg, { dismissable: true });
    } else {
      let notif = atom.notifications.addWarning(msg, {
        dismissable: true,
        buttons: [{
          text: "Make this file",
          onDidClick: () => { makeFile(newFilePath, options, notif); }
        }]
      });
    }
  });
}

function makeFile(filePath, options, notif) {
  if (notif) { notif.dismiss(); }
  if (fs.existsSync(filePath)) {
    atom.notifications.addError(`File already exists: ${filePath}`, { dismissable: true });
    return;
  }
  atom.workspace.open(filePath)
  .then((editor) => {
    if (typeof editor === "undefined") { return; }
    if (options.setRoot === true) {
      rootPath = getRootPath(atom.config.get("hyperclick-latex.setRootFile"), options.editor, filePath);

      if (path.resolve(filePath, "..", rootPath) === filePath) {
        return; // return if we are creating the root file
      } else {
        editor.getBuffer().append(`% !TEX root = ${rootPath}\n`);
      }
    }
  });
}

function selectMatchingEnvDelims(editor, point, context, envDelimType) {
  let envName = context.braceContents.value;
  let envRange = context.braceContents.range;
  let otherEnvRange = getEnvWordRange(editor, point, envName, envDelimType);
  if (otherEnvRange !== false) {
    editor.setSelectedBufferRanges([otherEnvRange, envRange], { preserveFolds: true });
  }
}

function getEnvWordRange(editor, point, envName, envDelimType) {
  let sanEnvName = escapeRegExp(envName);
  let searchRegex = new RegExp(`\\\\(begin|end)\\s*\\{${sanEnvName}\\}`, "g");

  let incDelim = envDelimType;

  let scanFunc;
  let scanRange;

  if (envDelimType === "begin") {
    scanRange = new Range(point, editor.getBuffer().getEndPosition());
    scanFunc = (s, r, callBack) => {
      return editor.scanInBufferRange(s, r, callBack);
    };
  } else {
    scanRange = new Range([0,0], point);
    scanFunc = (s, r, callBack) => {
      return editor.backwardsScanInBufferRange(s, r, callBack);
    };
  }

  let envNameRange;
  let matchFound = false;
  let nested = 0;

  scanFunc(searchRegex, scanRange, ({ match, range, stop }) => {
    if (match[1] === incDelim) {
      nested += 1;
    } else {
      if (nested > 0) { nested -= 1; return; }
      matchFound = true;
      editor.scanInBufferRange(envName, range, (result) => {
        envNameRange = result.range;
        result.stop();
      });
      stop();
    }
  });

  if (!matchFound) {
    let other = envDelimType === "begin" ? "Closing" : "Opening";
    let msg = `${other} delimiter for environment \`${envName}\` not found`;
    atom.notifications.addWarning(msg, { dismissable: true });
    return false;
  } else {
    return envNameRange;
  }
}

function openTexdocDocumentation(packageName, emitter) {
  if (!packageName.match(/[\w@_\-]+/)) {
    atom.notifications.addWarning(`Package name \`${packageName}\` is invalid`, { dismissable: true });
    return;
  }

  if (typeof emmitter !== "undefined") {
    emitter.emit("begin-open-docs", packageName);
  }

  let child = child_process.spawn("texdoc", [packageName]);
  child.stdout.setEncoding("utf-8");

  child.stdout.on('data', (data) => {
    atom.notifications.addInfo("`texdoc` says:", {description: data, dismissable: true});
  });

  child.on('close', (code, signal) => {
    if (code !== 0) { console.error(`texdoc exited with nonzero code ${code}`); }

    if (typeof emmitter !== "undefined") {
      emitter.emit("end-open-docs", packageName);
    }
  });
}

function gotoLabelDefinition(editor, point, braceContents, emitter) {
  let refID = braceContents.value;
  // first it does a cursory search of the current file, getting into more complicated behaviour if it fails.
  let searchTerm = new RegExp(`\\\\label\\{${escapeRegExp(refID)}\\}`);
  let scanRange = new Range([0, 0], point);
  let matchFound = false;
  editor.scan(searchTerm, scanRange, ({match, range, stop}) => {
    editor.setCursorBufferPosition(range.end);
    matchFound = true;
    stop();
  });

  if (matchFound) { return; }

  // if not found, we initiate a document tree of unique file paths.
  // the following disposables look for events emitted from the tree, which can be expected after running tree.findMatch()
  let documentTree = new UniqueDocumentTree(getRootFilePath(editor));
  let disposables = new CompositeDisposable();
  disposables.add(
    documentTree.emitter.on("begin-tree-search", () => {
      emitter.emit("begin-tree-search", refID);
    }),
    documentTree.emitter.on("finishedWithoutSuccess", () => {
      atom.notifications.addWarning(`Label declaration for reference \`${refID}\` not found`, {dismissable: true});
      emitter.emit("end-tree-search", refID);
      disposables.dispose();
    }),
    documentTree.emitter.on("endPatternInPath", (path) => {
      emitter.emit("end-tree-search", refID);
      openLocatedFile(path, editor)
      .then((editor) => {
        editor.scan(searchTerm, ({ range, stop }) => {
          editor.setCursorBufferPosition(range.end);
          stop();
        });
      });
      disposables.dispose();
    })
  );

  documentTree.findMatch(searchTerm);
}

function openLocatedFile(filePath, editor) {
  return openFileTextEditor(filePath,
    {
      filePath: editor.getPath(),
      currentDir: editor.getDirectoryPath(),
      jumpToInputCommand: false,
      setRoot: false,
      editor,
    }
  );
}

function openClickedFile(fileInfo, editor) {
  let isTexFile = /^(root|bib|input|include|includeonly)$/.test(fileInfo.command);
  return openFileTextEditor(fileInfo.path,
    {
      filePath: editor.getPath(),
      currentDir: editor.getDirectoryPath(),
      parentCommand: fileInfo.command,
      jumpToInputCommand: isTexFile,
      setRoot: isTexFile,
      makeFile: isTexFile,
      editor
    }
  );
}

function getRootPath(relTo, editor, newFilePath) {
  let newFileFolder = path.dirname(newFilePath);
  let relPath;

  if (relTo === "Project root") {
    let projectRootFile = getRootFilePath(editor);
    relPath = path.relative(newFileFolder, projectRootFile);
  } else {
    let callingFilePath = editor.getPath();
    relPath = path.relative(newFileFolder, callingFilePath);
  }

  if (path.dirname(relPath) === ".") {
    relPath = "./" + relPath;
  }

  return relPath;
}

function gotoCitation(editor, point, braceContents, emitter) {
  let bibFilePath = findBibFile(editor);
  if (!bibFilePath) {
    atom.notifications.addWarning(`Could not find bib file`, { dismissable: true });
    return;
  }

  promToOpenFile(bibFilePath, { currentDir: editor.getDirectoryPath(), parentCommand: "bib" })
  .then((bibEditor) => {
    let key = braceContents.value;
    let sanKey = escapeRegExp(key);
    let keyRegex = new RegExp(`^\\s*@.*?\\{\\s*${sanKey}\\s*,\\s*$`);

    foundMatch = false;
    bibEditor.scan(keyRegex, ({ range, stop }) => {
      bibEditor.setCursorBufferPosition(range.end);
      foundMatch = true;
      stop();
    });

    if (!foundMatch) {
      atom.notifications.addWarning(`Citation for key \`${key}\` not found`, {dismissable: true});
    }
  }, (filePath) => {
    atom.notifications.addWarning(`Could not find bib file:\n${filePath}`, { dismissable: true });
  });
}
