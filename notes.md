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
    - [X] pipeline for `[[bind]]` entries
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
        - [X] implement `[[mode]]`
            - [X] implement
            - [X] add to `KeyFile`
            - [X] validate mode in `[[bind]]`
            - [X] add documentation
            - [X] use `Option<Plural<Mode>>` in BindingInput so we can
                    properly resolve to the default mode instead of "default"
            - [X] get existing unit tests working
            - [X] write test cases for error paths
            - [X] write tests for expressions to specify modes
        - [X] move `combinedName` and friends to `combined.name` and friends
        - [X] command normalization
            - [X] flatten all nested `runCommands` calls
            - [X] flatten all `runCommands` at run-time
                - [X] get existing unit tests working
                - [X] add unit tests for recurisve `runCommands` called resolved at runtime
        - [X] check constraints
            - [X] validation that `master-key.prefix` uses `finalKey: false`
            - [X] encode bindings as a vector of key sequences
            - [X] insert `editorTextFocus` for bare keys
            - [X] replace `editorTextFocus` with check for palette context
            - [X] no duplicate keybindings: hash each key prefix & mode & when-clause
                - [X] create a map of valid prefixes
        - [X] implement the `all` functions:
            - [X] `{{all_prefixes()}}/{{not_prefixes(["not_me"])}}`
                - [X] implement method to get statically prefixes
                - [X] implement validation check to prevent the definition of *new*
                      prefixes in an expression
                - [X] register a function for getting `all_prefixes` and `not_prefixes`
                - [X] unit test
            - [X] `{{all_modes()}}`
            - [X] `{{not_modes(["not_me", "or_me"])}}`
        - [X] find low hanging fruit for problems with using 1.0 files / bad fields
            - [X] implement tooling to use different levels (warn/info)
              in error reporting
            - [X] fields that exist in the old but not new (use `#[serde(flatten)]`)
            - [X] review strings for single `{}` braces and warn that `{{}}` are now required
            - [X] others?
    - [X] implement `[[kind]]` (or redesign)
        - [X] add legacy check for kind (since its also in the docs)
    - [X] implement `[header]` section
        - [X] instead of using `.mk.toml`, look for a specific heading comment in the file
        - [X] debug error processing in `keybindings/index.ts`
    - [X] BUG: prefides defined via `master-key.prefix` are not included in
          `all_prefixes`
          - [X] get rid of the `prefixes` field design and instead allow
                a way to express "prefix is X" "prefix isn't X" etc...
                more directly. since this wouldn't be an expression
                it could be during a phase of file resolution that
                already knows about the available prefixes. Like this:
                ```toml
                prefix.anyOf = ["a", "b", "c"]
                prefix.allBut = ["x", "y"]
                prefix.any = true
                # defaults to
                prefix.any = false
                ```
        - [X] validate that the excludes don't contain new prefixes
        - [X] unit tests
        - [X] handle `master-key.prefix` (in this case we need to include
               the last key as a valid prefix)
            - [X] unit tests
        - [X] documentation
    - [X] error handling checks
        - [X] remove spurious line/char positions from expression error messages
            - NOTE: these come from the line and char position in the rhai expression
            which has nothing to do with the line and char position in the parent
            keybinding file
        - [ ] list of individual errors to check on
            - [X] parsing a number that's too large
            - [X] duplicate toml key
            - [X] unmatched `{{` when there are other matches braces before it
            - [X] expression error for expression in an array
            - [X] unmatched `{{` when child of array
            - [X] unresolved expression (and interpolation) in conversion of Value -> BareValue
            - [X] warn about unexpected fields in `[[bind]]` (and others)
                - [X] fix failing tests
                - [X] for `[[bind]]`
                - [X] for `[[kind]]`
                - [X] for `[[mode]]`
                - [X] for `[[define]]`
                - [X] setup a system for passing warnings up through call stacks
                      while still returning a result
                      - [X] using `warnings` args
                      - [X] how do we handle `resolve`? place in `&mut Scope`?
                            or maybe we should create an object that contains scope
                            and pass that to resolve because the name is starting to be misleading
            - [X] invalid regex for `keys` function
            - [X] invalid keybinding strings (modifier and key)
            - [X] layout invariant binding works
            - [X] expression evaluating to non-string value for `key` field
            - [X] unresolved expressions when converting from Value -> toml::Value
            - [X] id field is reserved
            - [X] error in expression of `define.val/command/bind`
                - [X] expression errors in `define.val` show up
                - [X] `command` errors show up
                - [X] `bind` errors show up
            - [X] an expression that isn't `{{bind.[id]}}` for a `default` field
            - [X] undefined `{{bind.[id]}}` reference in `default` field
            - [X] errors in an expression of a `[[bind]]` field point to the field
                - [X] for top-level
                - [X] for docs
                - [X] for combined docs
            - [X] misplaced reference to `{{bind.[id]}}`
            - [X] TOML parsing errors
            - [X] unique kind names
            - [X] args set to non-table value when `command = "runCommands"`
            - [X] `args.commands` being a non-array value when `command = "runCommands"`
            - [X] non string value for `command` inside of `args.commands`
            - [X] `skipWhen` present for `command = "runCommands"` for an element
                  of `args.commands`.
            - [X] args is a non array or table value for a sub command of `runCommands`
            - [X] non table or string value for an array element of `runCommands`
        - [X] review coverage to verify there aren't additional checks we're missing
        - [X] test that all error messages show up when expected
        - [X] make sure a range is always provided
        - [X] integration test for both warnings and errors in type script setup
            - [X] get it working in debug
            - [X] update tests
            - [X] debug unreliable test outcomes
    - [X] validate modes to ensure that at least one of them allows the user to type 😬
    - [X] refactor and cleanup rust code
    - [ ] proper conversion to keybindings.json command
        - [X] expand per mode and prefix (e.g. each binding has one mode and one prefix)
        - [X] encode prefixes as prefixCode in when clause
        - [X] move mode to when clause
        - [X] generate all binding outputs in file object
        - [X] unit tests for binding output generation
        - [X] copy over remaining documentation from parsing.ts and delete parsing.ts
        - [X] review existing binding resolution logic to make sure we didn't miss
              something (particularly around prioritizing/ordering bindings)
        - [X] incorporate a write `BindingOutput` to keybindings.json into ts workflow
            - [X] implement `requiredExtensions` field
            - [X] handle implicit bindings for mode definition
                - [X] the bindings for `whenNoBinding = 'ignoreLetters'`
                - [X] the bindings for `whenNoBinding.useMode`
                - [X] unit tests for ignore letters
                - [X] unit tests for useMode
            - [X] implement `items` to output the actual bindings
            - [X] don't use `getter_with_clone` for `KeyFileResult` (it doesn't really make
        - [X] add warnings for unknown fields in `[[define.bind]]` and `[[define.command]]`
        - [X] check for extra fields in `runCommands` arguments
        - [ ] re-implement master-key.do and master-key.prefix
              sense)
            - [ ] figure out how to handle ts/rust statement management
                - [ ] keep command queue in rust
                - [ ] probably copy simple state data to rust, duplicate
                      in ts for now (avoid churn)
                - [ ] move all bare variables in an expression to `key.` or `code.` object
                - [ ] maybe handle state passing between commands with rust scope
                      object??
            - [ ] properly handle command queues (now controlled by rust)
                - [ ] guess: don't have special command queue field
        - [ ] update unit tests
        - [ ] update integration tests
        - [ ] new unit tests?
        - [ ] new integration tests?
    - [ ] implement `replay`: use the new rust command queues instead of the old
          state management
    - [ ] replace `setFlag` with `updateValue` (or something like that)
    - [ ] reimplement other currently commented out files
    - [ ] start using the latest version to catch performances issues and bugs
    - [ ] properly handle user keybindings (have the main keybinding file in memory)
    - [ ] extraction of markdown docs
        - [ ] documentation expansion/validation
            - across all `[[bind]]` values with the same key and mode
            - across all combined bindings
        - [ ] extract all comment regions (exclude `#-`)
        - [ ] replace `[[bind]]` regions:
            - [ ] identify each non-comment region, and look for parsed elements
                  whose span overlaps
            - [ ] convert any bind elements in this overlap into markdown table
    - [ ] extraction of visual docs
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
        - save these for after the PR migrating for rust refactoring is merged
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
9. Translate selection utility tests to new build setup
10. Get CI working for all tests in selection utilities
11. continue the quest for better test coverage if necessary
