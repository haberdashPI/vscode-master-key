# Keybinding `mode` element

The `mode` element defines a distinct keybinding mode. Like vim modes, they affect which keybindings are currently active.

**Example**

```toml
[[mode]]
name = "normal"
default = true
cursorShape = "Block"
highlight = "Highlight"

[[mode]]
name = "insert"
cursorShape = "Line"
highlight = "NoHighlight"
recordEdits = true
```

## Fields

- `name`*: The name of the mode; displayed in the bottom left corner of VSCode
- `default`: boolean indicating if this is the default mode (defaults to false). There should be only one default mode.
- `highlight`: Whether and how to highlight the name of this mode in the bottom left corner of VSCode. Possible values are:
    - `NoHighlight` does not add coloring
    - `Highlight` adds warning related colors (usually orange)
    - `Alert` adds error related colors (usually red)
- `recordEdits`: Whether the changes to the text should be recorded instead of any commands that get executed. Modes that issue commands (e.g. vim-like `Normal` mode) should set this to `false` and modes that do not (e.g. vim-like `Insert` mode) should set this to `true`.
- `onType`: The command to issue when typing keys that have no associated binding [see `onType` field below](#ontype-field)
- `fallbackBindings`: If specified and no binding is defined in this mode, use the bindings from this mode instead.
- `cursorShape`: one of the following
    - `Line`
    - `Block`
    - `Underline`
    - `LineThin`
    - `BlockOutline`
    - `UnderlineThin`

The only required field is `name` (as indicated by the *).

### `onType` Field

The `onType` field has the following subfields:

- `command`: The command to execute
- `args`: The commands arguments
- `computedArgs`: Command arguments evaluated as [expressions](/bindings/bind#expressions).
- `if`: if present and this expression evaluates to false, the command is not executed

While evaluating expressions `captured` is set to the key which got typed.

**Example**: Symmetric insert mode (in `Larkin` keybindings) includes the following definition so that typed characters are inserted on both sides of a selection.

```toml
[[mode]]
name = "syminsert"
highlight = "Highlight"
cursorShape = "BlockOutline"

[[mode.onType]]
command = "selection-utilities.insertAround"
computedArgs.before = "braces[captured].before || captured"
computedArgs.after = "braces[captured].after || captured"
args.followCursor = true
```
