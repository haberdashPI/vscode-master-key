# Keybinding `bind` element

A `bind` element maps a given key (or sequence of keys) to a [command](#finding-commands).

**Example**

```toml
[[bind]]
name = "left"
key = "h"
mode = "normal"
command = "cursorLeft"
```

The `bind` element has two categories of fields: functional and documenting.

## Functional Fields

The functional fields determine what the keybinding does.

- `defaults`: the hierarchy of defaults applied to this binding, see the [`default` element](/bindings/default) for more details.
- `priority`: The ordering of the keybinding relative to others; determines which bindings take precedence. Defaults to 0.
- `key`*: the [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that triggers `command`.
- `command`*: A string denoting the command to execute. This is an command defines by VSCode or an extension thereof. See [finding commands](#finding-commands).
- `args`: The arguments to directly pass to the `command`, these are static values.
- `computedArgs`: Like `args` except that each value is a string that is evaluated as an [expression](#expressions).
- `when`: A [when clause context](https://code.visualstudio.com/api/references/when-clause-contexts) under which the binding will be active. Also see Master Key's [available contexts](#available-contexts)
- `mode`: The mode during which the binding will be active. The default mode is used when this field is not specified (either directly or via `defaults`)
- `repeat`: This is an [expression](#expressions)`. It is evaluated and the `command` will be repeated the given number of times.
- `prefix`: Determines what *unresolved* key sequence can have occurred before typing this key. See [`master-key.prefix`](/commands#prefix) for details. Defaults to "" (a.k.a. no prefix is allowed)
- `resetTransient`: Does the key press clear any transient state, including the current keybinding prefix. See [`master-key.prefix`](/commands#prefix). Defaults to `true`.
- `foreach`: Allows parametric definition of multiple keybindings, see [`foreach` clauses](#foreach-clauses).

The required fields (marked with `*`) must be specified either directly in the binding or via the `defaults` field, otherwise the binding will raise an error.

## Documenting Fields

The documenting fields determine how the keybinding is documented. They are all optional.

- `name`: A very description for the command; this must fit in the visual documentation so it shouldn't be much longer than five characters for most keys. Favor unicode symbols such as → and ← over text.
- `description`: A longer description of what the command does. Shouldn't be much longer than a single sentence for most keys. Save more detailed descriptions for the literate comments.
- `hideInPalette/hideInDocs`: whether to show the keys in the popup suggestions and the documentation. These both default to false.
- `combinedName/combinedKey/combinedDescription`: in the suggestion palette and textual documentation, keys that have the same `combinedName` will be represented as single entry, using the `combinedKey` and `combinedDescription` instead of `key` and `description`. The `combinedKey` for a multi-key sequence should only include the suffix key. All but the first key's `combinedKey` and `combinedDescription` are ignored.
- `kind`: The broad cagegory of commands this binding falls under. There should be no more than 4-5 of these. Each `kind` here should have a corresponding entry in the top-level `kind` array.

## Finding Commands

You can find commands in a few ways:

- Find command you want to use from the command palette, and click on the gear (`⚙︎`) symbol to copy the command string to your clipboard
- Review the  [list of built-in commands](https://code.visualstudio.com/api/references/commands)
- Run the command `Preferences: Open Default Keyboard Shortcuts (JSON)` to get a list of built-in commands and extension commands already associated with a keybinding

Furthermore, you can also use:

- [Master Key Commands](/commands)
- [Commands from Selection Utilities](TODO)

Selection Utilities is a complimentary extension used extensively by the `Larkin` preset.

## Expressions

There are several places within a keybinding that you can use expressions. These are [AngularJS](https://www.w3schools.com/angular/angular_expressions.asp) expressions. During evaluation the following values are in scope:

- Any field defined in the top-level `define` field
- Any value set by [`setFlag`](/commands#set-flag)
- `editorHasSelection`: true if there is any selection, false otherwise
- `editorHasMultipleSelections`: true if there are multiple selections, false otherwise
- `firstSelectionOrWord`: the first selection, or the word under the first cursor if the selection is empty
- `editorLangId`: the [language id](https://code.visualstudio.com/docs/languages/identifiers) of the current editor or the empty string if there is no current editor (or no language id for that editor)
- `mode`: the current keybinding mode
- `count`: The current count, as defined by [`master-key.updateCount`](/commands#update-count)
- `captured`: The text currently captured by the most recent call to [`master-key.restoreNamed`](/commands#restore-named) or [`master-key.captureKeys`](/commands#capture-keys).
- `prefix`: The currently active [keybinding prefix](/commands#prefix)
- `record`: a boolean flag used to indicate when keys are marked for recording

## `foreach` Clauses

The `foreach` clause of a keybinding can be used to generate many bindings from one entry.
Each field under `foreach` is looped through exhaustively. On each iteration, any string values that contain <code v-pre>{{[var]}}</code> where `[var]` is a `foreach` field, is replaced with that fields value for the given iteration. For example, the following defines 9 bindings:

::: v-pre
```toml
[[bind]]
foreach.a = [1,2,3]
foreach.b = [1,2,3]
key = "ctrl+; {{a}} {{b}}"
command = "type"
args.text = "{{a-b}}"
```
:::

Furthermore, if the value <code v-pre>{{key: [regex]}}</code> is included in a `foreach` field, it is expanded to all keybindings that match the given regular expression. For example, the following definition is used in `Larkin` to allow the numeric keys to be used as count prefix for motions.

::: v-pre
```toml
[[bind]]
foreach.num = ['{{key: [0-9]}}']
name = "count {{num}}"
key = "{{num}}"
command = "master-key.updateCount"
description = "Add digit {{num}} to the count argument of a command"
args.value = "{{num}}"
# etc...
```
:::
