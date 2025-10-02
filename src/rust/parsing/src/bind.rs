#[allow(unused_imports)]
use log::info;

use indexmap::IndexMap;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::convert::identity;
use toml::Spanned;
use wasm_bindgen::prelude::*;

pub mod command;
pub mod foreach;
pub mod validation;

use crate::bind::command::{Command, regularize_commands};
use crate::bind::validation::{BindingReference, KeyBinding};
use crate::err;
use crate::error::{ErrorContext, Result, ResultVec, err};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Expression, TypedValue, Value};
use crate::resolve;
use crate::util::{Merging, Plural, Required, Resolving};

pub const UNKNOWN_RANGE: core::ops::Range<usize> = usize::MIN..usize::MAX;

fn span_required_default<T>() -> Spanned<Required<T>> {
    return Spanned::new(UNKNOWN_RANGE, Required::DefaultValue);
}

fn span_plural_default() -> Spanned<TypedValue<Plural<String>>> {
    return Spanned::new(UNKNOWN_RANGE, TypedValue::default());
}

//
// ================ `[[bind]]` parsing ================
//

/// @bindingField bind
/// @description an actual keybinding; extends the schema used by VSCode's `keybindings.json`
///
/// **Example**
///
/// ```toml
/// [[bind]]
/// doc.name = "←"
/// key = "h"
/// mode = "normal"
/// command = "cursorLeft"
/// ```
/// In the below field descriptions note that:
///
/// - ❗ denotes a required field.
/// - ⚡ denotes that a field can include runtime [expressions](/expressions/index)
///
/// ## Fields
///
#[allow(non_snake_case)]
#[derive(Deserialize, Clone, Debug)]
pub struct BindingInput {
    // implementation detail of `BindingInput`: this field should only be `Some` when used
    // as a part of an entry to `Define`. It is removed downstream using `without_id`.
    pub(crate) id: Option<Spanned<String>>,

    /// @forBindingField bind
    ///
    /// - ❗`key`: the
    ///   [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that
    ///   triggers `command`.
    #[serde(default = "span_required_default")]
    pub key: Spanned<Required<KeyBinding>>,

    /// @forBindingField bind
    ///
    /// - ❗`command`: A string denoting the command to execute. This is a command defined by
    ///   VSCode or an extension thereof. See [finding commands](#finding-commands). This
    ///   field has special behavior when set to`runCommands` (see
    ///   [running multiple commands](#running-multiple-commands)).
    #[serde(default = "span_required_default")]
    pub command: Spanned<Required<TypedValue<String>>>,

    /// @forBindingField bind
    ///
    /// - ⚡ `args`: The arguments to directly pass to `command`. Args may include
    ///    runtime evaluated [expressions](/expressions/index).
    pub args: Option<Spanned<Value>>,

    /// @forBindingField bind
    ///
    /// - `when`: A [when clause](https://code.visualstudio.com/api/references/when-clause-contexts)
    ///   context under which the binding will be active. Also see Master Key's
    ///   [available contexts](#available-when-contexts)
    pub when: Option<Spanned<TypedValue<String>>>,
    /// @forBindingField bind
    ///
    /// - `mode`: The mode during which the binding will be active. The default mode is
    ///   used when this field is not specified (either directly or via the `defaults`
    ///   field). You can also make use of an [expression](/expressions/index)
    ///   that will be evaluated while the bindings are being parsed. There are two
    ///   available functions of use here:
    ///   [`all_modes`](/expressions/functions#all_modes) and
    ///   [`not_modes`](/expressions/functions#not_modes)
    pub mode: Option<Spanned<TypedValue<Plural<String>>>>,
    /// @forBindingField bind
    ///
    /// - `priority`: The ordering of the keybinding relative to others; determines which
    ///   bindings take precedence. Defaults to 0.
    pub priority: Option<Spanned<TypedValue<f64>>>,
    /// @forBindingField bind
    ///
    /// - `default`: the default values to use for fields, specified as
    ///    string of the form <span v-pre>`{{bind.[name]}}`</span>.
    ///    See [`define`](/bindings/define) for more details.
    pub default: Option<Spanned<BindingReference>>,
    /// @forBindingField bind
    ///
    /// - `foreach`: Allows parametric definition of multiple keybindings, see
    ///   [`foreach` clauses](#foreach-clauses).
    #[serde(default)]
    pub foreach: Option<IndexMap<String, Vec<Spanned<Value>>>>,

