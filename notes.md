- generate VIM bindings
- implement before/after fields for `[[bind]]`
    - [x] add check to validate that `before/after` aren't explicitly specified
      outside of `[[define.bind]]`
    - [X] fix handling of expressions in plurals
        - [X] implement
        - [X] document
        - [X] test
    - [x] expand `before/after` into `commands` inside of `Command::new`
    - [X] add rust unit tests
        - [X] final bindings include before and after commands
        - [X] tests for 2.1 warnings

NOTE: undo should also clear selections

commands to debug:
    - [x] basic motions (cursor (h) and unit like (w))
    - [X] dW (currently deletes paragraph)
    - [X] dd, dw, dp
    - [X] dip, daw, etc...
    - [X] undo clears selection
    - [X] ctrl-d/u move up down (or whatever motion it is)
    - [X] search works in visual mode
    - [X] ? searches backwards
    - [X] 9dj (and dk, dgj, dgk)
    - [X] yaw clears selection
    - [X] yy copies a line and clears selection
    - [ ] `caw` enters insert mode (probably worth debugging)
