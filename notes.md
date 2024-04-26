current issue I'm working on:

NEXT UP:

- we can solve problem with global command palette, avoiding the need to filter anything
  with computed args by prepending all prefix commands to the final suffix key (in the
  exported keybindings), we already export a key per possible prefix, so this shouldn't be a
  problem (we'll need to properly handle bindings that can interrupt) so this involves a
  transformation during keybinding processing
  - we should make it explicitly not allowed to have anything *but* a prefix key
    in the format, and have this allow setting of flags or values
    (in this way we prevent visible state changes until the final key is pressed)

- organize commands listed in the palette by:
  - keybinding defined priority (if specified)
  - recently used?? (or maybe this lowers the priority?? could be an option to hide recently used)

UNIT TESTS for palette / and visual binding display

IMPROVE KEYBINDINGS: I have thoughts about how to change my keymap now (maybe prioritize
  any keybinding redesign before doing this)

IMPROVEMENT: once in a pop-up context, you can switch to searching with a command
  (the context palette doesn't actually ever show up right now, and it would be confusing as worded right now anyways)
BUG: commands that change the viewport don't work when activated through the palette
BUG: I noticed that definitions are updated internally on some kind of delay
  (the config updates, but the state has an old value)
BUG: sometimes the state of search always returns to insert (scrutize the code for oldMode resetting)

- add: visualPriority (which overrides the index priority) for
       quick pick (maybe pick a better name)
- add: remove keybinding command
- add: insert default bindings into a new file

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

unit tests: edge cases with recording edits
  - how about when I switch documents?
  - how about when we don't start with normal mode commands?
  - how about long edits with lots of insert mode commands intersprsed with the edits?
  - what about multiple cursors?
  - how do recorded commands interact with the palette?
  - does the command palette show up / not show up with the proper timing?
unit tests: parsing of YAML and JSON(C)
unit tests: store/restore named

REFACTOR: cleanup up and document code, make it nice and readable
REFACTOR: add prettier config and apply new style to all files

thoughts: things I must have to release:
- good documentation of the code
- user documentation
- the command palette like feature: OR
  - make single commands visible in pallet (need to test that this would work!)
  - and have all multi key commands show up in quick picker
    (ideally after some delay)
- keybinding documentation features
- mode customization
- modernized selection utilities
  - good documentation
  - modern build setup
- anything else that has to be here? (check below wishlist and issues under the project)

**TODO**: in documenting macro playback note the limitations of recording the keyboard
(e.g. that it only records inserts; any modifiers are espected to be commands
that are recorded)

**TODO**: fix default expansion for `when` clauses (keep it simple) and add an extra
field e.g. `extend` (or `concat`?) for the fancier situation

**TODO**: anything beyond this point needs to be organized and prioritized

- REDESIGN!! I think the the way repeated keys works is a little unwieldy in many cases
  (maybe we should express it explicitly as a loop somehow...🤔)

```toml
[[bind]]
foreach.i = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
key = "shift+{i}"
name = "count {i}"
command = "master-key.updateCount"
args.value = "{i}"
```

maybe we should

- require parsing to validate modes to be all negations or all positive mode specifications
- add more to symmetric insert setup

EDGE CASE: check that changing keybingings doesn't much with state (e.g. reset mode)

wishlist:

- choose which modifiers to default to in the visual documentation based
  on modifier frequency

- get macro replay working with selection utility commands

- would be nice if each key past the first shows up in a quick pick menu
  rather than just being a separate keybinding

- would be nice if each key sequence that mapped to a *single* command
  could be added as a keybinding full keybinding for that command
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

- maybe there should be a default set of `ignore` bindings for all
  modes but insert and capture; we would need some way to remove these
  bindings if desired

- change capture mode so it accepts all keys it can (and you can define what sequence
  cancels), rather than newlines being always marked as cancel

- quick win: master-key.ignore shouldn't need to be passed to
  master-key.do (we can just call ignore directly)
  -NOTE: the same might be said for `prefix` command

- quick win:
  - let modes change the cursor
  - let modes change line numbering
  - allow modes to specify if they ignore keys?? (instead of manually adding these)

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

- binding validation checks that there aren't non-modifier bindings that
  capture input outside of the text editor
  OR
  all non-modifier keys (k or shift+k) get a condition added to them so they don't mess up input boxes ???

- support multiple keyboard layouts in the visual documentation

- use the theme colors in the visual documentation

quick win: store clipboard to a register

- implement conctext selection-utilities.firstSelectionOrWord (which accounts
  for changes in the primary selection)
  - NOTE: this should also use `master-key.set` when available

enhancement: sneak shows the count required to reach each target
