current issue I'm working on:

look at unit test list below

NOTE: we're using a revised version of vscod-extension-tester (https://github.com/redhat-developer/vscode-extension-tester/pull/1084) after fixing a bug on MacOS ARM

NEXT UP:

unit tests: search movements
unit tests: capture keys
  works even even when you run some other command
unit tests: macro replay
unit tests: command argument validation
unit tests: keybinding insertion (with weird file states)
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
+ improved mode UX
- macro recoridng UX
- anything else that has to be here? (check below wishlist and issues under the project)

**TODO**: in documenting macro playback note the limitations of recording the keyboard
(e.g. that it only records inserts)

**TODO**: fix default expansion for `when` clauses (keep it simple) and add an extra
field e.g. `extend` (or `concat`?) for the fancier situation

**TODO**: anything beyond this point needs to be organized and prioritized

- REDESIGN!! I think the the way repeated keys works is a little unwieldy in many cases
  (maybe we should express it explicitly as a loop somehow...🤔)

```toml
[[bind]]
for.i = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
key = "shift+{i}"
name = "count {i}"
command = "master-key.updateCount"
args.value = "{i}"
```

maybe we should implement an edit and a navigation history since the built-in commands aren't particularly satisfying

- require parsing to validate modes to be all negations or all positive mode specifications
- move modalkeys.selectbetween to selection-utilities.selectBetween
- add various selectbetween commands
- add symmetric insert setup and continue dogfooding with the new repeat actions

wishlist:

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

- status bar updates are called a lot, maybe reduce this

- layred keybindings: you can specify a
  - user binding file
  - workspace binding file

- quick win: should be able to specify that a key works in all modes

- status bar updates are called a lot, maybe reduce this

- users should be able to populate their own bindings file with one of the existing
  presets as to serve as a starting point

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

- have a debug mode that shows which command got executed from the given keybinding (with an
  option to show or not show prefixes)

- binding validation checks that there aren't non-modifier bindings that
  capture input outside of the text editor

quick win: store clipboard to a register

- implement conctext selection-utilities.firstSelectionOrWord (which accounts
  for changes in the primary selection)
  - NOTE: this should also use `master-key.set` when available

enhancement: sneak shows the count required to reach each target
