# Master Key

Master your keybindings, with:
- **clear and discoverable visual documentation**
- **leveled-up keybinding format**: modal bindings, set values, evaluate simple expressions, parameteric multi-binding specifications; in-short enough power to make vim or emacs-like keybindings easy to define
- **keyboard macros**: record/replay repetitive sequences of keys (with some caveats)

If you appreciate the power of vim, emacs, kakaune, helix, or any other well made text
editor OR if you aren't familiar with these tools, but want to learn how to level up your
text editing skills, Master Key might be right for you.

There are two ways to use this extension: using a pre-existing keybinding preset, or creaging your own custom bindings.

## Using an existing preset

When you use an existing preset you get:

1. A keyboard-layout visual documentation guide of all keybindings
2. Standard documentation of all keybindings
3. Context specific command palette: All defined keybindings can be searched for based on
  their name and description. Furthermore, if you are in the middle of typing a multi-key
  sequence, or in a specific key mode, you can query for just the keybindings that have that
  key sequence as a prefix and/or mode.
4. Easily repeat any sequences of existing commands by recording them (keyboard macros), so
  long as the commands are defined through Master Key. It is easy to take existing commands
  from another extension and add them to Master Key's keybinding file, just copy/paste from the default keybindings.

There are four available presets:

1. Vim: bindings most similar to vim's defaults
2. Emacs: bindings most similar to emacs's defaults
3. Kakoune: bindings most similar to kakoune's defaults
4. Larkin: a custom keybinding set, inspired by kakaune, unique to Master Key

Note that Master Key does not aim to perfectly replicate any pre-existing editor (if that's
your goal, you will probably be happier using one of the extensions already built for that
purpose); Instead, it uses the design of each as an inspiration for keybindings that provide
a VSCode native experience that is discoverable and highly customizable.

## Creating custom bindings

To create your own custom keybindings, you express them in a special file, which supports a
superset of the standard VSCode keybinding format. You can start by copy/pasting your
existing keybindings or build from one of the existing Master Key presets. In addition to
JSON, Master Keys also supports TOML and YAML file formats and can import your existing keybindings into any of these three formats.

Master Key's file format extends VSCode's built in keybinding format in several ways.

1. Support for documentation: by providing a little extra information for each binding,
   Master Keys can automatically generate helpful visual and textual documentation for your
   keybindings

3. Recording each key press: when Master Key reads your keybindings it converts all commands
   by wrapping them in `master-key.do`, which executes the specified command and records the
   result. This lets you implement keyboard macro's or things like Vim's "repeat action"

4. Modal bindings: ala Vim, you can define specific keyboard modes, and then define
   some of your bindings to be specific to a given mode.

5. Computed arguments: `master-key.set` and `master-key.do` allows you to set and compute
   values; for example in vim, typing 5dj in normal mode will delete the current line and
   the next 5 lines below it. This command is implemented in Master Key's vim preset by
   using computed arguments.

6. Default bindings: some bindings are small variations on other keybindings. The extended
   format allows you to define nested defaults that make it easy to only specify the
   parts of each binding that are unique to a given category of binding.

7. Multi-binding entries: Bindings can even be defined by passing an array of different
   bindings to the `key` property, with the other properties of binding defined parametrically w.r.t to each value `key` can be.

8. Definitions: for any values you wish to re-use across many bindings you can define these
   in the `define` section of the file, and reference them in the keybindings that
   require their use.

Files are thoroughly validated before their use, proactively identifying a variety of
errors.

## Related Extensions

- [VSCodeVim](https://github.com/VSCodeVim/Vim)
- [vscode-neovim](https://github.com/asvetliakov/vscode-neovim)
- [Awesome Emacs Keymap](https://github.com/whitphx/vscode-emacs-mcx)
- [Dance](https://github.com/71/dance)
- [ModalEdit](https://github.com/johtela/vscode-modaledit)
- [ModalKeys](https://github.com/haberdashPI/vscode-modal-keys)

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

**TODO**: this should really document the use of the debug-profile file
