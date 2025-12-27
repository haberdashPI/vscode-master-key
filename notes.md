Integration test debugging:
- [X] github action caching works
    - [x] close, still working on exact naming and handling of directories so things actually cache
    - [X] https://github.com/haberdashPI/vscode-master-key/pull/74/commits/d8eac66226fa1b8316156404c6f5f16d08a65cd6 should have been a cache hit
    - [X] check that things are actually getting cached across CI runs
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
        - [X] list of individual errors to check on
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
    - [X] proper conversion to keybindings.json command
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
        - [X] re-implement master-key.do and master-key.prefix
              sense)
            - [X] figure out how to handle ts/rust statement management
                - [X] methods to produce literal commands (and repeat) in rust
                - [X] re-implement `prefix.ts`
                    - [X] pass the key_id from `do` command on to the
                          call to prefix
                - [X] remove key string in arguments to do / prefix and use
                      the other data already available in memory (rather than re-parsing)
                - [X] simple `do` implementation using above features
                - [X] get activation events / default mode conditions working properly
                - [X] figure out why the mode sticks to `default` when the true default is `normal`
                    - [X] after activating bindings
                    - [X] when first activating the extension
                        - [X] is this just that debug sessions have a unique config?? NO
                        - [X] it was an issue with workspace settings overwriting global
                              (all storage of config now goes to global, and we've
                              deleted the old state)
                - [X] fix bug where the `bindings` global variable is not up-to-date
                      with the activated keybindings
                - [X] fix bug where count doesn't exist
                - [X] fix bug where count is not reset until after
                      the end of the subsequent command (hit 3 and move left
                      twice and you will move left 3+3 spaces instead of 3+1 spaces)
                - [X] fix bug where motion doesn't happen on very first key press
                    - [X] this is because `prefixCode` is off
                          (I think checks for prefixCode == 0 can just be changed to check for !prefixCode since 0 is falsey)
                - [X] test parsing/validation on integration test files
                    - [X] fix textdoc, visualdoc and simplemotions
                    - [X] figures out why, when there are duplicate keys, no bindings
                      are generated
                - [X] integration tests (some of these exist already)
                    - [X] basic commands with no prefix can be run
                    - [X] commands with implicit prefix
                    - [X] commands that store state
                - [X] verify (after recompilation) that `tab/enter/space` are
                      part of "all_characters()".
                - [X] warn about unknown variables in files
                - [X] copy simple state data to rust
                    - [X] call `set_value` inside state updates
                    - [X] move all bare variables for editor info to `code.` object
                    - [X] move remaining state to `key.`
                        - [X] move `code.` values to a separate place
                        - [X] store the state as `key.`
                    - [X] update all keybindings files with this change
                    - ~~unit tests for these variables~~: not worth it
                      this requires an integration test (and I want to minimize those), and most of these outcomes will
                      be tested in various other ways
                - [X] add implicit `capture` mode (do not let users define it)
                - [X] handle command history
                    - [X] keep command queue in rust
                    - [X] guess: don't have special command queue field
                    - [X] update history in `do` implementation
                    - [X] handle 'cancel' commands
                        - breadcrumbs: in commit kryluuwr there is a check for 'cancel'
                          we need to figure out where this is set
                        - notes: cancel is used at the `command` level to
                          cancel when repeat is < 0. Cacnel at the args level
                          is used to trigger the cancel flag in the command loop
                - [X] get basic key press integration tests working
                - [X] integration tests for master-key.prefix
                - [X] handle commands that have arguments which need to be resolved
                      part-way through a command sequence (e.g. `{{key.captured}}`)
                    - [X] write integration tests for accepting commands
    - [X] get keyseq.ts working again
    - [X] implement `replay`: will use the new rust command queues
        - [X] implement API for VecDeque in rhai that includes `find_last`
        - [X] setup replayMotions.toml
        - [X] update replay.ts
            - [X] for `KeyFileResult`
                - [X] implement `commands_at`
                - [X] implement `push_macro`
                - [X] implement `get macro`
                - [X] implement `runCommands`
                - [X] rethink the logic for how we use mode status to record edits
                    (it's the mode we have at the *end* of the command that matters
                     for recording edits, separate from the mode the command was called in
                     which could matter for history queries)
                - [X] implement `is_recording_edits_for`
                    - [X] implement config option for this maximum (`CText History Maximum`)
                    - [X] limit amount of text that gets stored per command;
                          sane macro use-case does not require huge amounts of text to be
                          saved
                - [X] implement `store_edit`
            - [X] fix design of `last_index_of`:
                - as is this leads to a data race in rhai, since we have
                  to reference `history` inside of the closure while calling
                  a function of that object (and both of these have to be mutable
                  because that's what Rhai requires)
            - [X] setup getters for RefifiedBinding
            - [X] getting error about rust type aliasing; probably
                  that I can't pass the history objects around
                  (there are some workarounds I could use here, e.g.
                   using the indices)
        - [X] integration tests
            - [X] basic motions
            - [X] direct history replay
            - [X] count replay
            - [X] skipWhen replay
            - [X] search replay
                - [X] normal
                - [X] canceled
                - [X] acceptAfter
            - [X] captured keys
                - [X] normal
                - [X] canceled
            - [X] repeat replay w/ count
            - [X] nested replay
    - [X] debug prefix setting
        - [x] e.g. for manual "d w" the prefix is set to 7 but no bindings are defined
          for the id 7 (this is probably about automated version of bindings having
          different ids, and we're referencing those, even though we only keep the non-automated bindings)
          - while the output looks reasonable in the binding file, even though the
            id there is 14, we get an id of 7 in `toRun`
          - interestingly 7 *is* the command id, so I'm guess there's a bug there somehow
          - [X] properly get the id
    - [X] debug excess prefix definitions
        - [X] e.g. in simple motions we are getting a prefix definition for "d w"
              (should only get "d")
              - [X] write a test for this and bisect the file contents
                - AH HA!: this comes from using `prefixes.any`: we need to avoid
                  any prefixes that are actually finalKey presses
              - [X] write a test
                - it should demonstrate that when use have `prefixes.any`
                  only `finalKey = false` bindings show up
              - [X] get the test to pass
        - [X] check that `prefixs.anyOf` does not overwrite an existing binding
    - [X] debug multiple explicit prefixes
        - seems like it isn't quite setting up the right bindings in this case
        - [x] test a simpler case: prefixes.anyOf = ["a", "b"] where "a" and "b" are
          path explicitly defined
            - the problem seems to be that the fallback prefix rather than the
              specific explicit binding is used; it's not clear I should merge them
              in all cases (e.g. the when clause could be different); but
              how do we handle this?
              (the bug may be specific to the case where we have `when` defined as a
               non default value)
            - but actually there are some interesting interactions here, because
              a more MWE doesn't reproduce the issue (this is somehow interacting with
              the problem I'm seeing above with excess prefix definitions)
            - okay, I've found my MWE
        - [X] propagate usage of prefix code vs. key code through out codebase
        - [X] review outputs in debug to understand what is still going wrong with prefix for "shift+j"
    - [X] probably remove some cases where we store `key_id`: it isn't
            needed post binding output generation anymore (just `prefix_id`)
    - [X] reimplement stored commands (to handle vim bindings)
         - [X] implementation
         - [X] unit tests
         - [X] test with `runCommands`
            - [X] debug error when using `runCommands`
         - [X] test replay of stored commands
    - [X] replace `setFlag` with `updateValue` (or something like that)
        - [X] implementation
            - [X] define function api
            - [X] implement tooling in rust to set a `define.val` that already exists
            - [X] implement setup to add `val.` variables to context
        - [X] write tests
            - [X] unit test that calls `setValue` and then uses `executeStored`
                  to evaluate the variable in real time
            - [X] debug parsing of commands passed to `do_stored_command`;
                  they don't seem to be picking up expressions as a thing
                  (I guess this sort of makes sense, we probably need to
                  specifically handle that conversion, since it isn't
                  being deserialized from a string)
                - very confused: seems like even when I have a good `BareValue`
                  the expressions aren't picked up ???
    - [X] document macro / history values for expressions
    - [X] proof-read documentation
    - [X] parse and dog-food larkin
        - [X] fix issue with missing foreach variables
        - [X] fix issue with unexpected `{{` in multiline strings
        - NOTE: it's kind of incredible that there were so few errors here 🎉
        - [X] we're missing key presses: it looks like sometimes the last mode is a little
            "sticky" (e.g. I tried to hit "i" in insert mode and it instead selected
             an indent region, as if I had hit "m i"; maybe I had hit m???)
             it can take a *while* for the missed key presses to go away
             it seems like there is a substantial delay in when we stop missing presses
             (it could be that the context is slow to update here but it could also
              be that there is some state that eventually "errors" out after
              being in insert mode for long enough and then the presses work)
              - ideally we find a way to reproduce this in an integration test first
              - inspect context a few times during this time period, then review in console
                do we see anything weird with the master key context
              - maybe we need to make the 'mode' state special and have it in
                a separate context value as well?? (maybe the large object)
                that is present for `key.` leads to the sluggish behavior
              - that said I think the best hypothesis is something pathological
                about how context state is set that would impact what bindings get triggered
            - OKAY: the problem is that escape requests it accept all prefixes
              *and* it can occur in insert mode. This creates a bunch of
              additional prefix bindings; I this completely explain
        - [X] ignore keys should work as expected when there's an existing prefix
              (that is, they should clear the prefix not leave it untouched)
        - [X] we can't use `contains` on `.tags`
            - [X] implement a getter
              - NOTE: I think we should just make this `Vec<Dynamic>` and make sure `wasm_bindgen` ignores it (DONE!)
            - [X] DEBUG: we don't see errors now, but we also don't select anything
                - [X] let's improve debugging ergonomics of expressions for everyone
                    - [X] add field to `CommandOutput` that is a list of `info` messages
                    - [X] add messages to list of warnings during parse time
                    - [X] ensure that TS code prints these messages
                    - [X] unit tests for writing messages in expressions
                    - [X] integration test
                    - [X] document
                - AH HAH!: the problem is that coalesce is not resolved
                  to a constant value when default values are merged,
                  and `coalesce` a typed value doesn't have a notion of
                  emptiness. Options
                - [X] coalesce still doesn't work through multiple default layers
        - [X] we can't use symmetric insert commands (something about how we serialize
              string arrays to rhai is wrong I think)
        - [X] escape or `ctrl+[` isn't leaving capture mode
        - [X] syminsert isn't capture key presses
            - [X] implemented command execution
            - [X] debug `resolve` failures (is there something I'm not doing that occurs in e.g. do_command, which `resolve` assumes has already happened?)
            - [X] create an integration test
        - [X] highlighting ins't resetting when using search
        - [X] code.firstSelectionOrWord isn't picking up things near the cursor
            (sometimes?? it's working now... 🤔)
        - [X] `captured` doesn't have a `slice` function (selecting between characters)
        - [X] error messages not showing up
        - [X] tree commands aren't changing the mode properly
        - [X] hit error with repeat history where we had null
              but were expecting bool (3-value logic doesn't seem
              to exist?)
        - [X] are there performance issues?
            - possibly: though I'm mostly seeing this on remote connections where
              a flakey connection could be the best explanation
            - however: it's possible there is some cumulative issue where the performance
              is somewhat slow for `master-key.do`, and this only has an impact
              on a a slower connection where the latency of ssh communcation *combined*
              with do execution leads to an unacceptable latecy for user interaction
            - best approach here is to get a profile of the extension; I've created
              a task below for this
        - [X] we occasionally get stuck in a weird state where escape doesn't work
            - I think this is about the slowness of master-key.do command execution
              on a remote worker. Will need to do the work above first to know better
        - [X] after visual documentation commit we fail to load proper modes
              (something about config loading is going wrong here I assume; checksum?)
              - [X] see if the current integration tests for configuration pick up on this (NO)
              - [X] ideally get an integration test that picks up on this if it doesn't exist (NOPE; too hard, not worth creating)
              - [X] fix the problem
                - [X] determine conditions where config fails to load
                    - only triggers in non-debug context, we'll need to add some console.log statements to see what is happening when the
                    extension is running in production
    - [X] extraction of visual docs
        - [X] reimplement visual output
            - [X] create a map of keys-mode-prefix -> name, description, kind
            - [X] reimplement checks to send this info to the webview when any of these change
        - [X] test/out and debug re-implementation
            - [X] base view works
            - [X] bug: some prefixes are swapped (e.g. q and space are swapped)
                  NOTE: tracing through, an initial run through
                  the bindings seems to correctly assign things
                  but then we loose it; it's not that the same keys are
                  swapped though, we loose e.g. '23:normal'. I think some
                  of the prefix_id's are probably messed up (e.g. maybe
                  23 means 'space' and some other prefix code also means space?)
                - AH HAH: the file gets parsed twice and this leads to
                  distinct prefix codes. I'm not quite sure why, but I
                  think this is probably because it somehow depends on
                  the order of things in a hash map (which is not stable
                  from parse to parse).
                - [X] we probably only want to parse once, this is needless
                    effort
                        - [X] we've found one duplicate parsing culprit, a failed
                          cache operation
                        - [X] but we can't as easily get around a `useBinding` hook,
                          since there are a variety of reasons the config file
                          might update for which we should update the bindings
                          (e.g. changes from another machine). We want to
                          be able to hash the key file and use that
                            - we started to implement hash for the parsed structued
                            but we should undo that work and just compute a hash
                            of the toml file. that's easier to implement and
                            probably the better strategy anyways
                - [X] we probably want to avoid depending on the hash
                      order
        - [X] reimplement integration tests
    - [X] show documentation button isn't working!
    - [X] reimplement palette
        - [X] get display working
        - [X] get key presses working
        - [X] get command selection working (in search mode)
        - [X] get integration tests working
            - [X] command "w w" is missing the prefix binding 🤔 (bug in binding outputs)
                - [X] narrow down to simple MWE
                - [X] debug and fix
            - [X] palette shows up with explicit command
            - [X] palette can switch modes
            - [X] palette shows up automatically after delay
    - [X] extraction of markdown docs
        - [X] extract all comment regions (exclude `#-` or include `##`) and assign line numbers (byte offset?)
        - [X] assing `[[bind]]` line number (byte offset?)
        - [X] in rust pass comments and bindings in grouped sections, by line number (or offset?)
              (e.g. comment + all bindings that follow before next comment)
        - [X] unit tests in rust
            - [X] include examples of using `combined` keys both within sections
                  and across sections (where they shouldn't be combined)
        - [X] cleanup up keybindings in javascript
        - [X] continue reviewing documentation output for formatting errors
            - [X] the yaml header is ugly
            - [X] make sure sections are defined so they have anchors
            - [X] need more padding for quoted content
            - [X] sometimes there is no `<key>` tag between keybindings
                - [X] I think we need to escape `\` characters
                - [X] double check
            - [X] sometimes the prefix isn't shown
                - [X] I think we need to escape `\` characters
                - [X] there are still more missing, review the source
            - [X] sometime there are new lines that muck with the table formatting
        - [X] implement a simple integration test (verify that the docs show up)
            - [X] write code
            - [X] run/test
    - [X] cleanup any files we need to delete
    - [X] misc. cleanup
        - [X] fix bug in replay of insert actions
        - [X] replay symmetric edits
            - [X] write an integration test
            - [X] implement recording of intercepted commands
        - [X] fix bugs that come up with the first, activating key press
            - [X] refactor all command definitions out from module's `activate` function,
                  and only define the commands after all activation functions have been
                  called
            - [X] the config module for keybindings also probably needs to
                update bindings in a second phase
            - [X] does the fix resolve these symptoms
                - [X] multi-key sequences often fail in this case (shows up in integration tests as well as my personal interactions)
                    - this depends on handling multi-key bindings differently
                      prior to activation I think: they delay during activation
                      is going to be pretty hard to avoid. This is
                      a fair bit of work and not in scope for the current PR I think
                - [X] sometimes the variable `code` is not yet defined
                - [X] these are possibly symptomatic of the same problem that variable
                    state is not entirely up and going until the extension is activated
                    - I've resolved the `code` issue, and eliminated this by refactoring
                      the code. Still have the multi-key sequence issue
        - [X] when the first binding changes the mode to `capture` we can't hit escape
              to cancel the command
            - NOTE: turns out its a little more complicated. What happens when pressing
              `space t`, for instance, is that both "space" and "t" bindings trigger,
              causing the state of both *prior* to setting a prefix to occur. ESC no longer
              works because `SPACE` isn't a valid prefix and we're waiting for a key to be
              entered because we're in the `capture` mode
            - possible solutions:
                - can the commands that set prefixes always be separate?
                  would this speed things up enough?
                - [X] prevent the second key press from registering
                - wait to register the second key press, changing course
                  for which binding it is registered as if the prefix has changed
                  (sounds complicated)
                - have non-activated bindings (check mode is not set) that
                  include the full key sequence; these would have to copy
                  over any commands defined during a master-key.prefix call
            - [X] fix bug: we need to know what prefix was *intended* when
                  running the given command, so we need to copy the prefix
                  specified in the binding to an argument of `master-key.do`
                  so we can compare that to the current value of PREFIX_CODE
        - [X] pasting with `space shift+p` fails, I think because the suggestion
              palette has captured focus. We want to clear the palette as soon as
              a binding is run rather than later on in the call to `doCommandCmds`.
              We probably want something like `triggerCommandStartedHooks`
              (or maybe we just need to move `registerPaletteUpdate`)
        - [X] locking keys while something runs is actually annoying,
              because some commands take a while to run (Enter to run julia
              via the extension)
        - [X] palette's "binding mode" ins't working with the latest version of
              VSCode
            - [X] replace with tree view (it's more reliable and probably a better UX)
            - [X] update the integration tests (should be simpler now)
        - [X] refactor locking code; it's similar and messy across the
              three binding commands (do, ignore and prefix)
        - [X] update the image of the suggestion palette
        - [X] delete `keybindingPaletteOpen` and related context variables (they are no
          longer needed)
    - [X] install latest version on my pet
    - [X] wait a day or two: if this adds items under misc. cleanup, keep waiting
    - [X] verify that an older setup will cause the extension to flag an error
    - [X] merge PR
    - [ ] release new version on both extension stores
    - [X] CI
        - [x] setup CI unit tests for rust
        - [x] setup rust coverage
        - [x] setup CI and merge coverage across rust and javascript
        - [X] verify that CI is running and coverage is showing up
        - [X] update unit tests for running commands
            - [X] remove replay unit tests (they are become integration tests)
            - [X] move the missing do unit tests to integration
        - [ ] integration tests take a long time to run;
            - [X] ideally we reduce or combine some of the tests
            - [ ] ~~maybe run a separate set in a nightly test~~
        - [X] run the tests in CI
            - [X] get unit tests working for `mise build --web` again
            - [X] make sure `mise build --web` is run for `mise package`
            - [X] improve flakey tests (or skip some???)

Follow-up:
- [X] update README view of key suggestions (out of data with new section headings)
- [X] generate literate docs for each preset within the documentation website
- [X] release 0.4
- [X] automated upload the extension to marketplaces
- [ ] improvement doc display and content
    - [ ] fix larkin docs on webset to use pretified, `<key>`ified key bindings
    - [X] prettify docs for inline docs is not using unicode chars
    - [X] revise the larkin literate docs to make it more beginner friendly
        (include less in basic motions and move basic actions higher up, so
        all of the basic commands can be see at a glance)
    - [ ] proof-read larking docs
    - [ ] fix section headings
- [ ] organize additional priorities before release 1.0 (including the below follow-ups)
- [X] make a command that activates the current file directly
- [ ] make some features more discoverable
    - [x] create "tour" section for vscode's start window
    - add a button to edit a copy of a binding file from the activate binding menu
        - make sure editing is prominently in the documentation for Larkin
          (and an future binding files)
        - make sure it is prominently in the getting started section
- [ ] visual documentation improvements
    - [X] the visual documentation could show a hint about the command
    to toggle between binding modifiers (and show the default key binding)
    - [X] currently keybindings are sorted from highest to lowest frequency
    modifiers across all modes. This should really be a feature per mode,
    so that the most relevant bindings for a given mode are visible
    immediately.
    - [ ] visual documentation could highlight the most recently pressed
    key in the same way that status bar shows the most recently pressed binding
- [ ] improve key suggestions
    - [X] use section headers (and their level) to create tree for the key suggestions
    - [ ] add command to search and filter the key suggestions
- [ ] rename from Master Key to Key Atlas (keep the same extension name, to avoid
    confusion, but do make a new git repository)
    - [ ] I should wait until I'm ready for a larger audience before renaming
    - [ ] rename references of Master key in Selection Utilities
- [ ] reimplement storeNamed? (or make it more specific to macros; I'm not
    convinced the generic tool is really useful)
- [ ] implement binding feature `source` which adds an existing predefined
      binding set to the current binding set. (this will replace the user
      binding features)
- [ ] profile mater-key.do performance
    - [ ] define separate bindings for multi-keys when there is no mode defined
        - these bindings are for the entire sequence, not each key separately
        - we loose the ability to show a pop-up menu (for the first keybinding only)
        - but we avoid errors in the execution of the very first binding
        - not clear this is the right trade off yet 🤔
- [ ] insert accepts a count: replicating vim's behavior
    - [ ] this probably needs to be per mode configurable

- [ ] update extension utilities
    - [ ] TODO: decorators aren't working
    - [ ] migrate to the same build and test setup
    - [ ] get tests working again
    - [ ] get CI working
