[See this on atom.io](https://atom.io/packages/hyperclick-latex)
# hyperclick-latex

Hyperclick support for LaTeX in [Atom](https://atom.io/)

## About

This package adds [`hyperclick`](https://atom.io/packages/hyperclick) support for LaTeX documents.

- **Note**: Only just saw the existing package [`latex-hyperclick`](https://atom.io/packages/latex-hyperclick) shortly after publishing this one. It looks like it does a similar thing with file paths and references, but I think the documentation access and environment delimiter jumping by this package is unique.

## Requirements

- The package [`hyperclick`](https://atom.io/packages/hyperclick) must be installed and enabled.

## Features

- [X] Click package name to open documentation (provided by [`texdoc`](https://www.tug.org/texdoc/))
- [X] Click paths inside of `\input{...}` and `\include{...}` to open the file
- [X] Click environment delimiters to go to the corresponding `begin`/`end` statement.
- [X] Click `ref`'s to go to corresponding `label`
- [ ] Click citations to go to corresponding citation in `.bib` file
