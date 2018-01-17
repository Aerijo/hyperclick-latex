// const { CompositeDisposable } = require("atom");
const provider = require("./latex-provider");

module.exports = {
  activate(state) {
    // this.disposables = new CompositeDisposable();
    //
    // this.disposables.add(
    //   atom.commands.add("atom-text-editor", {
    //     "hyperclick-latex:trigger": () => { this.trigger() },
    //   })
    // );
  },

  getHyperclickProvider() {
    return provider;
  }
};
