const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const { Range } = require("atom");
const { escapeRegExp } = require("lodash");

module.exports = { openFileTextEditor, selectMatchingEnvDelims };

function promToOpenFile(filePath, { currentDir="/", parentCommand="" }) {
  return new Promise((resolve, reject) => {
    let absFilePath = path.resolve(currentDir, filePath);

    if (fs.existsSync(absFilePath)) {
      return resolve(atom.workspace.open(absFilePath));
    }

    let allFiles;
    try {
      allFiles = fs.readdirSync(path.dirname(absFilePath));
    } catch(error) {
      return reject(absFilePath);
    }

    let targetFileData = path.parse(absFilePath);
    let candidates = allFiles.filter(name => path.parse(name).name === targetFileData.name);

    if (candidates.length > 0) {
      absFilePath += path.extname(candidates[0]);
      return resolve(atom.workspace.open(absFilePath));
    } else {
      return reject(absFilePath);
    }
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
    if (!options.makeFile) {
      atom.notifications.addWarning(`Non-TeX file does not exist:\n${newFilePath}`, { dismissable: true });
      return;
    } else {
      if (path.extname(newFilePath) === "" && /^(input|include|includeonly)$/.test(options.parentCommand)) {
        newFilePath += ".tex";
      }

      let notif = atom.notifications.addWarning(`File does not exist:\n${newFilePath}`, {
        dismissable: true,
        buttons: [{
          text: "Make this file",
          onDidClick: () => { makeFile(newFilePath, notif, options); }
        }]
      });
    }
  });
}

function makeFile(filePath, notif, options) {
  notif.dismiss();
  atom.workspace.open(filePath)
  .then((editor) => {
    if (typeof editor === "undefined") { return; }
    if (options.setRoot === true) {
      rootPath = options.getRootPath(atom.config.get("hyperclick-latex.setRootFile"), options.editor, filePath);
      editor.setText(`% !TEX root = ${rootPath}\n`);
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
