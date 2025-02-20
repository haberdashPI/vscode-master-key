Each binding key can be associated with a `kind`. This shows up as a distinct color in the visual documentation and there is mouse-over text associated with each key kind. It has two fields:

- `name`: A string identify the kind.
- `description`: A longer (1-2 sentence) description of the kind.

These two fields are displayed as part of the visual documentation for key kinds.

**Example**

```toml
[[kind]]
name = "action"

[[kind]]
name = "motion"

[[bind]]
kind = "action"
key = "d"
command = "deleteLeft"

[[bind]]
kind = "motion"
key = "l"
command = "cursorLeft"
```
