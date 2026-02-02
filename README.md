<!--NOTE: `width: 1.75em` appears to be ignored when the file is displayed in the github repo -->
<h1><img src="logo.png" alt="M" width="50" style="width: 1.75em; padding-right: 0.25em; margin-bottom: -0.17em"/>aster Key</h1>

[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://img.shields.io/badge/Repo%20Status-Active-green)](https://www.repostatus.org/#active)
[![CI](https://github.com/haberdashPI/vscode-master-key/actions/workflows/ci.yml/badge.svg)](https://github.com/haberdashPI/vscode-master-key/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/haberdashPI/vscode-master-key/graph/badge.svg?token=099XZY1KR9)](https://codecov.io/gh/haberdashPI/vscode-master-key)
[![Docs](https://img.shields.io/badge/docs-stable-blue.png)](https://haberdashpi.github.io/vscode-master-key)

Master Key is a tool for becoming a power-user of your [VSCode](https://code.visualstudio.com/) keybindings. Features include:

- extensive documentation of your bindings (sidebar suggestions, visual guide and inline text documentation)
- predefined keybinding sets
- modal bindings (ala Vim),
- recording of keyboard input (a.k.a. keyboard macros)
- a powerful TOML-based keybinding specification

This curated snippet from the Master Key's Larkin preset defines a VIM-like feature to update a count argument along with a downward motion that uses the count argument:

```toml
# front matter...

[[bind]]
foreach.num = ['{{keys(`[0-9]`)}}']
key = "{{num}}"
command = "master-key.updateCount"
args.value = "{{num}}"
finalKey = false
mode = '{{not_modes(["insert"])}}'
doc.name = "count {{num}}"
doc.description = "Add digit {{num}} to the count argument of a command"
doc.combined.key = "0-9"
doc.combined.name = "count 0-9"
doc.combined.description = "Add digit 1-9 to count argument of a command"

[[bind]]
key = "j"
command = "cursorMove"
mode = "normal"
args.value = '{{key.count}}'
args.select = '{{code.editorHasSelection || val.select}}'
args.to = "down"
args.by = "wrappedLine"
doc.name = "↓"
doc.combined.name = "↓/↑"
doc.combined.key = "j/k"
doc.combined.description = "move down/up"
doc.description = "move down"
```

Master Key validates this TOML file, providing inline linting of the file as you edit.

<!-- text between START_/STOP_ comments is extracted and inserted into the docs -->
<!-- START_DOCS -->
<!-- @file guide.md -->
<!-- @order 1 -->

## Getting Started

The easiest way to get started is to activate the built-in keybindings that come with Master Key.

1. Install this extension
2. On windows only: restart VSCode — there is an [active investigation to avoid this workaround](https://github.com/haberdashPI/vscode-master-key/issues/51).
3. Run the command `Master Key: Activate Keybindings`
4. Select the built-in binding set "Larkin"
5. Review [Larkin's documentation](https://haberdashpi.github.io/vscode-master-key/presets/larkin) (e.g. using `Master Key: Show Text Documentation`)

<!-- STOP_DOCS -->

You can start creating your own bindings based off an available preset using `Master key: New Keybinding Copy`: this will open a TOML file and insert the preset bindings into the file.

You can revert back to the state before master keybindings was installed using `Master Key: Deactivate Keybindings`.

To learn more about how to use Master Key [read the documentation](https://haberdashpi.github.io/vscode-master-key).

## Feature Tour

### Visual documentation of keybindings

Learn and review your bindings on a keyboard layout:

![example of visual docs](images/readme/visualdoc.jpg)

### Cheat sheet of keybindings

Review your bindings in the text documentation

![example of cheat sheet](images/readme/cheatsheet.png)

### Keybinding hints

See a sidebar listing possible bindings for the current mode and prefix of keys already pressed:

<img src="images/readme/palette.png" width="400" alt="example of palette">

The example above shows some of the bindings available in normal mode.

## Editing Features

Here are some of the cool editing features that come with the built-in `Larkin` keybindings provided by Master Key with the help of [selection utilities](https://github.com/haberdashPI/vscode-selection-utilities). These bindings follow in the footsteps of Vim, Kakoune and Helix.

### Move by Object

Select by word, line, paragraph and more:

![examples of moving by word, line and paragraph](images/readme/selectby.webp)

Expand by indent, quotes and brackets:

![examples of expanding by indent, quote and brackets](images/readme/expandby.webp)

Once you've selected the object, run commands to do stuff (e.g. delete/change/comment)

### Multi-Cursor Creation and Filtering

Quickly create multiple selections, by splitting selections:

![example of splitting a selection](images/readme/splitselect.webp)

matching by word:

![example of selecting by match](images/readme/selectmatch.webp)

or using saved selections:

![example of using saved selections](images/readme/selectsaved.webp)

Filter out the ones you don't want, either by pattern:

![example of filtering selections](images/readme/filterselect.webp)

or manual removal:

![example of seelection deletion](images/readme/deleteselect.webp)

### Exchange Objects

Swap selected objects with one another:

![example of text exchange](images/readme/exchangetext.webp)

### Repeat Last Selection / Action

Avoid lengthy key sequences by repeating the last action-related selection with "," and the last action with ".":

![example of repeating select/action](images/readme/repeat.webp)

### Record Commands

Record longer command sequences and replay them. These are sometimes referred to as keyboard macros:

![example of recording key sequence](images/readme/record.webp)

> [!NOTE]
> Command recording comes with a few limitations. Master key can record some edits, and any commands that are issued through master key bindings. Commands that are not part of this binding file (e.g. a standard call to Cmd/Ctrl+V to paste) will not be recorded. Also note that some edits cannot be recordings using VSCode's API (e.g. automated completion of parenthesis).

### Symmetric Insert

Insert or remove appropriate characters before and after each selection:

![example of syminsert mode](images/readme/syminsert.webp)

## Keybinding Features

When you create your own keybindings using Master Key's special `.toml` keybinding format you get several powerful features that make it possible to easily create keybindings that would be difficult or impossible to implement without writing your own extension.

### Modal Bindings

Your bindings can be modal—a special key (like escape) switches you to a different mode where all the keys on your keyboard can be used to issue commands specific to that mode.

```toml
[[bind]]
key = "j"
mode = "normal"
command = "cursorMove"
args.to = "down"
```

### Parameteric Bindings

Express an entire series of bindings using the `foreach` field.

```toml
[[bind]]
foreach.num = ['{{key(`[0-9]`)}}']
doc.name = "count {{num}}"
key = "{{num}}"
command = "master-key.updateCount"
args.value = "{{num}}"
```

### Stateful Bindings

Update state with the `master-key.captureKeys`, `master-key.updateCount`, `master-key.setValue` and then use this state in downstream commands using
expressions surrounded in `{{}}`

```toml
[[bind]]
doc.name = "between pair"
key = "m t"
description = """
Select between a pair of the specified character. Example: `m t '` would
select all characters that fell between two single quote characters.
"""
command = "runCommands"

[[bind.args.commands]]
command = "master-key.captureKeys"
args.acceptAfter = 1

[[bind.args.commands]]
command = "selection-utilities.selectBetween"
args.str = "{{key.captured}}"
args.fartherBoundary = false
```

### Record and Repeat Commands

Master key records recent key presses, allowing you to create commands that quickly repeat a previous sequence using `master-key.replayFromHistory` or `master-key.pushHistoryToStack` and `master-key.replayFromStack`. You can determine how much history is recorded by setting `master-key.maxCommandHistory` in your settings.

```toml
[[bind]]
default = "{{bind.edit_motion}}"
key = ";"
doc.name = "repeat motion"
doc.description = """
Repeat the last motion command. Motions usually move the cursor or change the selection.
"""
repeat = "{{key.count}}"
command = "master-key.replayFromHistory"
args.index = """{{
last_history_index(|i| {
    (history[i]?.tags?.contains("motion") ?? false) &&
    (history[i]?.doc?.name != "repeat motion" ?? false) &&
    (history[i]?.doc?.name != "shrink selection" ?? false)
})
}}"""
```

### Documented Bindings

Of course, just like all of the built-in bindings in Master Key, you can document your bindings so that they show up legibly within the discoverability features above. The toml file is a literate document used to generate the textual documentation and all bindings' names will show up in the visual documentation as appropriate.

## Developer Notes

This repository was designed to be worked with in unix-like environments. No effort to support development on Windows has been made. The setup relies on a working version of `mise` installed. You can satisfy this requirement by copying and running the following in bash.

```sh
curl https://mise.run | sh
```

You can then install all dependencies for this project as follows:

```sh
mise activate
mise install
```
