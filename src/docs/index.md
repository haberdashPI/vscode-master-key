---
layout: home

hero:
  name: "Master Key"
  text: "VSCode Keybinding Customization"
  tagline: >
    Master your keybindings with documentation, discoverability, modal bindings, macros
    and expressive configuration
  actions:
    - theme: brand
      text: User Guide
      link: /guide.md
    - text: Binding Definitions
      theme: alt
      link: /bindings.md
    - text: Commands
      theme: alt
      link: /commands.md

features:
    - title: Keybinding Discoverability
      details: >
        Bindings show up on a keyboard visualization. Binding files are literate TOML that is converted into markdown documentation. Multi-key sequences reveal a popup list of suggested keybinding completions (ala Kakaune / Helix / LazyVim).
    - title: Record and repeat commands
      details: >
        Record sequences of commands and parametrically select which ones to replay.
    - title: Rich, parametric keybinding specification
      details: >
        Modal bindings, simple `foreach` expressions, per-mode onType events, expression evaluation, cross-command state management
---

<!-- TODO: image? -->

Master Key was envisioned as a set of tools to make it easy to create powerful keybinding specifications that match your editor style of choice (modal, chorded, etc...). There are extensive options for [customizing your bindings](guide#customizing-bindings).
