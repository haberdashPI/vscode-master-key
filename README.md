# Master Key

Master key helps you to learn to use and to create powerful keybindings.

If you appreciate the merits of vim, emacs, kakaune, helix, or any other well made text editor OR if you aren't familiar with these tools, but want to learn how to move around and edit your text at the speed of thought, Master Key is at your service.

## Feature Demos

**TODO**: when I'm ready to release, insert example gif of each feature below

### Visual documentation of keybindings

Review your bindings on a keyboard layout

### Cheet sheets of all keybindings

Review your bindings in a cheet sheet organied by theme

### Modal keybindings

Your bindings can be modal—a special key (like escape) switches you to a different mode where all the keys on your keyboard can be used to issue commands

### Keybinding hints

See a quick pick palette of possible bindings for the current mode and prefix of keys already pressed

### Record and repeat keypresses

Master key records recent key-presses, allowing you to create commands that quickly repeat previous sequences of commands

### How to get started

Master key comes with its own custom keybinding layout that follows in the footsteps of vim, kakaune and helix, but you can create your own set of bindings by creating a `*.master-key.toml` file.

To get started, install the extension and then run the command `Master Key: Select Binding Preset`, and select the built-in binding set "Larkin". Once you have run this command a large number of new keybindings will be added to VSCode. Furthermore, the visual documentation and cheet sheet for these new bindings will be displayed for you to start learning how to use these bindings.

## Customizing the Bindings

Okay, so you want these features to work for your own keybindings?

You can start by modifying the built-in `Larkin` preset using the command `Master Key: Export Binding Preset`. A new `*.master-key.toml` file with the contents of this master-key binding set will be opened. The file has comments throughout which document its use.

You can now edit the bindings. Once you're ready, you can activate them with `Master Key: Select Binding Preset`. If you have existing bindings you want to insert in this file, you can call `Master Key: Import Default/User Keybindings` and it will read the respective JSON file and import the relevant bindings into this `*.master-key.toml` file.

## Related Extensions

- [VSCodeVim](https://github.com/VSCodeVim/Vim)
- [vscode-neovim](https://github.com/asvetliakov/vscode-neovim)
- [Awesome Emacs Keymap](https://github.com/whitphx/vscode-emacs-mcx)
- [Dance](https://github.com/71/dance)
- [ModalEdit](https://github.com/johtela/vscode-modaledit)
- [ModalKeys](https://github.com/haberdashPI/vscode-modal-keys)

## Developer Notes

**TODO**: reference a separate file here

This repository relies on a working versions of `nvm` installed in bash and a npm version
matching the version specified in `.nvmrc`. You can satisfy this requirement by copying and
running the following in bash.

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash # install nvm
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # load nvm
nvm install # install npm version found in `.nvmrc`
```

You can then install all dependencies for this project as follows:

```sh
nvm use
npm i
```

**TODO**: this should really document the use of the debug-profile file

**TODO**: this should document the limitations of ux testing (e.g. can't test palette, and why that's okay)
