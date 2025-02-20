# Keybinding `default` element

The `default` element describes a series of hierarchical defaults according to
a period-delimited set of identifiers.

**Example**

```toml
[[default]]
id = "motion"
default.mode = "normal"

[[default]]
id = "motion.cursor"
command = "cursorMove"

[[bind]]
name = "lines"
description = "expand selection to full-line selections"
key = "shift+l"
command = "expandLineSelection"
defaults = "motion"
# mode = "normal" (because of the "motion" defaults)

[[bind]]
key = "l"
name = "left"
defaults = "motion.cursor"
# mode = "normal" (because of the "motion" defaults)
# command = "cursorMove" (because of the "motion.cursor" defaults)
args.to = "left"
```

When you specify the defaults of a keybinding it draws not only from the exact id, but also any of its period-delimited prefixes. Prefixes match when the same set of identifiers in the same order occurs up until the end of the prefix: substrings are not matched. For example `foo.bar.baz` matches `foo.bar` and `foo` but it does not match `foo.ba`. In the above example, `motion.cursor` matches both `motion` and `motion.cursor` path definitions.

Default elements have the following fields:

- `id`*: the period delimited sequences of identifiers defining this default; each identifier can include letters, numbers as well as `_` and `-`.
- `default`: An object holding defaults for any one of the fields in [`bind`](/bindings/bind).
- `appendWhen`: An additional `when` clause to append (using `&&`) to those for each
binding under this path. This is in contrast to a `when` under `default`, which would be overwritten if a `when` field was explicitly specified by a given binding.
