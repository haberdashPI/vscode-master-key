## Binding Cleanup

release 0.2.6

+ feature: specify user-specific binding file, apart from activated keybindings
+ Split out any of the commands that are really custom for me that don't make sense to publish.

- FIX: visual keybindings do not update after config updates

- maybe actually setup tests for all the new stuff in keybindings/index.js??
    + load presets list from directory
    + load preset from file
    + checks for user bindings: wip
      + we can add them
      + we get an error if there are no preset bindings
    + checks for handling duplicate file names
    + copy preset into file
    - copy user config into file
    - test required extension installation

Binding changes in Larkin:
+ maybe avoid need to use cmd-v so much
- remove all my extra settings in my own config file
- insert QOL I loose from that into larkin (or masterkeys.toml, as needed)
    + up/down page
    - escape / shift-escape?

## Trailing fixes

Working with release 0.2.6 for a while and make sure there aren't any more bugs to fix

## Before VSCode publish

release 0.3.0

thoughts: things I must have to release:
+ keybinding documentation features
  + markdown output / html
+ well documented default keybindings
+ mode customization
  + have an option to allow a default command
    that operates on all keys that *aren't* specified
    OR that pass a regex
+ final design of keybinding file that I'm relatively satisfied with
  + fix the repeat keybindings
  + fix default expansion

WHEN PUBLISHING: get this to work on both stores (the one from microsoft and the one that vscodium uses)
- https://github.com/eclipse/openvsx/wiki/Publishing-Extensions

## Stability / test coverage

SMALL BUG: should 'esc' really be appended in the status bar since it cancels a prefix sequence... 🤔

SMALL BUG: I think there are issues when synching across machines and handling
storage of the keybindings

NEW TESTS: keybindings
- tests for running various binding commands
- tests for selecting bindings
- tests for selecting extensions?

NEW TEST: store/restore named commands

unit tests: edge cases with recording edits
  - how about when I switch documents?
  - how about when we don't start with normal mode commands?
  - how about long edits with lots of insert mode commands intersprsed with the edits?
  - what about multiple cursors?
  - how do recorded commands interact with the palette?
  - does the command palette show up / not show up with the proper timing?

create release

unit tests: mode capture
  - cook up some tests `onType` setting of modes
unit tests: parsing of YAML and JSON(C)
  - actually: delete this feature (add it back in later if it feels worth it)

create release

UNIT TEST: verify that larkin can be properly loaded/parsed

TODO: include the basic (non ui tests) in coverage

Gaps in coverage:
  - setFlags
  - use of global state in commands
    - `editorHasSelection`
    - `editorHasMultipleSelection`
    - `firstSelectionOrWord`
  - visualKey
    - toggling modifier keys
  - testing filter of bindings for palette
  - test configuration editing
    - copy
    - remove
    - copy from user / default config
  - commands
    - usage of `if` field
    - error for malformed `repeat` expression
    - macros: recording and replaying edits
      - nested macros??
    - empty search string
    - premature end of capture and search using enter
    - escaping a search
  - basic validation of visual search (we can inject css ids to make this easy)

## Future releases

after first release

release 0.3.x

code-reading QOL

- MODERNIZED SELECTION UTILITIES
  - modernized command documentation
  + modern build setup
  - some basic UX tests
  - 1.0 release

- good documentation of the code
- good documentation of the binding format
- vim style bindings? (I think this could come in a separate release; or just never do it, wait until someone wants it)

release 0.3.y

REFACTOR: cleanup up and document code, make it nice and readable
REFACTOR: change name of test files to be more consistent
REFACTOR: somehow we have to define/organize binding parameters
  in *four* places, should be easier

FEATURE: require parsing to validate modes to be all negations or all positive mode specifications

## Unorganized Improvements

- HIGH PRIORITY: improve error reporting for keybinding files

- coding qol: don't require updates to define what state variables are "public"

- performance: exclude more state properties from getting stored
  as context values

- once we've improved performance, parallelize the tests more

- test coverage: use selectors to find the text decorations used for search and check their properties

- a command to repair keybindings getting out of sync with the activated bindings
  ID

- have backspace and enter run commands in capture mode

- IMPROVEMENT: add command to delete all but primary selection in selection utilities

- idea: we want the default mode (which can be set by the user)
  to require no when clause for it; in this way
  we can activate the extension on the first relevant keypress
  - whenever we do this we'll need to properly handle `keybindingPaletteOpen`
  (does a failure for this context to exist cause the when clause to fail
  even if it is inside an ||, I think it does)
  - each key will need to check for activation of the extension (e.g. using a context)
    and a separate version of the keybinding without this context or a mode check
    can implementing the binding when the extension isn't active (and do this
    for *only* the default mode bindings)

- make it possible to navigate by indent

- careful optimization: clean up code to do fewer dumb repetivie things
  that slow down performance

- unit tests for visual doc?? (what would this even look like?? sounds time consuming
  and not very much gain would be had)

- place frequently used commands near the bottom of the command palette

- get macro replay working with selection utility commands

- reduce the commands that have to be excluded from the global command palette

- would be nice if each key sequence that mapped to a *single* command
  could be added as a full keybinding for that command
  with a `when` clause that is never true; that way
  all single commands that are mapped can be looked up
  using the command palette. NOTE: this might not work
  because it could interfere with mappings that use shorter key
  sequences (e.g. I think VSCode might just sit around waiting
  for the subsequent keys, even if the binding doesn't apply??
  will have to check this)

- quick win: we really shouldn't allow macro recording inside of macro recording
  unless this is what a user explicitly requests, by default calling
  macro recording commands in this way should raise an error
  (it is an easy mistake to make when specifying the range of command to store
   on the stack when defining a keybinding)

- implement an edit and a navigation history since the built-in commands aren't particularly satisfying

- maybe the parse errors can be added to the problems window? (and just have one error
  message for all problems)

- change capture mode so it accepts all keys it can (and you can define what sequence
  cancels), rather than newlines being always marked as cancel

- quick win: master-key.ignore shouldn't need to be passed to
  master-key.do (we can just call ignore directly)
  -NOTE: the same might be said for `prefix` command

- status bar updates are called a lot, maybe reduce this

- layred keybindings: you can specify a
  - user binding file
  - workspace binding file

- users should be able to populate their own bindings file with one of the existing
  presets as to serve as a starting point

- validate the arguments to master-key commands so that these come up during import
  of a preset rather than when you run a command

- relax keybinding formatting: right now we require `kind` and `path`
  and in simple uses these shouldn't be necessary; it is also a bit weird
  that there is the empty-name path at the top (perhaps this should be the default,
  and it doesn't need to be explicitly defined)

- `{defined}` commands should work inside `runCommands`

- insert character can be repeated

- store from history can take a count or it can use a quick pick that lists the name
  of all recent commands and an index that you can then select two indices from
  on for the the start and one for the top of the macro

- have a debug mode that shows which command got executed from the given keybinding (with an
  option to show or not show prefixes)

- support multiple keyboard layouts in the visual documentation

- use the theme colors in the visual documentation

quick win: store clipboard to a register

- implement conctext selection-utilities.firstSelectionOrWord (which accounts
  for changes in the primary selection)
  - NOTE: this should also use `master-key.set` when available

- make it possible to render some subset of the keybindings on a keyboard
  in the cheetsheet documentation

enhancement: sneak shows the count required to reach each target
