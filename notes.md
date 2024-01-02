current issue I'm working on:

- file formatting (why: unit tests are blocked by updating formattig, because I don't want to rewrite all tests)
  - start generating some basic unit tests

NEXT UP:

setup unit tests (there's stuff to download here, so would be good to get that going)
- start dogfooding (wee need to answer the question: post recording is this reasonably
  fast enough)

Testing stuff:

unit tests: test out switching between files
unit tests: search movements
unit tests: command argument validation
# TODO: maybe I should be changing the file format *before* writing these units tests
# (sounds less redundant)
unit tests: keybinding validation
unit tests: keybinding insertion (with weird file states)
unit tests: set key state (+validation)
unit tests: expected display of state
unit tests: macro replay
unit tests: duplicate binding handling (especially with the automated keys)
unit tests: captureKeys works as expected, even when you run some other command
unit tests: UX settings change status bar
unit tests: edges cases for command recording
  - I think it may currently be possible to edit the wrong command
    if a second command is executed in the process of awaiting
    for input from the first (e.g. the input text for search is open
    and a command combination that has a poorly defined when clause
    triggers a new command)

    we probably need to take on a more functional style in the commands,
    this would likely require returning both a promise and a result
    (but maybe we can get away with returning something int he promise
    and just await on this result in the final command wrapper)
unit tests: edge cases with recording edits
  - how about when I switch documents?
  - how about when we don't start with normal mode commands?
  - how about long edits with lots of insert mode commands intersprsed with the edits?
  - what about multiple cursors?

REFACTOR: cleanup up and document code, make it nice and readable

**TODO**: anything beyond this point needs to be organized and prioritized

**TODO**: in document macro playback note the limitations of recording the keyboard
(e.g. that it only records inserts)

thoughts: things I must have to release:
- the command palette like feature
- the documentation features
- mode customization
- modernized selection utilities
- improved mode UX
- macro recoridng UX

maybe we should implement an edit and a navigation history since the built-in commands aren't particularly satisfying

- require parsing to validate modes to be all negations or all positive mode specifications
- move modalkeys.selectbetween to selection-utilities.selectBetween
- add various selectbetween commands
- add symmetric insert setup and continue dogfooding with the new repeat actions

wishlist:

- `{defined}` commands should work inside `doAfter`

- insert character can be repeated

- store from history can take a count or it can use a quick pick that lists the name
  of all recent commands and an index that you can then select two indices from
  on for the the start and one for the top of the macro

- expand all keybindings so that they reference a single mode by iterating their modes list
  over all valid modes; this will keep the bindings generated simple, and it will make the
  detection of duplicate bindings simpler and more accurate

- have a debug mode that shows which command got executed from the given keybinding (with an
  option to show or not show prefixes)

quick win: store clipboard to a register
let modes change the cursor
let modes change line numbering
make config import work for both global and workspace settings

- implement conctext selection-utilities.firstSelectionOrWord (which accounts
  for changes in the primary selection)
  - NOTE: this should also use `master-key.set` when available

enhancement: sneak shows the count required to reach each target

