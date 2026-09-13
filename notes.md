Remaining issues with mode-expression evaluation
- [X] figure out where/when we need to call parse_asts
- [X] update documentation
    - [X] remove places where expressions are described as being isolated to `[[bind]]`
- [X] disallow expressions for `[[mode]]` in older file versions

Remaining issues with Emacs preset

- [X] if we hit a sequence like C-h x, where x is not a command defined in the binding set
      this will print "x" to the buffer. In emacs this would get ignored. We need to think
      about how to implement that and if there is a feature worth adding to handle it
- [X] step through commands and figure out any glitches
- [ ] look through one more time
