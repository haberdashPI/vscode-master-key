- generate VIM bindings
- implement before/after fields for `[[bind]]`
    - [x] add check to validate that `before/after` aren't explicitly specified
      outside of `[[define.bind]]`
    - [x] expand `before/after` into `commands` inside of `Command::new`
    - [ ] add rust unit tests
        - [ ] final bindings include before and after commands
