# Master Key

Master your keybindings with this powerful keybinding utility!

If you appreciate the power of vim, emacs, kakaune, helix, or any other well made text editor OR if you aren't familiar with these tools, but want to learn, Master Key might be right for you.

There are two ways to use this extension: using an existing preset you can learn from the
built-in documentation and discoverable commands Master Key provides; OR you can
build your own customized set of keybindings based off one of these presets or your own existing keybindings.

When you use one Master Key's preset keybindings, and you will get:

1. Visual documentation of all keybindings
2. Thorough tables listing all keybindings organized by category
3. Context specific command palette: All defined keybindings can be searched based on their
  name and description. Furthermore, if you are in the middle of typing a multi-key sequence
  you can query for just the keybindings that have that key sequence as a prefix.
4. Easily repeat any sequences of existing commands by recording them (keyboard macros), so
  long as the commands are defined through Master Key. (It is easy to take existing commands
  from another extension add and them as Master Key commands)

To create your own custom keybindings you express them in a special file, which is a superset of the standard VSCode keybinding format. In addition to JSON, Master Keys
also supports TOML and YAML. You can start by copy/pasting your existing keybindings
or build from one of the existing Master Key presets.

This file format extends VSCode's built in keybinding format in several ways.

1. Support for documentation: by documenting each binding with a short name, description,
and kind, Master Key can automatically generate helpful visual documentation of your keybindings

3. Recording each key press: when Master Key reads your keybindings it converts all commands by wrapping them in `master-key.do`, which executes the specified command
and records the action. This lets you implement keyboard macro's or Vim's "repeat action"

4. Computed arguments: `master-key-.do` let's you store values with one command (e.g. the
number of times to repeat the next command) and pass that value as an argument to the next command; this is how Master Key's preset for Vim and Emacs let you repeat the same command many times.

5. Modal bindings: ala Vim, you can define specific keyboard modes, and the sets
of keybindings that are supported in that mode

## Developer Notes

This repo relies on a working version of `nvm` installed in bash and a npm version matching
the version specified in `.nvmrc`. You can satisfy this requirement by copying and running the
following in bash.

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
