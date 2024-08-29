# Master Key

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://img.shields.io/badge/Repo%20Status-WIP-yellow)](https://www.repostatus.org/#active)
[![CI](https://github.com/haberdashPI/vscode-master-key/actions/workflows/ci.yml/badge.svg)](https://github.com/haberdashPI/vscode-master-key/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/haberdashPI/vscode-master-key/graph/badge.svg?token=099XZY1KR9)](https://codecov.io/gh/haberdashPI/vscode-master-key)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

Master key helps you to learn, create and use powerful keybindings in [VSCode](https://code.visualstudio.com/).

If you want to improve your text editing super powers in VSCode, Master Key might just be the tool for you.

## To get started

The easiest way to get started is to activate the built-in keybindings that come with Master Key.

1. Install this extension
2. Run the command `Master Key: Activate Keybindings`.
3. Select the built-in binding set "Larkin".

## Examples

### Discoverability Features

#### Visual documentation of keybindings

Learn and review your bindings on a keyboard layout

![example of visual docs](images/readme/visualdoc.jpg)

#### Cheet sheet of keybindings

Review your bindings in a cheet sheet organized by theme

![example of cheet sheet](images/readme/cheatsheet.png)

#### Keybinding hints

See a quick pick palette of possible bindings for the current mode and prefix of keys already pressed

![example of palette](images/readme/palette.png)

### Editing Features

Here are some of the cool editing features that come with the built-in `Larkin` keybindings provided by Master Key with the help of [selection utilities](https://github.com/haberdashPI/vscode-selection-utilities). These bindings follow in the footsteps of Vim, Kakaune and Helix.

#### Move by Object

Select by word, line, paragraph and more.

![examples of moving by word, line and paragraph](images/readme/selectby.webp)

Expand by indent, quotes and brackets.

![examples of expanding by indent, quote and brackets](images/readme/expandby.webp)

Once you've selected the object, run commands to do stuff (e.g. delete/change/comment)

#### Multi-Cursor Creation and Filtering

Quickly create multiple selections by splitting selections:

![example of splitting a selection](images/readme/splitselect.webp)

matching by word:

![example of selecting by match](images/readme/selectmatch.webp)

using saved selections:

![example of using saved selections](images/readme/selectsaved.webp)

Filter out the ones you don't want either by pattern:

![example of filtering selections](images/readme/filterselect.webp)

or manuall removal:

![example of seelection deletion](images/readme/deleteselect.webp)

#### Exchange Objects

Swap selected objects with one another.

![example of text exchange](images/readme/exchangetext.webp)

#### Repeat Last Selection / Action

Avoid lengthy key sequences by repeating the last action-related selection with "," and the last action with "."

![example of repeating select/action](images/readme/repeat.webp)

#### Record Commands

Record longer command sequences and replay them.

![example of recording key sequence](images/readme/record.webp)

> [!NOTE]
> Command recording comes with a few limitations, refer to the cheet sheet on Larkin macros for details

#### Symmetric Insert

Insert appropriate characters before and after each selection

![example of syminsert mode](images/readme/syminsert.webp)

### Keybinding Features

> [!WARNING]
> For the initial release of Master Key, the Keybinding Features are not yet well documented. You can review the features when copying Larking to your own customization file. The main goal of the 0.3.0 release was to make the default keybindings accessible to new users. See the roadmap section below for details. The finer points of implementing your own keybindings will require some digging into source code and/or asking questions in the discussions section of this repo.

When you create your own keybindings using Mater Key's special `.toml` keybinding format you get several powerful features that make it possible to easily create keybindings that would be difficult or impossible to implement without writing your own extension.

#### Modal Bindings

Your bindings can be modal—a special key (like escape) switches you to a different mode where all the keys on your keyboard can be used to issue commands specific to that mode.

```toml
[[bind]]
key = "j"
mode = "normal"
command = ...
```

#### Parameteric Bindings

Express an entire series of bindings using the `foreach` field.

```toml
[[bind]]
path = "edit.count"
foreach.num = ['{key: [0-9]}']
name = "count {num}"
key = "{num}"
command = "master-key.updateCount"
args.value = "{num}"
```

#### Stateful Bindings

Update state with the `master-key.captureKeys`, `master-key.updateCount`, `master-key.setFlag` or `master-key.storeNamed` and then use this state in downstream commands using `computedArgs` instead of `args` in your keybinding.

```toml
[[bind]]
name = "between pair"
key = "m t"
description = """
Select between pairs of the same N characters
"""
command = "runCommands"

[[bind.args.commands]]
command = "master-key.captureKeys"
args.acceptAfter = 1

[[bind.args.commands]]
command = "selection-utilities.selectBetween"
computedArgs.str = "captured"
args.inclusive = false
```

#### Record and Repeat Commands

Master key records recent key presses, allowing you to create commands that quickly repeat a previous sequence using `master-key.replayFromHistory` or `master-key.pushHistoryToStack` and `master-key.replayFromStack`. You can disable key press recording by setting `master-key.maxCommandHistory` to 0 in your settings.

```toml
[[bind]]
key = ";"
name = "repeat motion"
repeat = "count"
command = "master-key.replayFromHistory"
args.at = "commandHistory[i].path.startsWith('edit.motion') && commandHistory[i].name != 'repeat motion'"
```

#### Documented Bindings

Of course, just like all of the built-in bindings in Master Key, you can document your bindings so that they show up legibly within the discoverability features above.
The toml file is a literate document used to generate the textual documentation
and all binding's names will show up in the visual documentation as appropriate.

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

This repository was designed to be worked with in unix-like environemtns. No effort to
support development on Windows has been made. The setup relies on a working versions of
`nvm` installed in bash and an npm version matching the version specified in `.nvmrc`. You
can satisfy this requirement by copying and running the following in bash.

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash # install nvm
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # load nvm
nvm install # install npm version found in `.nvmrc`
```

You can then install all dependencies for this project as follows:

```sh
nvm use
npm ic
```
