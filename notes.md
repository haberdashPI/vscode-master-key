current issue I'm working on:

repeat last selection
repeat last action 

issue: we need to reify computedArgs using `updateArgs` (written, needs to be tested)

- start implementing event recording / replay for
    X record macro
    repeat action
    repeat last pre-action selection
    repeat last selection/action pair
    save last command to macro

hold on: wouldn't this be easier if I regularized command formats and just made this a truthy clause of any command in the sequence?

- start dogfooding (wee need to answer the question: post recording is this reasonably
  fast enough)

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
unit tests: edges cases for command recording
  - I think it may currently be possible to edit the wrong command
    if a second command is executed in the process of awaiting
    for input from the first (e.g. the input text for search is open
    and a command combination that has a poorly defined when clause
    triggers a new command)

**TODO**: anything beyond this point needs to be organized and prioritized

maybe we should implement an edit and a navigation history since the built-in commands aren't particularly satisfying

- require parsing to validate modes to be all negations or all positive mode specifications
- move modalkeys.selectbetween to selection-utilities.selectBetween
- add various selectbetween commands
- add symmetric insert setup and continue dogfooding with the new repeat actions

cleanup:

- we know transient variables aren't really something we need to expose to the user; from
  their perspective all commands are a unitary thing (`prefix` is a special case, but is
  only employed for documentation purposes on the user side; in principle it could be a no
  op, and multi-key commands could be represented as they normally are in VSCode)

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

enhancement: sneak shows the count required to reach each target

