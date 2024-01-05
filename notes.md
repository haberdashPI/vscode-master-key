current issue I'm working on:

NEXT UP:

for UX tests: we need to make a command that imports the currently open file
as a new preset (this will let us set up UX tests with a given set of bindings)

unit tests: test out switching between files (ensure that cursor is the right shape)
unit tests: search movements
unit tests: command argument validation
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

thoughts: things I must have to release:
- the command palette like feature
- keybinding documentation features
- good documentation of the code
- mode customization
- modernized selection utilities
  - good documentation
  - modern build setup
- improved mode UX
- macro recoridng UX
- anything else that has to be here? (check below wishlist and issues under the project)

**TODO**: in documenting macro playback note the limitations of recording the keyboard
(e.g. that it only records inserts)

**TODO**: anything beyond this point needs to be organized and prioritized

maybe we should implement an edit and a navigation history since the built-in commands aren't particularly satisfying

- require parsing to validate modes to be all negations or all positive mode specifications
- move modalkeys.selectbetween to selection-utilities.selectBetween
- add various selectbetween commands
- add symmetric insert setup and continue dogfooding with the new repeat actions

wishlist:

- ideally we presever the order of bindings, and place prefixes right before
  the first binding that uses them

- validate the arguments to master-key commands so that these come up during import
  of a preset rather than when you run a command

- relax keybinding formatting: right now we require `kind` and `path`
  and in simple uses these shouldn't be necessary; it is also a bit weird
  that there is the empty-name path at the top (perhaps this should be the default,
  and it doesn't need to be explicitly defined)

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