    /// @forBindingField bind
    ///
    /// - `prefixes`: array of strings or an expression of producing such an array.
    ///   (see also [`all_prefixes`](expressions/functions#all_prefixes)).
    ///   The prefixes determine one or more *unresolved* key
    ///   sequences that can have occurred before typing this key. See
    ///   [`master-key.prefix`](/commands/prefix) for details. Defaults to `""` (a.k.a.
    ///   no prefix is allowed). Setting this to <code v-pre>{{all_prefixes}}</code>,
    ///   will allow a key binding to work regardless of any unresolved key
    ///   sequence that has been pressed: this is how `esc` is defined to work
    ///   in Larkin.
    #[serde(default = "span_plural_default")]
    pub prefixes: Spanned<TypedValue<Plural<String>>>,

    /// @forBindingField bind
    ///
    /// - `finalKey`: (boolean, default=true) Whether this key should clear any transient
    ///   state associated with the pending keybinding prefix. See
    ///   [`master-key.prefix`](/commands/prefix) for details.
    pub finalKey: Option<Spanned<TypedValue<bool>>>,

    /// @forBindingField bind
    ///
    /// - ⚡ `repeat`: The number of times to repeat the command; this can be a runtime
    ///   [expression](/expressions/index). This defaults to zero: one repeat means the
    ///   command is run twice. The most common use case here is to set this to <span
    ///   v-pre>`'{{key.count}}'`</span> for a command that does not accept a count value as
    ///   an argument.
    repeat: Option<Spanned<TypedValue<i32>>>,

    /// @forBindingField bind
    ///
    /// - `tags`: An array of strings used to characterize the behavior of the binding. They
    /// have no inherent meaning but are often used when filtering which commands in a call
    /// to [`master-key.replayFromHistory`](/commands/replayFromHistory/) can be replayed.
    #[serde(default = "span_plural_default")]
    tags: Spanned<TypedValue<Plural<String>>>,

    /// @forBindingField bind
    ///
    /// - `doc`: Documentation for this keybinding. None of the fields of this object
    ///   impact the behavior of the keybinding, only the interactive documentation
    ///   features describing keybindings.
    doc: Option<BindingDocInput>,
}

/// @forBindingField bind
/// @order 20
///
/// ## Finding Commands
///
/// You can find commands in a few ways:
///
/// - Find command you want to use from the command palette, and click on the gear (`⚙︎`)
///   symbol to copy the command string to your clipboard
/// - Review the [list of built-in
///  commands](https://code.visualstudio.com/api/references/commands/index)
/// - Run the command `Preferences: Open Default Keyboard Shortcuts (JSON)` to get a list of
///   built-in commands and extension commands already associated with a keybinding
///
/// Furthermore, you can also use:
///
/// - [Master Key Commands](/commands/index)
/// - [Selection Utility
///   Commands](https://haberdashpi.github.io/vscode-selection-utilities/)
///
/// Selection Utilities is a complimentary extension used extensively by the `Larkin`
/// preset.
///
/// ## Available `when` Contexts
///
/// Each keybinding can make use of any context defined in VSCode across any extension.
/// Master Key adds the follow contexts:
///
/// - `master-key.mode`: the current keybinding mode
/// - `master-key.count`: The current count, as defined by
///   [`master-key.updateCount`](/commands/updateCount)
/// - `master-key.captured`: The text currently captured by the most recent call to
///   [`master-key.restoreNamed`](/commands/restoreNamed) or
///   [`master-key.captureKeys`](/commands/captureKeys).
/// - `master-key.prefix`: The currently active [keybinding prefix](/commands/prefix)
/// - `master-key.record`: a boolean flag used to indicate when keys are marked for
///   recording
/// - `master-key.val.[name]`: the current value of a
///   [defined variable](/bindings/define#variable-definitions).
/// - `master-key.keybindingPaletteBindingMode`: true when the suggestion palette accepts
///   keybinding key presses, false it accepts a string to search the descriptions of said
///   keybindings
/// - `master-key.keybindingPaletteOpen`: true when the suggestion palette is open
///

