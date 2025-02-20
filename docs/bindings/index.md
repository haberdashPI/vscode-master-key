## Master Keybindings v1.0

**TODO**: programmatically insert Larkin docs

This defines version 1.0 of the master keybinding file format.

 Master keybindings are [TOML](https://toml.io/en/) files composed of the following
 top-level fields:

- [`header`](/bindings/header): top-level properties of the binding file
- [`bind`](/bindings/bind): array that stores your keybindings; it extends the schema used in VSCode's this
is a `keybindings.json`
- [`mode`](/bindings/mode): array that specifies the behavior of different keybinding modes you can switch
between
- [`default`](/bindings/default): array that defines structured defaults that apply to a subset of your
keybindings
- [`kind`](/bindings/kind): array that documents broad categories of keys.
- `define`: add any arbitrary fields to this object, and use them in computed arguments

> [!NOTE] Note
> The Master Keybinding TOML file is a literate document. If you'd
> like to share your bindings with others, keep the following in mind: any comments on
> their own line that do not start with `#-` are interpreted as markdown when generating
> the textual documentation. All keybindings falling between two given sections of
> documentation text are converted into a single table. If you want the documentation to
> be clear, write up good comments in this binding file and group your bindings into
> logical sections between these comments.

> [!WARNING] Limitation
> A current limitation of Master Key is that `#` comments on their
> own line cause the fields before and after the comment to be parsed separately. Use
> `#-` to avoid splitting a single object in two. There are plans to eliminate this
> limitation in the future

Here's a minimal example, demonstrating the most basic use of each field

```toml
[header]
version = "1.0" # this denotes the file-format version, it must be 1.0
name = "My Bindings"

[[mode]]
name = "insert"

[[mode]]
name = "normal"
default = true

[[kind]]
name = "motion"
description = "Commands that move your cursor"

[[kind]]
name = "mode"
description = "Commands that change the keybinding mode"

[[bind]]
key = "i"
name = "insert"
mode = "normal"
command = "master-key.enterInsert"
kind = "mode"

[[bind]]
key = "escape"
name = "normal"
mode = "insert"
command = "master-key.enterNormal"
kind = "mode"

[[default]]
id = "basic_motion"
name = "Motion Keys"
default.mode = "normal"
default.kind = "motion"
default.command = "cursorMove"

[[bind]]
name = "right"
defaults = "basic_motion"
key = "l"
args.to = "right"

[[bind]]
name = "left"
defaults = "basic_motion"
key = "h"
args.to = "left"

[define]
foo = 1

[[bind]]
name = "double right"
key = "g l"
defaults = "basic_motion"
args.to = "right"
computedArgs.value = "foo+1"
```
