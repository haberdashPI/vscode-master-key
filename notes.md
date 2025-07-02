Next steps:

Integration test debugging:
- [ ] github action caching works
    - close, still working on exact naming of directories to actually cache
- [ ] get code coverage working
    - [x] unit test coverage just works 🚀
    - [ ] coverage for integration tests
        - [x] took some time, but now, by passing the right arguments and env vars to electron I'm getting coverage for integration tests as well
        - [ ] cleanup coverage file generation in integration tests
        - [ ] get coverage to be optional during integration tests
    - [ ] generate coverage output during CI

1. Start translating each of the tests into unit/integration tests as appropriate
    - [x] simpleMotion.ux.mts translated into unit test
    - [x] simpleMotion.ux.mts integration tests:
        - check that we can press keys
        - check that we can press keys by mode
        - check that keys get properly ignored (not in original test, but a good one and topical)
    - [x] get CI setup
        - [x] desktop unit tests
        - [x] web unit tests
        - [x] desktop integration tests
    - [x] commandState.ux.mts unit tests
    - [x] commandState.ux.mts integration tests
        - [x] can respond to mode changes
        - [x] can respond to multi-key sequences
    - [~] searchMotions.ux.mts unit tests
    - [ ] searchMotions.ux.mts integration tests
        - [ ] `acceptAfter`
        - [ ] `acceptAfter` with delete char
        - [ ] post search commands
    - [ ] replay.ux.mts unit tests
    - [ ] config.ux.mts unit tests
        - fallback bindings
    - [ ] markdown docs integration tests
    - [ ] visual docs integration tests
    - [ ] palette integration tests
    - [ ] simpleMotionLayout.ux.mts integration tests:
        - check that the same tests from simpleMotion work with the layout
          settings
    - [ ] config(Edit).ux.mts integration tests
        - setting defaults
        - mode appearance
        - loading from a directory
        - duplicate entry labels
        - loading from a file
        - add and remove user bindings
        - can be removed
        - prevent user binding updates absent preset
        - default mode overwrite
        - can create editable copy
        - can copy user config
3. Refactor parsing to rust
    a. in this early phase, we don't worry too much about providing detailed error messages
       (if there are easy things to do here we can do them, but no UX work, etc...)
4. Review documentation
5. Release version 0.4
6. Migration selection utilities to the same build setup
7. Generate detailed error reports for keybinding files and get them to show
   up in VSCode's problem window / linting underlines
8. Translate selection utility tests to new build setup
9. Get CI working for all tests in selection utilities
10. continue the quest for better test coverage
