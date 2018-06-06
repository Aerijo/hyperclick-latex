const { CompositeDisposable } = require("atom");

const provider = require("./latex-provider");

var busyProvider;

module.exports = {
  config: {
    setRootFile: {
      description: "When making a new file, set the root path automatically",
      enum: ["Calling file", "Project root", "None"],
      default: "Project root",
      type: "string"
    }
  },

  activate() {
    if (!atom.packages.isPackageLoaded("hyperclick") || !atom.packages.isPackageLoaded("busy-signal")) {
      require("atom-package-deps").install("hyperclick-latex");
    }
  },

  deactivate() {
    if (this.disposables) {
      this.disposables.dispose();
    }
  },

  getHyperclickProvider() { // called by hyperclick when it activates
    return provider;
  },

  consumeSignal(registry) { // called with argument from busy-signal when it activates
    busyProvider = registry.create();
    this.disposables = new CompositeDisposable();
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
