Making this package, I've come across many quirks with regards to how LaTeX (specifically `pdfTeX`) parses things. I've tried to support some of it, but others are just too crazy to be worth the effort. Here's a summary

- `usepackage`
  - Lets you add as many white space characters as you like. So these are all the same thing
    - `{graphicx}`
    - `{graphicx }`
    - `{ graphicx }`
    - `{ g r a p h i c x }`
    -
```
    {
      g
      r
      a
      p
      h
      i
      c
      x
    }
```
  - The only issue is with a blank (white space only) line, because that is converted to a paragraph break by TeX, which then throws an error.
  - Supports comma separated input of multiple package names.
  - Braces are allowed, but will be part of the package name if

- `documentclass`
  - Does not support comma separated paths or spaces (but _does_ allow initial white space).
