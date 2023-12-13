current issue I'm working on:

- make it possible to reference commands defined under `define`

Next up
- require parsing to validate modes to be all negations or all positive mode specifications
- implement some more of the bindings from modalbindings.js

- start implementing event recording / replay for
    record macro
    repeat action
    repeat last pre-action selection
    repeat last selection/action pair

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

NOTE: ages from now I want to make config import work for both global and workspace settings
