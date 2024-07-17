## Wrapping up unit tests / stability / coverage

NOTE: we may need to add multiple retries to tests, CI should pass every time
if at all possible

NOTE: some bug fixes/stability could be added after we add the feature for markdown documentation

TODO: trouble running tests, try running each one individually

NEW TEST: visual keybinding display
    - TODO: our tracking of `kinds` has been lost somewhere in refactoring
        we need to treat this similarly to the way we treat definitions
        and then pass it on to the visual docs
    - verify that keys with bindings show up and have color
    - verify that keys without bindings show up as blank

BUG: when there are no keys defined the visual keybinding output includes `undefined`

NEW TEST: store/restore named commands

create release 0.1.1

SMALL BUG: should 'esc' really be appended in the status bar since it cancels a prefix sequence... 🤔

unit tests: edge cases with recording edits
  - how about when I switch documents?
  - how about when we don't start with normal mode commands?
  - how about long edits with lots of insert mode commands intersprsed with the edits?
  - what about multiple cursors?
  - how do recorded commands interact with the palette?
  - does the command palette show up / not show up with the proper timing?

create release 0.1.2

unit tests: mode capture
  - cook up some tests `onType` setting of modes
unit tests: parsing of YAML and JSON(C)
  - actually: delete this feature (add it back in later if it feels worth it)

create release 0.1.3

UNIT TEST: verify that larkin can be properly loaded/parsed

TODO: include the basic (non ui tests) in coverage

Key gaps identified by coverage (not listed above):
  - setFlags
  - use of global state in commands
    - `editorHasSelection`
    - `editorHasMultipleSelection`
    - `firstSelectionOrWord`
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

## Visual Documentation Improvements

release 0.2.0 onwards

at the end of this milestone I have documentation sufficient for releasing the extension
in the vscode and vscodium stores

NOTE: `path` entries should not have documentation; rather there should be a separate setup
(perhaps comments?) for how to enter text that becomes part of the markdown output

Visual doc improvements:

IMPROVEMENT: show keybinding tips (for those general commands useful for examining documentation) in the visual documentation
for
  - toggle modifiers
  - toggle cheetsheet
  - toggle visual documentation
  - simple command palette
  - key suggestions

- IMPROVEMENT: show escape/function key row in the visual key doc

write code to convert the toml file to a markdown of organized tables of keybindings
and provide a command that opens the Markdown preview of this file

write up documentation for the default files

DOCUMENTATION: in documenting macro playback note the limitations of recording the keyboard
(e.g. that it only records inserts; any modifiers are espected to be commands
that are recorded)

IMPROVEMENT: upon activating bindings, show the visual and cheetsheet documentation

IMPROVEMENT: put some examples of cool features from `Larkin` in the README

IMPROVEMENT: use `getExtension` or some such on each required extension, and offer to
  install if it fails (does this work for any extension? or does `activate` have to return
  something)

### Binding Cleanup

release 0.2.x

- Split out any of the commands that are really custom for me that don't make sense to publish.
- Pair down some of the required extensions.
- Offer to install extensions? (maybe when a keybinding fails to run??)

### Before VSCode publish

release 0.3.0

thoughts: things I must have to release:
- keybinding documentation features
  - markdown output / html
- well documented default keybindings
+ mode customization
  + have an option to allow a default command
    that operates on all keys that *aren't* specified
    OR that pass a regex
- MODERNIZED SELECTION UTILITIES
  - good documentation
  - modern build setup
+ final design of keybinding file that I'm relatively satisfied with
  + fix the repeat keybindings
  + fix default expansion

WHEN PUBLISHING: get this to work on both stores (the one from microsoft and the one that vscodium uses)

## Future releases

after first release

- speed up:
  - https://www.nicoespeon.com/en/2019/11/fix-vscode-extension-performance-issue/

release 0.4.0

- good documentation of the code
- good documentation of the binding format
- vim style bindings? (I think this could come in a separate release; or just never do it, wait until someone wants it)

release 0.4.x

REFACTOR: add prettier config and apply new style to all files
REFACTOR: cleanup up and document code, make it nice and readable
REFACTOR: change name of test files to be more consistent
REFACTOR: somehow we have to define/organize binding parameters
  in *four* places, should be easier

FEATURE: require parsing to validate modes to be all negations or all positive mode specifications

## Unorganized Improvements

- HIGH PRIORITY: improve error reporting for keybinding files

- once we've improved performance, parallelize the tests more

- test coverage: use selectors to find the text decorations used for search and check their properties

- optimization: most values can be read only, (e.g. definitions) and if we implemented
  these values differently, it would save us some time

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
