validation.rs(11, 99): consider introducing a `where` clause, but there might be an alternative better way to express this requirement: ` where &toml::map::Map<std::string::String, Value>: From<&T>`
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
    - [X] don't automatically offer to install extensions
    - [X] add buttons to info message to show documentation
3. Refactor parsing to rust
    a. in this early phase, we don't worry too much about providing detailed error messages
       (if there are easy things to do here we can do them, but no UX work, etc...)
    - [x] start by implementing parsing of `[[bind]]`
        - [X] basic parsing
        - [X] merging defaults
        - [X] refactor code
        - [X] initial coverage output
            - https://crates.io/crates/cargo-tarpaulin
            - or look at https://doc.rust-lang.org/rustc/instrument-coverage.html and use
            nightly tool-chain with
                - [X] rustup toolchain install nightly
        - [X] foreach expansion (unit tests remain)
        - [X] expand keys in `foreach` lists
        - [x] include `Spanned` in fields of `BindInput`
    - [ ] pipeline for `[[bind]]` entries
        - [X] basic pipeline
        - [X] implement parsing of vscode file with rust command (and generate problems)
            - [X] we need to detect that the file should be parsed
            - [X] we need to send detected files to the rust parser
            - [X] we need to process errors to generate the diagnostic outputs
        - [X] properly identify spans: both `[[bind]]` header and entire `[[bind]]` region
              NOTE: short term goal here is to support literate docs
        - [X] expansion of `[define]` sections
            - [X] implement support for resolving `var.`, `command.` and `bind.` definitions
            - [X] problem: spannd doesn't work with flatten; we can solve this by
              creating an `id` field for `command` and `bind` that will throw
              an error if populatd when passed on to the non-input constructors
            - [X] setup default keyword for `bind`
            - [X] rework how `var.` works, resolving it at run time, not definition time
            - [X] implement `default` expansion for `bind`
            - [X] make sure to error on fields that cannot have runtime computation
              (only certain fields can be evaluated at runtime: `args` and `repeat`)
            - [X] get basic interpolation of `{{bind/command}}` from `define` elements working for `bind` and its fields
        - [X] get evaluation of computed elements working `Command` and `Bind` working
        - [X] use rhai to implement expression evaluation
            - [X] setup state object definitions
            - [X] preparse all `{{}}` into AST
            - [X] evaluate expressions in command etc...
        - [X] foreach expansion within a KeyFile context
        - [X] I'm running into some issues with Rhai, consider switching:
            - it's large
            - it has a number of frail dependencies (e.g. no longer maintained)
            - I'm a *little* bit concerned by the overall judgement/attitude of the maintainer (seems okay with a dependency that is no longer maintained
            to avoid "breakage")
            - alternatives:
                - mlua: looks nice and stable but no WASM support
                    - doesn't support WASM
                - koto: a little less stable and with less backing
                    but has many features I want
                    - having slept on it, I don't think the tradeoffs for koto
                      are much better than Rhai. Rhai has seen more use and is a similar
                      scale of project (pet project of one person with some support
                      from other developers), while being less battle tested.
                - starlark: backed by big tech this is definitely more reliable
                     but it is also large and ambitious and not intended for
                     small embedded-language applications
            - conclusion: we stick with Rhai
        - [X] get `KeyFile` working with `bind`, `define` and runtime `command` calls
            - [X] implementation
            - [X] unit tests
                - [X] basic parsing
                - [X] define expansion for `bind.` and `command.`
            - [X] try it out from extension debugging
            - [X] write some type-script unit tests
        - [X] cleanup, document and refactor code
            - NOTE: we're waiting until we test out spans and the other stuff above because that could require more refactoring
            - [X] re-organize the code into smaller units
                - [X] bind is way to big start by breaking that up
                - [X] organize order of definitions in files (e.g. join separate `impl`
                      segments)
                      - [X] `bind`
                      - [X] define
                      - [X] value
                      - [X] validation
                      - [X] foreach
                      - [X] error
                      - [X] expression
                      - [X] file
                      - [X] lib
                      - [X] util
            - [X] replace IndexMap with IndexMap
            - [X] update documentation of `bind`, `define` and `expressions`
            - [X] refactor plural to use `into` / `from` Vec
            - [X] update documentation rendering pipeline
            - [X] error reporting is still a little finicky
                - [X] properly inject Rhai expression range into errors
                - [X] could probably make what is part of the same error more explicit
                - [X] reduce types of errors and tie error message string more explicitly
                      to name of enum variant
            - [X] get error reporting working in javascript again
            - [X] remove all compile warnings
        - [X] implement support for tags on `bind` (for filter them)
        - [X] implement support for `skipWhen` in `command`
        - [X] improve expression evaluation
            - [X] improve error reporting in expressions
                - [X] support spans for expressions
                    - [X] create a `RawValue` that tracks spans
                        - [X] try to implement with just the Span for expressions tracked
                        - [X] BUT this probably has to be for all variants, to avoid errors
                    - [X] parse as `RawValue` instead of `toml::Value`
                    - [X] inject Span into `Expression`
                    - NOTES: we can only include Span if the expression is a member of
                      a table not an array. We can handle this by using an optional
                      expression span. Error handling will then need to
                      generate a more disperse error around the span of the
                      array within its first containing map
                    - [X] datetimes are not explicitly handled in
                      `RawValue`: verify that we don't get an error parsing them
                    - [X] refactor / redocument `value.rs`
                - [X] inject expression spans and rhai positions into error contexts
                    - [X] implementation
                    - [X] test that expressions spans properly resolve
                - [X] check for unmatched `{{` and `}}` in strings
                    - [X] implementation
                    - [X] test that unmatched mustaches raise an error
                        - need to defer these errors until we run parse_asts
                          so that we can get proper span information without
                          having to pass errors through a deserialization object
            - [X] support expressions in `foreach` resolution
                - [X] add foreach variables to a local scope object
                - [X] expand expressions prior to resolving
                - [X] unit tests
            - [X] allow for `var` evaluation in parse-time expressions
                - [X] implement
                - [X] unit tests
        - [ ] implement `[[mode]]`
            - [X] implement
            - [X] add to `KeyFile`
            - [X] validate mode in `[[bind]]`
            - [X] add documentation
            - [X] use `Option<Plural<Mode>>` in BindingInput so we can
                    properly resolve to the default mode instead of "default"
            - [X] get existing unit tests working
            - [X] write test cases for error paths
            - [ ] write tests for expressions to specify modes
        - [ ] move `combinedName` and friends to `combined.name` and friends
        - [~] command normalization
            - [X] always `runCommand` with an array of objects with `command` field
            - [ ] flatten all nested `runCommands` calls
                - [ ] `skipWhen` will have to be propagated/merged to children
        - [ ] check constraints
            - [ ] validation that `master-key.prefix` uses `finalKey: false`
            - [ ] validation that keybindings with non modifier keybindings
              have a condition requiring textEditorFocus
                (or just insert it)
            - [ ] required keys are present
        - [ ] mode expansion: define a key binding per mode
        - [ ] key-sequence expansion and duplicate resolution:
              - [ ] create a binding per key in a sequence that requires a given prefix
              (depending on the prefix code of its prefix)
              - [ ] add any missing prefixes
        - [ ] implement the `all` functions:
            - [ ] `{{all_prefixes()}}`
            - [ ] `{{all_prefixes_but()}}`
            - [X] `{{all_modes()}}`
            - [X] `{{all_modes_but(["not_me", "or_me"])}}`
        - [ ] documentation expandsion/validation across all `[[bind]]` values
              with the same key and mode
              e.g. merge all shared documentation across the shared names
        - [ ] find low hanging fruit for problems with using 1.0 files
            - [ ] fields that exist in the old but not new (use `#[serde(flatten)]`)
            - [ ] add hints for fields that don't exist anywhere as well (probably
                  as a hint or something)
            - [ ] review strings for single `{}` braces and warn that `{{}}` are now required
            - [ ] others
        - [ ] implement `[[kind]]`
    - [ ] implement `[header]` section
        - [ ] instead of using `.mk.toml`, look for a specific heading in the file
    - [ ] proper conversion to keybindings.json command
        - [ ] expand prefixes to prefixCode and move to when clause
        - [ ] move mode to when clause
        - [ ] re-implement master-key.do
            - [ ] don't use `getter_with_clone` for `KeyFileResult` (it doesn't really make
              sense)
            - [ ] move all bare variables in an expression to `key.` or `code.` object
            - [ ] transfer scope state from TS to rust Scope object
            - [ ] properly handle command queues (no controlled by rust)
                - [ ] guess: don't have special command queue field
                - [ ] support accessing values by their path (`val.foo`, `key.count`)
                      from javascript
        - [ ] unit tests
        - [ ] integration tests
    - [ ] implement `replay`: use the new rust command queues instead of the old
          state management
    - [ ] extraction of visual docs
    - [ ] extraction of markdown docs
        - [ ] extract all comment regions (exclude `#-`)
        - [ ] replace `[[bind]]` regions:
            - [ ] identify each non-comment region, and look for parsed elements
                  whose span overlaps
            - [ ] convert any bind elements in this overlap into markdown table
    - [ ] serialization of bindings to settings.json
    - [ ] create data types to generate warnings/hints for old/unused fields
        - [ ] test this on the old version of larkin.toml
    - [ ] actually replace javascript behavior with rust functions (replace `dod`)
    - [ ] replace `setFlag` with `updateDefine` (or something like that)
    - [ ] CI
        - [x] setup CI unit tests for rust
        - [x] setup rust coverage
        - [x] setup CI and merge coverage across rust and javascript
        - [X] verify that CI is running and coverage is showing up
        - [ ] check in with CI setup once we get the above tasks completed

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
    - [ ] we need to let TOML language server know about the schema...
        - [ ] https://github.com/GREsau/schemars to export schema
        - [ ] insert '$schema' key into file
    - [ ] use `document.positionAt` to convert spans byte offsets to char and line
    - [ ] https://code.visualstudio.com/api/references/vscode-api#languages
        look for `createDiagnosticsCollection` to create new linting hints
10. Translate selection utility tests to new build setup
11. Get CI working for all tests in selection utilities
12. continue the quest for better test coverage

\u001b[32m✔\u001b[39m Found existing install in /home/runner/work/vscode-master-key/vscode-master-key/.vscode-test/vscode-linux-x64-insiders\n
