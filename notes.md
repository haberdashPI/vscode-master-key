Next steps:

1. Start translating each of the tests into unit/integration tests as appropriate
2. Get CI working for all of:
    desktop unit tests
    web unit tests
    integration tests (only desktop is feasible)
3. Refactor parsing to rust
    a. in this early phase, we don't worry too much about providing detailed error messages
       (if there are easy things to do here we can do them, but no UX work, etc...)
4. Review documentation
5. Release version 0.4
6. Migration selection utilities to the same build setup
7. Generate detailed error reports for keybinding files and get them to show
   up in VSCode's problem window / linting underlines
8. Translate selection utility tests to new build setup
9. Get CI working for all tests in selection utilities
10. continue the quest for better test coverage
