<!-- START_DOCS -->
<!-- @file guide.md -->
<!-- @order 2 -->

## Keybinding Customization

There are two ways to start customizing bindings:

- Review the built-in `Larkin` presets: run the command `Master key: New Keybinding Copy` to start editing a copy of this preset. This is a toml file which has comments throughout.
- Review the [binding file format](/bindings/index) and [command documentation](/commands/index), and start creating your own TOML file.

The steps are:

1. Create a new a toml file
2. Optional: copy a preset into the file using `Master key: New Keybinding Copy`
3. Optional: import any existing user bindings, from `keyindings.json`, by calling `Master Key: Import User Keybindings` in this new toml file
4. Add bindings, as per the [binding format](./bindings/) and [command documentation](./commands/).
5. Activate the bindings with `Master Key: Activate Keybindings` at any time.

## Roadmap

Master Key has reached a relatively stable state. There are no immediate plans to introduce major breaking changes. The major effort remaining is to create additional keybinding presets for Emacs, Vim and Helix.

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
