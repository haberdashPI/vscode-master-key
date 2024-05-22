# Master Key

Master key helps you to learn, create and use powerful keybindings.

If:

- you want to improve your fluency in text editing, levarging keybindings to move around and edit at the speed of thought OR
- you want to use VSCode but miss some cool thing that vim, emacs, kakaune, helix or any other awesome text editor can do

Master Key might just be the tool for you.

## Get started

Master key comes with its own custom keybinding layout that follows in the footsteps of vim, kakaune and helix.

To learn how to use these bindings, install the extension and then run the command `Master Key: Activate Keybindings`, and select the built-in binding set "Larkin". The built-in documentation for these bindings will pop up.

## Examples

Master Key includes the following features:

**TODO**: when I'm ready to release, insert example gif of each feature below

### Editing Features

Here are some of the cool features that come with the built-in `Larkin` keybindings provided by Master Key with the help of [selection utilities](https://github.com/haberdashPI/vscode-selection-utilities).

#### Move by Object

Select by word, line, block and more. Expand by indent, quotes and brackets.

Once you've selected the object, run commands to do stuff (e.g. delete/change/comment)

#### Multi-Cursor Creation and Filtering

Quickly create multiple selections by splitting selections or searching within selections.
Filter out the ones you don't want either by some filter, or by manually picking out
one or more you don't want.

#### Exchange Objects

Swap selected objects with one another.

#### Repeat Last Selection / Action

Avoid lengthy or awkward key sequences by repeating the action-related selection with "," and the last action with "."

#### Record Commands

Recording longer command sequences and replay them.

#### Symmetric Insert

Insert appropriate characters before and after each selection

### Discoverability Features

#### Visual documentation of keybindings

Learn and review your bindings on a keyboard layout

**NOTE**: demo the ability to toggle bindings on the keys

#### Cheet sheet of keybindings

Review your bindings in a cheet sheet organized by theme

#### Keybinding hints

See a quick pick palette of possible bindings for the current mode and prefix of keys already pressed

### Keybinding Features

When you create your own keybindings using Mater Key's special `.master-key.toml` format you get several powerful features that make it possible to easily create keybindings that would be difficult or impossible to implement without writing your own extension.

#### Modal Bindings

Your bindings can be modal—a special key (like escape) switches you to a different mode where all the keys on your keyboard can be used to issue commands specific to that mode.

#### Parameteric Bindings

Express an entire series of bindings using the `foreach` field.

#### Stateful Bindings

Update state with the `master-key.captureKeys`, `master-key.updateCount`, `master-key.setFlag` or `master-key.storeNamed` and then use this state in downstream commands using `computedArgs` instead of `args` in your keybinding.

#### Record and Repeat Commands

Master key records recent key presses, allowing you to create commands that quickly repeat a previous sequence using `master-key.replayFromHistory` or `master-key.pushHistoryToStack` and `master-key.replayFromStack`.

#### Documented Bindings

Of course, just like all of the built-in bindings in Master Key, you can document your bindings so that they show up legibly within the discoverability features above.

## Customized Bindings

Okay, so you want to make your own keybindings with Master Key?

You can start by modifying the built-in `Larkin` preset using the command `Master Key: Edit Preset Copy`. A new `*.toml` file with the contents of this master-key binding set will be opened. The file has comments throughout which document its use.

You can now edit the bindings and/or import bindings from those you've already created in VSCode. Call `Master Key: Import Default/User Keybindings` to add any existing bindings you have. Edit the bindings and update your settings to use them by calling `Master Key: Activate Keybindings` at any time.

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
