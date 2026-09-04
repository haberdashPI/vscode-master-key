Remaining issues with Emacs preset

- [X] if we hit a sequence like C-h x, where x is not a command defined in the binding set
      this will print "x" to the buffer. In emacs this would get ignored. We need to think
      about how to implement that and if there is a feature worth adding to handle it
- [X] step through commands and figure out any glitches
    - [ ] currently we're at line 685
- [ ] multiple selections does not use selection-utilities
- [ ] There are some redundant keys, we should clean those up
- [ ] I don't think the "storeCommand" implementation for some of the saved registeres will actually work
