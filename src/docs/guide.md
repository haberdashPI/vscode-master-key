<!-- START_DOCS -->
<!-- @file guide.md -->
<!-- @order 2 -->

## Keybinding Customization

There are two ways to start customizing bindings:

- Review the built-in `Larkin` presets: run the command `Master Key: Edit Preset Copy` to start editing a copy of this preset. This is a toml file which has comments throughout.
- Review the [binding file format](/bindings/index) and [command documentation](/commands/index), and start creating your own TOML file.

The steps are:

1. Create a new a toml file
2. Optional: copy a preset into the file using `Master Key: Edit Preset Copy`
3. Optional: import any existing user bindings, from `keyindings.json`, by calling `Master Key: Import User Keybindings` in this new toml file
4. Add bindings, as per the [binding format](./bindings/) and [command documentation](./commands/).
5. Activate the bindings with `Master Key: Activate Keybindings` at any time.

## Roadmap

Master Key is quite stable for everyday use, but it remains a work in progress.

- Release 0.4.y (you are here): precise binding errors: use VSCode to get detailed line and character error indicators for any problems with your bindings
- Release 0.4.z: source code documentation — may involve substantial refactor to improve legibility / clarity of code
- Release 1.0.0:
    - code should be legible
    - test coverage should be satisfactory
    - documentation should be largely complete
- Release 1.x: upwards and onwards...
  - additional keybinding presets: e.g. vim, emacs
  - search: `showCount` displays movement count overlaid with each highlight
  - any API improvements important for Vim and Emacs binding presets

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
