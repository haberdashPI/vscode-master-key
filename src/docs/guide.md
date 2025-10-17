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

> [!WARNING]
> Because the error reporting for master keybinding files is not yet very precise, it is recommended that you edit bindings incrementally, testing them out as you go (e.g. by slowly creating new bindings or by slowly uncommenting an entire binding set you have imported). This will ensure that the changes you've made can be properly activated by Master Key. Improved error reporting is on the [roadmap](#roadmap)

> [!NOTE]
> The documentation covers version 2.0 of the master key binding format, created for version 0.4 of master key. A legacy definition of the bindings, created for version 0.3.0 (version 1.0) of the keybindings, is still supported, but might not benefit from future enhancements to master key. You can learn how to upgrade the keybinding format by reviewing https://github.com/haberdashPI/vscode-master-key/pull/70

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
2. Optional: copy a present into the file using `Master Key: Edit Preset Copy`
3. Optional: import include any existing user bindings, from `keyindings.json`, by calling `Master Key: Import User Keybindings` in this new toml file
4. Add bindings, as per the [binding format](./bindings/) and [command documentation](./commands/).
5. Activate the bindings with `Master Key: Activate Keybindings` at any time (do this *often* while your are writing your bindings).

## Roadmap

Master Key is quite stable for everyday use, but it remains a work in progress.

- Release 0.4.x (you are here): documentation of all keybinding commands complete.
- Release 0.4.y: more precise binding error report: use VSCode language server features to
  get detailed line and character error indicators for binding-file problems
- Release 0.4.z: source code documentation — may involve substantial refactor to improve legibility / clarity of code
- Release 1.0.0:
    - code should be legible
    - test coverage should be satisfactory
    - documentation should be largely complete
- Release 1.x: upwards and onwards...
  - support for more keyboard layouts for visual docs
  - search: `showCount` displays movement count overlaid with each highlight
  - additional keybinding sets: e.g. vim, emacs
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
