current issue I'm working on:

- selectLinesDown doesn't handle the empty count properly
- 'o' doesn't switch to insert mode
- cursor appearance gets confused when switching editors

Next up
- more dogfooding (we need to answer the question: is this working well enough for this implementation to be viable, does it work for my everyday use)

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

File format changes:

- use a non recursive format; where we would nest thing before
  use a `path` field. This should be more forgiving when using JSON
  instead of TOML, simplifies validation and zod types, etc...

- replace do.command with command, and use `runCommands` for multiple commands
  to make the format consistent with normal keybindings / one could
  even copy normal keybindings to the file

wishlist:

post prototype phase: get rid of the somewhat crappy/bloated parsing and eval libraries
(that are either poorly maintained, or overkill), and build our own grammar using
https://sigma.vm.codes for both when clauses and computedArgs values and create our own
evaluation compiler

convert zod types in to schema for keybinding validation NOTE: I'm tempted to have a
non-recursive format to make this easier one way to handle that would be to flatten all
keybindings and just have some extra field like "category" that lists the context for it
(this would make default expansion a little trickier); this would also simplify the code
somewhat. It also makes a the file a little more repetitive to write.

quick win: store clipboard to a register
let modes change the cursor
let modes change line numbering
make config import work for both global and workspace settings

- implement conctext selection-utilities.firstSelectionOrWord (which accounts
  for changes in the primary selection)
  - NOTE: this should also use `master-key.set` when available

add to existing future plans:

there is some documentation propagation to handle: e.g. if a binding has the same key
sequence and mode it should have the same documentation, oftne this means that only one such
binding is actually documented. During documentation 