impl BindingInput {
    // removes `id` field, this field is an implementation detail and should only be present
    // as a part of a `Define` object.
    pub(crate) fn without_id(&self) -> Self {
        return BindingInput {
            id: None,
            command: self.command.clone(),
            args: self.args.clone(),
            key: self.key.clone(),
            when: self.when.clone(),
            mode: self.mode.clone(),
            priority: self.priority.clone(),
            default: self.default.clone(),
            foreach: self.foreach.clone(),
            prefixes: self.prefixes.clone(),
            finalKey: self.finalKey.clone(),
            repeat: self.repeat.clone(),
            tags: self.tags.clone(),
            doc: self.doc.clone(),
        };
    }
}

impl Merging for BindingInput {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, y: Self) -> Self {
        BindingInput {
            id: y.id,
            command: self.command.coalesce(y.command),
            args: self.args.merge(y.args),
            key: self.key.coalesce(y.key),
            when: self.when.coalesce(y.when),
            mode: self.mode.coalesce(y.mode),
            priority: self.priority.coalesce(y.priority),
            default: self.default.coalesce(y.default),
            foreach: self.foreach,
            prefixes: self.prefixes.coalesce(y.prefixes),
            finalKey: self.finalKey.coalesce(y.finalKey),
            repeat: self.repeat.coalesce(y.repeat),
            tags: self.tags.coalesce(y.tags),
            doc: self.doc.merge(y.doc),
        }
    }
}

impl Expanding for BindingInput {
    fn is_constant(&self) -> bool {
        [
            self.command.is_constant(),
            self.args.is_constant(),
            self.key.is_constant(),
            self.when.is_constant(),
            self.mode.is_constant(),
            self.priority.is_constant(),
            self.default.is_constant(),
            self.foreach.is_constant(),
            self.prefixes.is_constant(),
            self.finalKey.is_constant(),
            self.repeat.is_constant(),
            self.tags.is_constant(),
            self.doc.is_constant(),
        ]
        .into_iter()
        .all(identity)
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(Expression) -> Result<Value>,
    {
        let mut errors = Vec::new();
        let result = BindingInput {
            id: self.id,
            foreach: self.foreach.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            command: self.command.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                Spanned::new(UNKNOWN_RANGE, Required::DefaultValue)
            }),
            args: self.args.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            key: self.key.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                Spanned::new(UNKNOWN_RANGE, Required::DefaultValue)
            }),
            when: self.when.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            mode: self.mode.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            priority: self.priority.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            default: self.default.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            prefixes: self.prefixes.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                Spanned::new(UNKNOWN_RANGE, TypedValue::default())
            }),
            finalKey: self.finalKey.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            repeat: self.repeat.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            tags: self.tags.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                Spanned::new(UNKNOWN_RANGE, TypedValue::default())
            }),
            doc: self.doc.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
        };
        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(result);
        }
    }
}

//
// ---------------- `bind.doc` parsing ----------------
//

