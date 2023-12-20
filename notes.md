current issue I'm working on:

- the current cursor position should be used to update the searchFrom
  field when appropriate
- next and previous match should be able to accept count arguments

Next up
- more dogfooding (we need to answer the question: is this working well enough for this implementation to be viable, does it work for my everyday use)

ANSWER: yes, I can use this for everyday work at this point with only minor annoyances

- start implementing event recording / replay for
    record macro
    repeat action
    repeat last pre-action selection
    repeat last selection/action pair

- start dogfooding (wee need to answer the question: post recording is this reasonably
  fast enough)

- require parsing to validate modes to be all negations or all positive mode specifications
- move modalkeys.selectbetween to selection-utilities.selectBetween
- add various selectbetween commands
- add symmetric insert setup and continue dogfooding with the new repeat actions

Testing stuff:

unit tests: test out switching between files
unit tests: search movements
unit tests: command argument validation
unit tests: keybinding validation
unit tests: keybinding insertion (with weird file states)
unit tests: set key state (+validation)
unit tests: expected display of state
unit tests: macro replay
unit tests: duplicate binding handling (especially with the automated keys)
unit tests: captureKeys works as expected, even when you run some other command
unit tests: UX settings change status bar

wishlist:

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


