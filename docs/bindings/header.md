# Keybinding `header`

**Example**

```toml
[header]
version = 1.0
name = "My Bindings"
requiredExtensions = ["Vue.volar"]
```

## Required Fields

- `version`: Must be version 1.x.y (typically 1.0); only version 1.0 currently exists.
   Follows [semantic versioning](https://semver.org/).
- `name`: The name of this keybinding set; shows up in menus to select keybinding presets
- `requiredExtensions`: An array of string identifiers for all extensions used by this binding set.

In generally if you use the commands from an extension in your keybinding file, it is good to include them in `requiredExtensions` so that others can use your keybindings without running into errors due to a missing extension.

## Finding Extension Identifiers

You can find an extension's identifier as follows:

1. Open the extension in VSCode's extension marketplace
2. Click on the gear (⚙︎) symbol
3. Click "Copy Extension ID"; you now have the identifier in your system clipboard