#[allow(non_snake_case)]
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct BindingDocInput {
    /// @forBindingField bind
    /// @order 10
    ///
    /// ## Documentation
    ///
    /// The documentation object `bind.doc` is composed of the following fields
    ///
    /// - `name`: A very brief description for the command; this must fit in the visual
    ///   documentation of keybindings so it shouldn't be much longer than five characters for most
    ///   keys. Favor unicode symbols such as →/← over text like left/right.
    #[serde(default)]
    pub name: Option<Spanned<TypedValue<String>>>,

    /// @forBindingField bind
    /// @order 10
    ///
    /// - `description`: A sentence or two about the command. Save more detailed descriptions
    ///   for the comments around your keybindings: the keybinding file is a literate
    ///   document and all users can see these comments when reviewing the textual documentation.
    #[serde(default)]
    pub description: Option<Spanned<TypedValue<String>>>,
    /// @forBindingField bind
    /// @order 10
    ///
    /// - `hideInPalette/hideInDocs`: whether to show the keys in the popup suggestions
    ///   and the documentation. These both default to false.
    #[serde(default)]
    pub hideInPalette: Option<Spanned<TypedValue<bool>>>,
    #[serde(default)]
    pub hideInDocs: Option<Spanned<TypedValue<bool>>>,

    /// @forBindingField bind
    /// @order 10
    ///
    /// - `combined.name/combined.key/combined.description`: in the suggestion palette and
    ///   textual documentation, keys that have the same `combined.name` will be
    ///   represented as single entry, using the `combined.key` and `combined.description`
    ///   instead of `key` and `description`. The `combined.key` for a multi-key sequence
    ///   should only include the suffix key. You need only define `combined.key` and
    ///   `combined.description` once across keys that share the same `combined.name`
    ///   entry.
    #[serde(default)]
    pub combined: Option<CombinedBindingDocInput>,

    /// @forBindingField bind
    /// @order 10
    ///
    /// - `kind`: The broad cagegory of commands this binding falls under. There should
    ///   be no more than 4-5 of these. Each `kind` here should have a corresponding
    ///   entry in the top-level `kind` array.
    #[serde(default)]
    pub kind: Option<Spanned<TypedValue<String>>>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct CombinedBindingDocInput {
    #[serde(default)]
    pub name: Option<Spanned<TypedValue<String>>>,
    #[serde(default)]
    pub key: Option<Spanned<TypedValue<String>>>,
    #[serde(default)]
    pub description: Option<Spanned<TypedValue<String>>>,
}

impl Merging for BindingDocInput {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, y: Self) -> Self {
        BindingDocInput {
            name: self.name.coalesce(y.name),
            description: self.description.coalesce(y.description),
            hideInPalette: self.hideInPalette.coalesce(y.hideInPalette),
            hideInDocs: self.hideInDocs.coalesce(y.hideInDocs),
            combined: self.combined.merge(y.combined),
            kind: self.kind.coalesce(y.kind),
        }
    }
}

impl Merging for CombinedBindingDocInput {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }

    fn merge(self, y: Self) -> Self {
        CombinedBindingDocInput {
            name: self.name.coalesce(y.name),
            key: self.key.coalesce(y.key),
            description: self.description.coalesce(y.description),
        }
    }
}

impl Expanding for BindingDocInput {
    fn is_constant(&self) -> bool {
        return self.name.is_constant()
            && self.description.is_constant()
            && self.hideInPalette.is_constant()
            && self.hideInDocs.is_constant()
            && self.combined.is_constant()
            && self.kind.is_constant();
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        Self: Sized,
        F: FnMut(Expression) -> Result<Value>,
    {
        let mut errors = Vec::new();
        let result = BindingDocInput {
            name: self.name.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            description: self.description.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            hideInPalette: self
                .hideInPalette
                .map_expressions(f)
                .unwrap_or_else(|mut e| {
                    errors.append(&mut e.errors);
                    None
                }),
            hideInDocs: self.hideInDocs.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            combined: self.combined.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            kind: self.kind.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
        };
        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(result);
        }
    }
}

impl Expanding for CombinedBindingDocInput {
    fn is_constant(&self) -> bool {
        return self.name.is_constant() && self.key.is_constant() && self.description.is_constant();
    }

    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        Self: Sized,
        F: FnMut(Expression) -> Result<Value>,
    {
        let mut errors = Vec::new();
        let result = CombinedBindingDocInput {
            name: self.name.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            key: self.key.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            description: self.description.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
        };
        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(result);
        }
    }
}

impl Resolving<BindingDoc> for Option<BindingDocInput> {
    fn resolve(self, _name: &'static str, scope: &mut Scope) -> ResultVec<BindingDoc> {
        match self {
            Some(doc) => Ok(BindingDoc::new(doc, scope)?),
            Option::None => Ok(BindingDoc::default()),
        }
    }
}

impl Resolving<Option<CombinedBindingDoc>> for Option<CombinedBindingDocInput> {
    fn resolve(
        self,
        _name: &'static str,
        scope: &mut Scope,
    ) -> ResultVec<Option<CombinedBindingDoc>> {
        return match self {
            Some(doc) => Ok(Some(CombinedBindingDoc::new(doc, scope)?)),
            Option::None => Ok(None),
        };
    }
}

//
// ================ `[[bind]]` object ================
//

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct Binding {
    pub key: Vec<String>,
    pub(crate) commands: Vec<Command>,
    pub when: Option<String>,
    pub mode: Vec<String>,
    pub priority: f64,
    pub prefixes: Vec<String>,
    pub finalKey: bool,
    pub(crate) repeat: TypedValue<i32>,
    pub tags: Vec<String>,
    pub doc: BindingDoc,
}

