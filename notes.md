Next steps:

**TODO**: set up start and stop for tasks.json

Integration test debugging:
- [ ] github action caching works
    - [x] close, still working on exact naming and handling of directories so things actually cache
    - [ ] https://github.com/haberdashPI/vscode-master-key/pull/74/commits/d8eac66226fa1b8316156404c6f5f16d08a65cd6 should have been a cache hit
    - [ ] check that things are actually getting cached across CI runs
- [x] get code coverage working
    - [x] unit test coverage just works 🚀
        - [x] how do I filter out node_modules ??
    - [x] coverage for integration tests
        - [x] took some time, but now, by passing the right arguments and env vars to electron I'm getting coverage for integration tests as well
        - [x] cleanup coverage file generation in integration tests
        - [x] get coverage to be optional during integration tests
        - [x] how do I filter out node modules ??
    - [x] generate coverage output during CI
        - [x] running electron with `NODE_V8_COVERAGE` fails, but I can't
              see the output because of the way xvfb is getting run,
              plan is to use https://github.com/marketplace/actions/cache-apt-packages
              to install and cache xvfb and hopefully by running this
              directly within the call to `mise` I should be able to
              see the output from the application
        - [x] I think I've figured out that I can use a macos runner to circumvent a bug in
              in using NODE_V8_COVERAGE. (I can test other platforms by not doing coverage on these systems)
        - [x] next I need to figure out how to assemble and send coverage of to codecov.io
            - [x] get c8 or variant thereof to assemble raw outputs into various formats
            - [x] encode my findings in `mise.toml` tasks
                - [x] for local review of coverage in html or text
                - [x] for review of coverage via lcov (both local and CI)

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
    - [x] searchMotions.ux.mts unit tests
    - [x] replay.ux.mts unit tests
    - [x] markdown docs integration tests
    - [x] visual docs integration tests
    - [x] simpleMotionLayout.ux.mts integration tests:
    - [X] config(Edit).ux.mts integration tests
        - [X] fallback bindings
        - [X] setting defaults
            - when you first open the editor modes work as expected
        - [X] loading from a directory (remove this feature!)
        - [X] duplicate entry labels (if we remove above we can skip this)
        - [X] loading from a file (remove this feature!)
        - [X] bindings can be removed
        - [X] add and remove user bindings
        - [X] prevent user binding updates absent preset
2. eliminate/cleanup functionality I don't have good coverage for
    - [X] eliminate elaborate loading UI
    - [X] don't auto load documentation
    - [ ] don't automatically offer to install extensions
    - [ ] add buttons to info message to show documentation
3. Refactor parsing to rust
    a. in this early phase, we don't worry too much about providing detailed error messages
       (if there are easy things to do here we can do them, but no UX work, etc...)
4. Move palette from quick pick to tree view
    - [ ] get a simple tree view working (just show one item)
    - [ ] get tree view to show palette items
    - [ ] sections of literate documentation should determine tree structure
    - [ ] allow a small set of high priority items to show up at the top
    - [ ] add CI tests informted by palette.ux.mts
5. Translate the lower priority tests
    - [ ] low impact on stability and coverage, but high effort changes
        - save these for after the PR migrating to new test/coverage setup
        - [ ] searchMotions.ux.mts integration tests
            - [ ] `acceptAfter`
            - [ ] `acceptAfter` with delete char
            - [ ] post search commands
        - [ ] replay.ux.mts integration tests
            - [ ] replay canceled entry
            - [ ] replay captured keys
            - [ ] replay canceled captured keys
            - [ ] replay insert/replace
            - [ ] allow store and restore
        - [ ] configEdit.ux.mts
            - [ ] can create editable copy
            - [ ] can copy user config
6. Review documentation
7. Release version 0.4
8. Migration of selection utilities to the same build and test setup
9. Generate detailed error reports for keybinding files and get them to show
   up in VSCode's problem window / linting underlines
10. Translate selection utility tests to new build setup
11. Get CI working for all tests in selection utilities
12. continue the quest for better test coverage

\u001b[32m✔\u001b[39m Found existing install in /home/runner/work/vscode-master-key/vscode-master-key/.vscode-test/vscode-linux-x64-insiders\n
