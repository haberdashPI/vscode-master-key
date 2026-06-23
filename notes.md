## Merge File

notes: the trickiest bit will be providing useful errors for duplicate bindings that
span across the source file and the current file; this is probably where we
want to replace `Span` with something like `(Source, Span)`

- [X] split out the changes for `define`, we should implement/test them later
- [ ] get the merge working for `[[bind]]` entries first
    - NOTE: we want to turn keybinding conflicts in the source into info
      messages, not errors: It is natural that these might be changes in a
      new binding set
    - [X] initial implementation
    - [ ] create simple unit tests for the `[[bind]]` merging
- [ ] implement `[[define]]` merge
    - [ ] test it
- [ ] implement `[[mode]]` merge
    - [ ] test it
- [ ] implement `[[kind]]` merge
    - [ ] test it
- [ ] ask gemini to setup some additional unit tests
- [ ] index source files based on their name, so that they can be referenced
    - [ ] remind myself how KeyFile's are current stored, is the some redundancy we
          can avoid?
    - [ ] setup indexing (handle collisions)

- [ ] in a separate PR implement sourcing from a local file? (think about how this should actually work...)

## Vim Repeat Debug

- [X] we're getting some kind of error trying to repeat actions (looks like an untested edge case)
    - [X] fix getter for `commands[i].command`
    - [X] D doesn't look like it behaves the way I woul dexpect a finalKey = true to behave
        - [X] if we cheat and select to commands the repeat action works
        - [X] command doesn't get grouped with "w" action in the history
        - [X] keys don't show up in sequence in the status bar
    - [X] release vim.toml without `repeat` command
    - [X] fix `last_history_index` return error bug
        - [X] add unit tests to ensure we can add integers to `last_history_index` output
        - [X] split into small patch fix PR
    - [X] fix `finalKey = false` grouping bug
        - [X] add integration tests to ensure `finalKey = false` bindings get grouped
        - [X] unit test for merged reified bindings
        - [X] split into small patch fix PR
    - [X] add repeat action to the vim.toml bindings (after fixing the bugs above)
        - [X] basic repeat actions for `d w` work
        - [x] yw works
        - [X] cw[text] can be repeated
            - [X] why is all be the "delete" text component of the command repeated?
                - [X] ANSWER: store_edits is attached to the moveBy instead of the
                      executeStoredCommand. Guessing this is related to the fact
                      that it is part of the `bind.after` sequence

## MISSING DOCUMENTATION

Document `[[kind]]`! (how is this not working already??)