const BARE_KEY_CONTEXT: &str = "(editorTextFocus || master-key.keybindingPaletteOpen \
                 && master-key.keybindingPaletteBindingMode)";

lazy_static! {
    static ref WHITESPACE: Regex = Regex::new(r"\s+").unwrap();
    static ref NON_BARE_KEY: Regex = Regex::new(r"(?i)Ctrl|Alt|Cmd|Win|Meta").unwrap();
    static ref EDITOR_TEXT_FOCUS: Regex = Regex::new(r"\beditorTextFocus\b").unwrap();
}

#[wasm_bindgen]
impl Binding {
    pub fn repeat(&mut self, scope: &mut Scope) -> ResultVec<i32> {
        return scope.expand(&self.repeat)?.resolve("`repeat`", scope);
    }

    pub fn commands(&self, scope: &mut Scope) -> ResultVec<Vec<Command>> {
        let mut commands = scope.expand(&self.commands)?;
        for _ in 1..10 {
            if commands.is_constant() {
                break;
            } else {
                commands = scope.expand(&commands)?;
            }
        }
        commands.require_constant()?;

        let mut regular_commands = Vec::new();
        for command in commands {
            let mut sub_commands = regularize_commands(&command, scope)?;
            regular_commands.append(&mut sub_commands)
        }

        let commands: Vec<_> = regular_commands
            .into_iter()
            .filter(|x| !bool::from(x.skipWhen.clone()))
            .collect();

        // finalKey validation
        let has_prefix = commands.iter().any(|c| c.command == "master-key.prefix");
        #[allow(non_snake_case)]
        if has_prefix && !self.finalKey {
            return Err(err(
                "`finalKey` must be `false` when `master-key.prefix` is run",
            ))?;
        }

        return Ok(commands);
    }

