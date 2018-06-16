const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const { escapeRegExp } = require("lodash");
const { Range, Emitter, CompositeDisposable } = require("atom");

const { isFilePath, isMagicFilePath, isPackageOrClass, isEnvDelim, isRef, isCitation, getBraceContents } = require("./context-helpers");
const util = require("./utilities");

module.exports = {
  priority: 1,
  grammarScopes: [ 'text.tex.latex', 'text.tex.latex.tikz' ],

  emitter: new Emitter(),

  getSuggestion(editor, point) {
    /**
    * We look for:
    *  [X] Environment delimiter -> select it and it's pair
    *  [X] Reference             -> go to label
    *  [X] Citation              -> open in .bib file
    *  [X] Package name          -> open texdoc docs
    *  [X] File path             -> open file / make in needed
    *  [O] Section               -> in separate package `latex-folding`
    */

    const line = editor.lineTextForBufferRow(point.row);
    const emitter = this.emitter;
    const context = {
      editor,
      point,
      line,
      scopes: editor.scopeDescriptorForBufferPosition(point).getScopesArray(),
      braceContents: getBraceContents(line, point)
    };

    let envDelimType = isEnvDelim(editor, point, context);
    if (envDelimType !== false) {
      return {
        range: context.braceContents.range,
        callback() { util.selectMatchingEnvDelims(editor, point, context, envDelimType); }
      };
    }

    let refCommand = isRef(editor, point, context);
    if (refCommand !== false) {
      return {
        range: context.braceContents.range,
        callback() { util.gotoLabelDefinition(editor, point, context.braceContents, emitter); }
      };
    }

    let citeCommand = isCitation(editor, point, context);
    if (citeCommand !== false) {
      return {
        range: context.braceContents.range,
        callback() { util.gotoCitation(editor, point, context.braceContents, emitter); }
      };
    }

    let filePathInfo = isFilePath(editor, point, context);
    if (filePathInfo !== false) {
      return {
        range: filePathInfo.range,
        callback() { util.openClickedFile(filePathInfo, editor); }
      };
    }

    let packageInfo = isPackageOrClass(editor, point, context);
    if (packageInfo !== false) {
      return {
        range: packageInfo.range,
        callback() { util.openTexdocDocumentation(packageInfo.value, emitter); }
      };
    }

    let magicFilePathInfo = isMagicFilePath(editor, point, context);
    if (magicFilePathInfo !== false) {
      return {
        range: magicFilePathInfo.range,
        callback() { util.openClickedFile(magicFilePathInfo, editor); }
      };
    }
  }
};
