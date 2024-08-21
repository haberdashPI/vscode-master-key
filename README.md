# Master Key

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://img.shields.io/badge/Repo%20Status-WIP-yellow)](https://www.repostatus.org/#active)
[![CI](https://github.com/haberdashPI/vscode-master-key/actions/workflows/ci.yml/badge.svg)](https://github.com/haberdashPI/vscode-master-key/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/haberdashPI/vscode-master-key/graph/badge.svg?token=099XZY1KR9)](https://codecov.io/gh/haberdashPI/vscode-master-key)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

**TODO**: doc badges

> [!WARNING]
> 🚧 Master Key is still under construction. 🚧
>
> The README is a WIP document that will eventually reflect the intended state for release 0.3.0 at which point this extension will be published to VSCode's extension marketplace. For now expect to find missing features, a variety of bugs and incomplete documentation.

Master key helps you to learn, create and use powerful keybindings in [VSCode](https://code.visualstudio.com/).

If you want to improve your text editing super powers in VSCode, Master Key might just be the tool for you.

## To get started

The easiest way to get started is to activate the built-in keybindings that come with Master Key.

1. Install this extension
2. Run the command `Master Key: Activate Keybindings`.
3. Select the built-in binding set "Larkin".

## Examples

Master Key includes the following features:

**TODO**: insert example gif of each feature below

### Editing Features

Here are some of the cool features that come with the built-in `Larkin` keybindings provided by Master Key with the help of [selection utilities](https://github.com/haberdashPI/vscode-selection-utilities). These bindings following in the footsteps of Vim, Kakaune and Helix.

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

Avoid lengthy key sequences by repeating the last action-related selection with "," and the last action with "."

#### Record Commands

Record longer command sequences and replay them.

> [!NOTE]
> Command command recording comes with a few limitations, refer to the documentation for details

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

> [!WARNING]
> For the initial release of Master Key, the Keybinding Features are not yet well documented. The main goal of the 0.3.0 release was to make the default keybindings accessible to new users. See the roadmap section below for details. The finer points of implementing your own keybindings will require some digging into source code and/or asking questions in the discussions section of this repo.

When you create your own keybindings using Mater Key's special `.toml` keybinding format you get several powerful features that make it possible to easily create keybindings that would be difficult or impossible to implement without writing your own extension.

#### Modal Bindings

Your bindings can be modal—a special key (like escape) switches you to a different mode where all the keys on your keyboard can be used to issue commands specific to that mode.

#### Parameteric Bindings

Express an entire series of bindings using the `foreach` field.

#### Stateful Bindings

Update state with the `master-key.captureKeys`, `master-key.updateCount`, `master-key.setFlag` or `master-key.storeNamed` and then use this state in downstream commands using `computedArgs` instead of `args` in your keybinding.

#### Record and Repeat Commands

Master key records recent key presses, allowing you to create commands that quickly repeat a previous sequence using `master-key.replayFromHistory` or `master-key.pushHistoryToStack` and `master-key.replayFromStack`. You can disable key press recording by setting `master-key.maxCommandHistory` to 0 in your settings.

#### Documented Bindings

Of course, just like all of the built-in bindings in Master Key, you can document your bindings so that they show up legibly within the discoverability features above.

## Customized Bindings

Okay, so you want to make your own keybindings with Master Key?

You can start by modifying the built-in `Larkin` preset using the command `Master Key: Edit Preset Copy`. A new `*.toml` file with the contents of this master-key binding set will be opened. The file has comments throughout which document its use.

You can now edit the bindings and/or import bindings from those you've already created in VSCode. Call `Master Key: Import Default/User Keybindings` to add any existing bindings you have. Edit the bindings and update your settings to use them by calling `Master Key: Activate Keybindings` at any time.

## Roadmap

For detailed notes on development, refer to `notes.md`.

- Release 0.1.0: relatively stable default keybindings
- Release 0.1.x: improved coverage/testing/stability of existing features
- Release 0.2.0: missing visual documentation features: markdown summary of bindings
- Release 0.2.x: improved performance/coverage/stability
- Initial publish to VSCode here: 0.3.0
- Release 0.4.x: documentation of all keybinding commands, improve quality of life for those building their own custom extensions. May introduce breaking changes to improve API clarity for these bindings
- Release 0.4.y: source code documentation — may involve substantial refactor to improve legibility / clarity of code
- Release 1.0.0:
    - code should be legible
    - test coverage should be satisfactory
    - documentation should be largely complete
- Release 1.x: upwards and onwards...

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
- [kakune](https://github.com/mawww/kakoune)
- [helix](https://helix-editor.com/)

## Developer Notes

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
