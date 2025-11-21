<!-- START_DOCS -->
<!-- @file guide.md -->
<!-- @order 2 -->

## Keybinding Customization

There are two ways to start customizing bindings:

- Review the built-in `Larkin` presets: run the command `Master Key: New Keybinding Copy` to start editing a copy of this preset. This is a toml file which has comments throughout.
- Review the [binding file format](/bindings/index) and [command documentation](/commands/index)

Once you've identified the bindings you'd like to create you can add these bindings in one of two ways:

1. Add user bindings to tweak an existing preset
2. Create your own binding set

> [!NOTE]
> This documentation covers version 2.0 of the master key binding format, first created for version 0.4 of master key. See [breaking changes](/bindings/#breaking-changes) for details. It should be possible to get started updating an old file by simply trying to activate it. Master key will show detailed errors, highlighting the exact line where a failure occurred.

### Add User Bindings

To simply tweak an existing preset, you can append additional bindings by activating user bindings:

1. create a new toml file and enter the bindings you want to append.
2. Run `Master Key: Activate User Keybindings` on the toml file you just created.
3. Optional: import any existing user bindings, from `keyindings.json`, by calling `Master Key: Import User Keybindings` and/or `Master Key: Import Default Keybindings` in this new toml file.

> [!NOTE]
> Normal VSCode user-specified keybindings always take precedence over master keybindings. (It would be rude to have Master Key automatically insert bindings with higher priority than user specified customizations). Make sure you delete any user keybindings from your `keybindings.json` file after importing them into your master keybindings `.toml` file.

### Define Your Own Bindings

You can define your own preset. The steps are:

1. Create a new a toml file
2. Optional: copy a preset into the file using `Master Key: Edit Preset Copy`
3. Optional: import any existing user bindings, from `keyindings.json`, by calling `Master Key: Import User Keybindings` in this new toml file
4. Add bindings, as per the [binding format](./bindings/) and [command documentation](./commands/).
5. Activate the bindings with `Master Key: Activate Keybindings` at any time (do this *often* while your are writing your bindings so you can debug your bindings).

## Roadmap

Master Key is quite stable for everyday use, but it remains a work in progress.

- Release 0.4.y (you are here): precise binding errors: use VSCode to get detailed line and character error indicators for any problems with your bindings
- Release 0.4.z: source code documentation — may involve substantial refactor to improve legibility / clarity of code
- Release 1.0.0:
    - code should be legible
    - test coverage should be satisfactory
    - documentation should be largely complete
- Release 1.x: upwards and onwards...
  - additional keybinding sets: e.g. vim, emacs
  - support for more keyboard layouts for visual docs
  - search: `showCount` displays movement count overlaid with each highlight
  - API improvements for new editor sets
  - keybinding debug QOL features: show the binding that was run for a given key sequence
  - clipboard registers

## Related Work

Master Key follows in the footsteps of many other extensions:

- [VSCodeVim](https://github.com/VSCodeVim/Vim)
- [vscode-neovim](https://github.com/asvetliakov/vscode-neovim)
- [Awesome Emacs Keymap](https://github.com/whitphx/vscode-emacs-mcx)
- [Dance](https://github.com/71/dance)
- [ModalEdit](https://github.com/johtela/vscode-modaledit)
- [ModalKeys](https://github.com/haberdashPI/vscode-modal-keys)

And of course, there are many existing editors that Master Key draws inspiration from:

- [vim](https://www.vim.org/)
- [emacs](https://www.gnu.org/software/emacs/)
- [kakoune](https://github.com/mawww/kakoune)
- [helix](https://helix-editor.com/)

<!-- STOP_DOCS -->
