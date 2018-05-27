module.exports = { isPackageOrClass, isEnvDelim, isRef };

function isPackageOrClass(editor, point, lineStart) {
  // if (lineStart.length > )
  if (lineStart.match(/\\(?:usepackage|documentclass)\s*(?:\[.*?\])?\{$/)) {
    return true;
  }

  // If the simple check doesn't work, try with scope (provided by grammar package) support.
  // will not work (or will lead to strange results) if the package does not follow `language-latex` conventions
  let scopes = editor.scopeDescriptorForBufferPosition(point).getScopesArray();
  let includes = scopes.includes("support.class.latex", 1); // first index is always root scope, so skip it
  return includes;
}

function isEnvDelim(lineStart) {
  return lineStart.match(/\\(?:begin|end)\s*\{$/);
}


function isRef(line, lineIndex) {
  let startRef = line.slice(0, lineIndex).match(/\\(?:auto|name|page|eq|cpage|c|labelc)?ref(?:\*)?\{([^\}]*)$/i);
  if (!startRef) { return false; }

  let endRef = line.slice(lineIndex).match(/^(.*?)\}/);
  if (!endRef) { return false; }
  let refStartIndex = startRef.index + startRef[0].match("{").index + 1;
  let refEndIndex = endRef[0].match("}").index + lineIndex;

  // console.log(refStartIndex, refEndIndex, line.slice(refStartIndex, refEndIndex), line);

  return {
    value: startRef[1] + endRef[1],
    refStartIndex,
    refEndIndex
  };
}
