# Commands

There are two categories of commands available in Master Key: the user commands and the keybinding commands.

## User Commands

User commands take no arguments and generally interact with the user-interface of
VSCode.

- "Activate Keybindings": (`master-key.activateBindings`) Activate a specific set of master keybindings; either a built-in preset or one added by the user.
- "Activate User Keybindings": (`master-key.selectUserBindings`) Append additional, user-customized keybindings to the activated bindings.
- "Show Visual Documentation": (`master-key.showVisualDoc`) Show a visual display of all keybindings in the bottom pane.
- "Install Extensions Required by Keybindings": (`master-key.installRequiredExtensions`) Install extensions that are required by the active keybinding set
- "Toggle Visual Doc Modifier by frequency": (`master-key.toggleVisualDocModifiers`) Change which modifier keys show up in the visual documentation. It cycles from most to least common modifier combinations.
- "Toggle palette input mode": (`master-key.togglePaletteMode`) When the keybinding suggestion palette is open, toggle between the two possible modes. In keybinding mode, keys behave just as they would without the suggestion palette open. In search mode you can search the bindings by their name and description.
- "Deactivate Master Keybindings": (`master-key.deactivateBindings`) Remove all automatically inserted master keybindings.
- "Edit Preset Copy": (`master-key.editPreset`) Open a new file, filled with the contents of the selected keybinding preset.
- "Import User Bindings": (`master-key.importUserBindings`) Import VSCode's base keybindings (from `keybindings.json`) into the currently open TOML file.
- "Import Default Bindings": (`master-key.importDefaultBindings`) Import VSCode's default keybindings into the currently open TOML file.
- "Show Text Documentation": (`master-key.showTextDoc`) Show markdown documentation of the current master keybindings.
- "Key Suggestions...": (`master-key.commandSuggestions`) Display the keybinding suggestion palette.

## Keybinding Commands

Keybinding commands usually have at least one argument and are expected to primarily be used when defining keybindings in a [master keybinding TOML file](/bindings).

## State Management

- [`master-key.set`](/commands/set)
- [`master-key.setFlag`](/commands/setFlag)
- [`master-key.setMode`](/commands/setMode)
- [`master-key.updateCount`](/commands/updateCount)

## Typing Characters

- [`master-key.captureKeys`](/commands/captureKeys)
- [`master-key.insertChar`](/commands/insertChar)
- [`master-key.replaceChar`](/commands/replaceChar)

## Searching for Characters

- [`master-key.search`](/commands/search)
- [`master-key.nextMatch`](/commands/nextMatch)
- [`master-key.previousMatch`](/commands/previousMatch)

## Performing Actions

- [`master-key.do`](/commands/do) **NOTE**: implementation detail
- [`master-key.ignore`](/commands/ignore)
- [`master-key.prefix`](/commands/prefix)

## Key Mode

- [`master-key.enterInsert`](/commands/enterInsert)
- [`master-key.enterNormal`](/commands/enterNormal)
- [`master-key.setMode`](/commands/setMode)

## Storage

- [`master-key.executeStoredCommand`](/commands/executeStoredCommand)
- [`master-key.restoreNamed`](/commands/restoreNamed)
- [`master-key.storeCommand`](/commands/storeCommand)
- [`master-key.storeNamed`](/commands/storeNamed)

## Command History

- [`master-key.pushHistoryToStack`](/commands/pushHistoryToStack)
- [`master-key.record`](/commands/record)
- [`master-key.replayFromHistory`](/commands/replayFromHistory)
- [`master-key.replayFromStack`](/commands/replayFromStack)

## Keybinding Contexts

These contexts available for use within the `when` clause of keybindigs.

### Key mode

- [`master-key.mode`](/commands/mode)
- [`master-key.prefixCode`](/commands/prefixCode) **NOTE**: implementation detail
- [`master-key.prefix`](/commands/prefix)

### Other

- [`master-key.storage`](/commands/storage)
- [`master-key.keybindingPaletteBindingMode`](/commands/keybindingPaletteBindingMode)
- [`master-key.keybindingPaletteOpen`](/commands/keybindingPaletteOpen)
