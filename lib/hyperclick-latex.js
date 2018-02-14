// const { CompositeDisposable } = require("atom");
const provider = require("./latex-provider");
const { CompositeDisposable } = require("atom");
var busyProvider;

module.exports = {
  activate(state) {
    if (!atom.packages.isPackageLoaded("hyperclick") || !atom.packages.isPackageLoaded("busy-signal")) {
      require("atom-package-deps").install("hyperclick-latex");
    }
    this.disposables = new CompositeDisposable();
  },

  getHyperclickProvider() {
    return provider;
  },

  consumeSignal(registry) { // called when busy-signal activates
    busyProvider = registry.create();
    this.disposables.add(
      busyProvider,
      provider.emitter.on("begin-open-docs", (docs) => {
        busyProvider.add(`Opening documentation for ${docs}`);
      }),
      provider.emitter.on("end-open-docs", (docs) => {
        busyProvider.remove(`Opening documentation for ${docs}`);
      }),
      provider.emitter.on("begin-tree-search", (label) => {
        busyProvider.add(`Searching document for ${label}`);
      }),
      provider.emitter.on("end-tree-search", (label) => {
        busyProvider.remove(`Searching document for ${label}`);
      })
    );
  }
};
