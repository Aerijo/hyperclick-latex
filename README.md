[See this on atom.io](https://atom.io/packages/hyperclick-latex)
# hyperclick-latex

Hyperclick support for LaTeX in [Atom](https://atom.io/)

## About

This package adds [`hyperclick`](https://atom.io/packages/hyperclick) support for LaTeX documents.

## Features

- Click package name to open documentation (provided by [`texdoc`](https://www.tug.org/texdoc/))
- Click paths inside of `\input{...}` and `\include{...}` to open the file
  - Make the new file if it doesn't already exist
- Click environment delimiters to go to the corresponding `begin`/`end` statement.
- Click `ref`'s to go to corresponding `label`*

\* Specifically, it will go to the first occurrence of the label on the current file or, failing that, will search all files from the root document and on for the first occurrence, following `\input` and `\include` statements.

## Planned
- Click citations to go to corresponding citation in `.bib` file
- Ignore commented things / match comments within comments.


## Requirements

- The package [`hyperclick`](https://atom.io/packages/hyperclick) must be installed and enabled.

- [`busy-signal`](https://atom.io/packages/busy-signal) is an optional dependency that will add a little icon the the status bar that shows when this package is doing something. It is not required for this package to function.
