# Master Key

Master key helps you to learn and to create powerful keybindings.

If:

- you want to improve your fluency in text editing, levarging keybindings to move around and edit at the speed of thought
- you want to use VSCode but miss some of the cools things that vim, emacs, kakaune, helix or any other awesome text editor can do

Master Key might just be the tool for you.

## Feature Demos

It includes the following features:

**TODO**: when I'm ready to release, insert example gif of each feature below

### Discoverability Features

#### Visual documentation of keybindings

Review your bindings on a keyboard layout

#### Cheet sheet of keybindings

Review your bindings in a cheet sheet organied by theme

#### Keybinding hints

See a quick pick palette of possible bindings for the current mode and prefix of keys already pressed

### Keybinding Features

When you create your own keybindings using Mater Key's special `.master-key.toml` format you get several powerful features that make it possible to easily create key bindings that would be difficult or impossible to implement without writing your own extension.

#### Modal Bindings

Your bindings can be modal—a special key (like escape) switches you to a different mode where all the keys on your keyboard can be used to issue commands specific to that mode.

#### Parameteric Bindings

Express an entire sequence of bindings use the `foreach` field.

#### Stateful Bindings

Update state with the `master-key.captureKeys`, `master-key.updateCount`, `master-key.setFlag` or `master-key.storeNamed` and then use this state in downstream commands using `computedArgs` instead of `args` in your keybinding.

#### Record and repeat keypresses

Master key records recent key-presses, allowing you to create commands that quickly repeat a previous sequence of key presses using `master-key.replayFromHistory` or `master-key.pushHistoryToStack` and `master-key.replayFromStack`.

#### Documented Bindings

Of course, just like all of the built-in bindings in Master Key, you can document your bindings so that they show up legibly within the discoverability features above.

### How to get started

Master key comes with its own custom keybinding layout that follows in the footsteps of vim, kakaune and helix, but you can create your own set of bindings by creating a `*.master-key.toml` file.

To get started, install the extension and then run the command `Master Key: Select Binding Preset`, and select the built-in binding set "Larkin". Once you have run this command a large number of new keybindings will be added to VSCode. Almost all of these bindings are under a `normal` mode that you activate by pressing `escape` or `ctrl+[`. Furthermore, the visual documentation and cheet sheet for these new bindings will be displayed for you to start learning how to use these bindings and you can access them later on by using the commands `Master Key: Show Visual Documentation` and `Master Key: Show Cheesheet`.

## Customizing the Bindings

Okay, so you want to make your own keybindings with Master Key?

You can start by modifying the built-in `Larkin` preset using the command `Master Key: Export Binding Preset`. A new `*.master-key.toml` file with the contents of this master-key binding set will be opened. The file has comments throughout which document its use.

You can now edit the bindings and/or import bindings from those you've already created in VSCode. Call `Master Key: Import Default/User Keybindings` to add any existing bindings you have. Edit the bindings and start using them by calling `Master Key: Select Binding Preset`.

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
