const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const { escapeRegExp } = require("lodash");
const { Range, Emitter, CompositeDisposable } = require("atom");

const { getRootFilePath, UniqueDocumentTree, DocumentTree } = require("./document-parser");
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
    *  [ ] Section               -> Fold / unfold that section
    */

    let emitter = this.emitter;
    let context = {
      editor,
      point,
      line: editor.lineTextForBufferRow(point.row),
      index: point.column,
      scopes: editor.scopeDescriptorForBufferPosition(point).getScopesArray()
    };

    let braceContents = getBraceContents(editor, point, context);
    if (braceContents !== null) {
      context.braceContents = braceContents;
      context.startIndex = braceContents.range.start.column;
      context.endIndex = braceContents.range.end.column;
      context.range = braceContents.range;
      context.value = braceContents.value;

      let envDelimType = isEnvDelim(editor, point, context);
      if (envDelimType !== false) {
        return {
          range: braceContents.range,
          callback() { util.selectMatchingEnvDelims(editor, point, context, envDelimType); }
        };
      }

      let refCommand = isRef(editor, point, context);
      if (refCommand !== false) {
        return {
          range: braceContents.range,
          callback() { util.gotoLabelDefinition(editor, point, braceContents, emitter); }
        };
      }

      let citeCommand = isCitation(editor, point, context);
      if (citeCommand !== false) {
        return {
          range: braceContents.range,
          callback() { util.gotoCitation(editor, point, braceContents, emitter); }
        };
      }

      if (isPackageOrClass(editor, point, context)) {
        return {
          range: braceContents.range,
          callback() { util.openTexdocDocumentation(braceContents.value, emitter); }
        };
      }

      let filePathInfo = isFilePath(editor, point, context);
      if (filePathInfo !== false) {
        return {
          range: filePathInfo.range,
          callback() { util.openClickedFile(filePathInfo, editor); }
        };
      }

    } else {
      // if not in braces, we could try checking the scopes from the grammar
      // check if file path (for !TeX root directive)
      let magicFilePathInfo = isMagicFilePath(editor, point, context);
      if (magicFilePathInfo !== false) {
        return {
          range: magicFilePathInfo.range,
          callback() { util.openClickedFile(magicFilePathInfo, editor); }
        };
      }
    }
  }
};
