current issue I'm working on:

- fix bug when merging prefixes:
    sometimes there are additional arguments to prefix 
    so when we create the automatic prefix definitions
    these look different, and a treated as two separate 
    bindings

    working on code in keybindingProcessing.ts, but we need
    to deal with a clear error message that uses the prefix
- more context information available to computedArgs

Next up
- implement a few more of the bindings from modalbindings.js

- start implementing event recording / replay for

    repeat action
    repeat last pre-action selection
    repeat last selection/action pair
    record macro

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
