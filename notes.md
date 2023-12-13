current issue I'm working on:

Next up
- implement some more of the bindings from modalbindings.js
- start dogfooding (we need to answer the question: is this working well enough for this implementation to be viable)

- start implementing event recording / replay for
    record macro
    repeat action
    repeat last pre-action selection
    repeat last selection/action pair

- start dogfooding (wee need to answer the question: post recording is this reasonably
  fast enough)

- require parsing to validate modes to be all negations or all positive mode specifications
- move modalkeys.selectbetween to selection-utilities.selectBetween
- expand to the full keybindings and start dogfooding the current setup

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

wishlist:

quick win: store clipboard to a register
let modes change the cursor
let modes change line numbering
make config import work for both global and workspace settings