    pub(crate) fn new(input: BindingInput, scope: &mut Scope) -> ResultVec<Self> {
        let commands = regularize_commands(&input, scope)?;

        // id validation
        if let Some(_) = input.id {
            return Err(err("`id` field is reserved"))?;
        }

        // foreach validation
        if let Some(_) = input.foreach {
            return Err(err("`foreach` included unresolved variables"))?;
        }

        // finalKey validation
        let has_prefix = commands.iter().any(|c| c.command == "master-key.prefix");
        #[allow(non_snake_case)]
        let finalKey: bool = resolve!(input, finalKey, scope)?;
        if has_prefix && !finalKey {
            return Err(err(
                "`finalKey` must be `false` when `master-key.prefix` is run",
            ))?;
        }

        // mode validation
        let (mode_span, mode) = match input.mode {
            Some(ref mode) => (mode.span().clone(), mode.clone().resolve("mode", scope)?),
            Option::None => (UNKNOWN_RANGE, vec![scope.default_mode.clone()]),
        };
        let undefined_modes: Vec<_> = mode
            .iter()
            .filter(|x| !scope.modes.contains(x.as_str()))
            .collect();
        if undefined_modes.len() > 0 {
            return Err(err!(
                "Undefined mode(s): {}",
                undefined_modes
                    .iter()
                    .map(|x| x.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
            .with_range(&mode_span)?;
        }

        // require that bare keybindings (those without a modifier key)
        // be specific to `textEditorFocus` / `keybindingPaletteOpen` context
        let key_string: String = resolve!(input, key, scope)?;
        let key: Vec<_> = WHITESPACE.split(&key_string).map(String::from).collect();
        let mut when: Option<String> = resolve!(input, when, scope)?;
        when = if !NON_BARE_KEY.is_match(&key[0]) {
            if let Some(w) = when {
                Some(format!("({}) && {BARE_KEY_CONTEXT}", w))
            } else {
                Some(BARE_KEY_CONTEXT.to_string())
            }
        } else {
            Some(
                EDITOR_TEXT_FOCUS
                    .replace_all(&(when.unwrap()), BARE_KEY_CONTEXT)
                    .to_string(),
            )
        };

        // resolve all keys to appropriate types
        let result = Binding {
            commands: commands,
            key,
            when,
            mode,
            priority: resolve!(input, priority, scope)?,
            prefixes: resolve!(input, prefixes, scope)?,
            finalKey,
            repeat: resolve!(input, repeat, scope)?,
            tags: resolve!(input, tags, scope)?,
            doc: resolve!(input, doc, scope)?,
        };

        return Ok(result);
    }
}
//
// ---------------- `bind.doc` object ----------------
//

#[derive(Clone, Debug, Serialize, Default)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct BindingDoc {
    pub name: String,
    pub description: String,
    pub hideInPalette: bool,
    pub hideInDocs: bool,
    pub combined: Option<CombinedBindingDoc>,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Default)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct CombinedBindingDoc {
    name: String,
    key: String,
    description: String,
}

#[wasm_bindgen]
impl BindingDoc {
    pub(crate) fn new(input: BindingDocInput, scope: &mut Scope) -> ResultVec<Self> {
        return Ok(BindingDoc {
            name: resolve!(input, name, scope)?,
            description: resolve!(input, description, scope)?,
            hideInPalette: resolve!(input, hideInPalette, scope)?,
            hideInDocs: resolve!(input, hideInDocs, scope)?,
            combined: resolve!(input, combined, scope)?,
            kind: resolve!(input, kind, scope)?,
        });
    }
}

#[wasm_bindgen]
impl CombinedBindingDoc {
    pub(crate) fn new(input: CombinedBindingDocInput, scope: &mut Scope) -> ResultVec<Self> {
        return Ok(CombinedBindingDoc {
            name: resolve!(input, name, scope)?,
            key: resolve!(input, key, scope)?,
            description: resolve!(input, description, scope)?,
        });
    }
}

//
// ================ Tests ================
//

#[allow(non_snake_case)]
#[cfg(test)]
mod tests {
    use test_log::test;

    use rhai::Dynamic;
    use std::collections::HashMap;

    use super::*;
    #[test]
    fn complete_parsing() {
        let data = r#"
        command = "do"
        args = { a = "2", b = 3 }
        key = "a"
        when = "joe > 1"
        mode = "normal"
        priority = 1
        default = "{{bind.foo_bar}}"
        foreach.index = [1,2,3]
        prefixes = "c"
        finalKey = true
        repeat = "{{2+c}}"
        tags = ["foo", "bar"]
        doc.name = "foo"
        doc.description = "foo bar bin"
        doc.hideInPalette = false
        doc.hideInDocs = false
        doc.combined.name = "Up/down"
        doc.combined.key = "A/B"
        doc.combined.description = "bla bla bla"
        doc.kind = "biz"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();

        assert_eq!(
            String::from(result.command.into_inner().unwrap()),
            "do".to_string()
        );

        let args = result.args.unwrap().into_inner();
        assert_eq!(
            args,
            Value::Table(HashMap::from([
                ("a".into(), Value::String("2".into())),
                ("b".into(), Value::Integer(3))
            ]))
        );
        let key: String = result.key.into_inner().unwrap().into();
        assert_eq!(key, "a".to_string());
        let when: String = result.when.unwrap().into_inner().into();
        assert_eq!(when, "joe > 1".to_string());
        let mode: Vec<String> = resolve!(result, mode, &mut scope).unwrap();

        assert_eq!(mode, ["normal"]);
        let priority: f64 = result.priority.unwrap().into_inner().into();
        assert_eq!(priority, 1.0);
        assert_eq!(
            result.default.unwrap().into_inner().0,
            "foo_bar".to_string()
        );
        let foreach = result.foreach.unwrap();
        let values = foreach.get("index").unwrap();
        let numbers: Vec<Value> = values.iter().map(|it| it.clone().into_inner()).collect();
        assert_eq!(
            numbers,
            [Value::Integer(1), Value::Integer(2), Value::Integer(3)]
        );

        assert_eq!(when, "joe > 1".to_string());
        let prefixes: Vec<String> = resolve!(result, prefixes, &mut scope).unwrap();
        assert_eq!(prefixes, ["c"]);

        let finalKey: bool = resolve!(result, finalKey, &mut scope).unwrap();
        assert_eq!(finalKey, true);

        let tags: Vec<String> = resolve!(result, tags, &mut scope).unwrap();
        assert_eq!(tags, ["foo".to_string(), "bar".to_string()]);

        let doc = result.doc.unwrap();
        let name: String = resolve!(doc, name, &mut scope).unwrap();
        assert_eq!(name, "foo");

        let description: String = resolve!(doc, description, &mut scope).unwrap();
        assert_eq!(description, "foo bar bin");

        let hideInDocs: bool = resolve!(doc, hideInDocs, &mut scope).unwrap();
        assert_eq!(hideInDocs, false);

        let hideInPalette: bool = resolve!(doc, hideInPalette, &mut scope).unwrap();
        assert_eq!(hideInPalette, false);

        let combined: CombinedBindingDoc = resolve!(doc, combined, &mut scope).unwrap().unwrap();
        assert_eq!(combined.name, "Up/down");
        assert_eq!(combined.key, "A/B");
        assert_eq!(combined.description, "bla bla bla");

        let kind: String = resolve!(doc, kind, &mut scope).unwrap();
        assert_eq!(kind, "biz");
    }

    #[test]
    fn default_parsing() {
        let data = r#"
        key = "l"
        command = "cursorMove"
        args.to = "left"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        assert_eq!(
            String::from(result.key.into_inner().unwrap()),
            "l".to_string()
        );
        assert_eq!(
            String::from(result.command.into_inner().unwrap()),
            "cursorMove"
        );
        assert_eq!(
            result.args.unwrap().into_inner(),
            Value::Table(HashMap::from([("to".into(), Value::String("left".into()))]))
        );

        let when: Option<String> = resolve!(result, when, &mut scope).unwrap();
        assert_eq!(when, None);
    }

    #[test]
    fn simple_command_merging() {
        let data = r#"
        [[bind]]
        doc.name = "default"
        command = "cursorMove"
        prefixes = ["a"]

        [[bind]]
        key = "l"
        doc.name = "←"
        args.to = "left"
        prefixes = ["b", "c"]
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let mut scope = Scope::new();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let left = default.merge(left);

        let key: String = resolve!(left, key, &mut scope).unwrap();
        assert_eq!(key, "l".to_string());
        assert_eq!(
            String::from(left.command.into_inner().unwrap()),
            "cursorMove"
        );

        assert_eq!(
            left.args.unwrap().into_inner(),
            Value::Table(HashMap::from([("to".into(), Value::String("left".into()))]))
        );

        let prefixes: Vec<String> = resolve!(left, prefixes, &mut scope).unwrap();
        assert_eq!(prefixes, ["b".to_string(), "c".to_string()]);

        let doc = left.doc.unwrap();
        let combined: Option<CombinedBindingDoc> = resolve!(doc, combined, &mut scope).unwrap();
        assert!(combined.is_none());
    }

    #[test]
    fn merge_nested_arguments() {
        let data = r#"
            [[bind]]
            doc.name = "default"
            command = "cursorMove"
            args.foo = { a = 2, b = 3, c = { x = 1 } }

            [[bind]]
            key = "r"
            doc.name = "→"
            args.foo = { d = 12, c = { y = 2 } }

            [[bind]]
            key = "x"
            doc.name = "expected"
            args.foo = { a = 2, b = 3, c = { x = 1, y = 2 }, d = 12 }
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let expected = result.get("bind").unwrap()[2].clone();
        let left = default.merge(left);

        assert_eq!(left.args, expected.args);
    }

    #[test]
    fn merge_nested_array_arguments() {
        let data = r#"
            [[bind]]
            name = "default"
            command = "runCommands"

            [[bind.args.commands]]
            command = "step1"
            args.b = "bar"

            [[bind.args.commands]]
            command = "step2"
            args.x = "biz"

            [[bind]]
            name = "run"
            key = "x"
            command = "runCommands"

            [[bind.args.commands]]
            command = "step1"
            args.a = "foo"

            [[bind.args.commands]]
            command = "step2"
            args.y = "fiz"

            [[bind]]
            name = "run_merged"
            key = "x"
            command = "runCommands"

            [[bind.args.commands]]
            command = "step1"
            args = {a = "foo", b = "bar"}

            [[bind.args.commands]]
            command = "step2"
            args = {x = "biz", y = "fiz"}
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let expected = result.get("bind").unwrap()[2].clone();
        let left = default.merge(left);

        assert_eq!(left.args, expected.args);
    }

    #[test]
    fn expands_foreach() {
        let data = r#"
            foreach.a = [1, 2]
            foreach.b = ["x", "y"]
            doc.name = 'test {{a+1}}-{{b + "z"}}'
            command = "run-{{a}}"
            args.value = "with-{{b}}"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        scope.parse_asts(&result).unwrap();
        let items = result.expand_foreach(&mut scope).unwrap();

        let expected_command = vec!["run-1", "run-1", "run-2", "run-2"];
        let expected_value = vec!["with-x", "with-y", "with-x", "with-y"];
        let expected_name = vec!["test 2-xz", "test 2-yz", "test 3-xz", "test 3-yz"];

        for i in 0..4 {
            let item = items[i].clone();
            let command: String = resolve!(item, command, &mut scope).unwrap();
            assert_eq!(command, expected_command[i]);

            let name: String = resolve!(item.doc.unwrap(), name, &mut scope).unwrap();
            assert_eq!(name, expected_name[i]);
            let args: Option<toml::Value> = resolve!(item, args, &mut scope).unwrap();
            let mut expected_args = toml::Table::new();
            expected_args.insert(
                "value".to_string(),
                toml::Value::String(expected_value[i].into()),
            );
            assert_eq!(args.unwrap(), toml::Value::Table(expected_args));
        }
    }

    #[test]
    fn expand_foreach_keys() {
        let data = r#"
            foreach.key = ["{{keys(`[0-9]`)}}"]
            doc.name = "update {{key}}"
            command = "foo"
            args.value = "{{key}}"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        scope.parse_asts(&result).unwrap();
        let items = result.expand_foreach(&mut scope).unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(items.len(), 10);
        for i in 0..9 {
            let name: String = resolve!(items[i].doc.clone().unwrap(), name, &mut scope).unwrap();
            assert_eq!(name, expected_name[i]);
            let value: Option<toml::Value> = resolve!(items[i].clone(), args, &mut scope).unwrap();
            let mut table = toml::Table::new();
            table.insert(
                "value".to_string(),
                toml::Value::String(expected_value[i].clone()),
            );
            assert_eq!(value.unwrap(), toml::Value::Table(table));
        }
    }

    #[test]
    fn expand_args() {
        let data = r#"
            key = "k"
            doc.name = "test"
            command = "foo"
            args.value = '{{joe + "_biz"}}'
            args.number = '{{2+1}}'
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        scope.parse_asts(&input).unwrap();
        let result = Binding::new(input, &mut scope).unwrap();

        scope.state.set_or_push("joe", Dynamic::from("fiz"));
        let flat_args: toml::Value = result.commands(&mut scope).unwrap()[0].clone().args.into();

        let mut args_expected = toml::map::Map::new();
        args_expected.insert(
            "value".to_string(),
            toml::Value::String("fiz_biz".to_string()),
        );
        args_expected.insert("number".to_string(), toml::Value::Integer(3));
        assert_eq!(flat_args, toml::Value::Table(args_expected));
    }

    #[test]
    fn mode_validation() {
        let data = r#"
        key = "a"
        command = "foo"
        mode = "bar"
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let err = Binding::new(input, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("Undefined mode"));
        assert_eq!(report[0].range.start.line, 3);
    }

    #[test]
    fn final_key_validation() {
        let data = r#"
        key = "a"
        command = "runCommands"
        args.commands = ["a", "master-key.prefix"]
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let err = Binding::new(input, &mut scope).unwrap_err();
        let report = format!("{err}");
        assert!(report.contains("`finalKey`"));
    }

    #[test]
    fn bare_bindings_require_editor_focus() {
        let data = r#"
        key = "a"
        command = "foobar"
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let result = Binding::new(input, &mut scope).unwrap();
        assert!(result.when.unwrap().contains("editorTextFocus"))
    }

    #[test]
    fn editor_focus_expands_to_palette_focus() {
        let data = r#"
        key = "a"
        command = "foobar"
        when = "editorTextFocus && bizbaz"
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let result = Binding::new(input, &mut scope).unwrap();
        assert!(result.when.unwrap().contains("keybindingPaletteOpen"));
    }

    // TODO: are there any edge cases / failure modes I want to look at in the tests
    // (most of the things seem likely to be covered by serde / toml parsing, and the
    // stuff I would want to check should be done at a higher level when I'm working
    // through default resolution across multiple commands rather than the within
    // command tests I'm working on here)
}

// TODO: define the "output" type for `Binding` that can actually be passed to javascript
