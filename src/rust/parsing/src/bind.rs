#[allow(unused_imports)]
use log::info;

use core::ops::Range;
use indexmap::IndexMap;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::{Entry, OccupiedEntry};
use std::collections::{HashMap, HashSet};
use std::convert::identity;
use std::iter::Iterator;
use toml::Spanned;
use wasm_bindgen::prelude::*;

pub mod command;
pub mod foreach;
pub mod prefix;
pub mod validation;

use crate::bind::command::{Command, regularize_commands};
use crate::bind::prefix::{Prefix, PrefixInput};
use crate::bind::validation::{BindingReference, KeyBinding};
use crate::error::{ErrorContext, ParseError, Result, ResultVec, err};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Expression, TypedValue, Value};
use crate::resolve;
use crate::util::{Merging, Plural, Required, Resolving};
use crate::{err, wrn};

pub const UNKNOWN_RANGE: core::ops::Range<usize> = usize::MIN..usize::MAX;

fn span_required_default<T>() -> Spanned<Required<T>> {
    return Spanned::new(UNKNOWN_RANGE, Required::DefaultValue);
}

fn span_plural_default<T>() -> Spanned<TypedValue<Plural<T>>>
where
    T: Serialize + std::fmt::Debug + Clone,
{
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
    ///   bindings take precedence. Higher priorities take precedence over lower priorities.
    ///   Defaults to 0.
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
    /// - `prefixes`: expresses the allowed key sequences that occur *before* this
    /// keybinding using a call to [`master-key.prefix`](/commands/prefix). This is an object
    /// with one of three possible keys:
    ///   - `any`: when `true` any prefix is allowed before the binding, `false`
    ///   means no sequence can occur prior to this binding (this is the default behavior).
    ///   - `anyOf`: A single string or an array of strings, each an allowed prefix
    ///   - `allBut`: A single string or an array of strings; all prefixes *except*
    ///   those specified here are valid
    pub prefixes: Option<Spanned<PrefixInput>>,

    /// @forBindingField bind
    ///
    /// - `finalKey`: (boolean, default=true unless `master-key.prefix` is a command)
    ///   Whether this key should clear any transient state associated with the pending
    ///   keybinding prefix. See [`master-key.prefix`](/commands/prefix) for details. When
    ///   `master-key.prefix` is one of the commands in this binding, this field defaults to
    ///   `false`.
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

    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
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
            other_fields: self.other_fields.clone(),
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
            other_fields: y.other_fields,
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
                None
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
            other_fields: self.other_fields,
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

    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
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

    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
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
            other_fields: y.other_fields,
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
            other_fields: y.other_fields,
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
            other_fields: self.other_fields,
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
            other_fields: self.other_fields,
        };
        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(result);
        }
    }
}

//
// ================ Legacy `[[bind]]` warnings ================
//

// tracks fields that used to exist in [[bind]] in file format 1.0
// so that we can generate warnings
#[allow(non_snake_case)]
#[derive(Deserialize, Clone, Debug)]
pub struct LegacyBindingInput {
    computedArgs: Option<Spanned<toml::Value>>,
    path: Option<Spanned<toml::Value>>,
    mode: Option<Spanned<Plural<String>>>, // to check for `!` prefixed mode names etc...
    name: Option<Spanned<toml::Value>>,
    description: Option<Spanned<toml::Value>>,
    kind: Option<Spanned<toml::Value>>,
    hideInPalette: Option<Spanned<toml::Value>>,
    hideInDocs: Option<Spanned<toml::Value>>,
    combinedName: Option<Spanned<toml::Value>>,
    combinedDescription: Option<Spanned<toml::Value>>,
    combinedKey: Option<Spanned<toml::Value>>,
    resetTransient: Option<Spanned<toml::Value>>,
}

impl LegacyBindingInput {
    pub(crate) fn check(&self) -> ResultVec<()> {
        let mut errors = Vec::new();
        if let Some(spanned) = &self.computedArgs {
            let err: Result<()> = Err(wrn!(
                "`computedArgs` is no longer used in the 2.0 format; replace \
                  `computedArgs.f = \"x+1\"` with `args.f = '{}'`",
                "{{x+1}}"
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err());
        }

        if let Some(spanned) = &self.path {
            let err: Result<()> = Err(wrn!(
                "`path` no longer exists in the 2.0 format; replace \
                `path` with `default` and review changes in documentation",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }

        if let Some(spanned) = &self.mode {
            let span = spanned.span().clone();
            let Plural(modes) = spanned.as_ref().clone();
            if modes.iter().any(|s| s.starts_with("!")) {
                let err: Result<()> = Err(wrn!(
                    "file format 2.0 does not support excluding modes using \
                    `!mode_name`, use an expression like `{}` instead",
                    "{{not_modes([\"mode_name\"])}}"
                ))
                .with_range(&span);
                errors.push(err.unwrap_err())
            }

            if modes.len() == 0 {
                let err: Result<()> = Err(wrn!(
                    "2.0 does not use an empty array to indicate all modes are valid for \
                    a keybinding; use the expression `{}` instead",
                    "{{all_modes()}}"
                ))
                .with_range(&span);
                errors.push(err.unwrap_err())
            }
        }

        if let Some(spanned) = &self.name {
            let err: Result<()> = Err(wrn!(
                "`name` no longer exists in the 2.0 format; replace \
                `name` with `doc.name`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }
        if let Some(spanned) = &self.description {
            let err: Result<()> = Err(wrn!(
                "`description` no longer exists in the 2.0 format; replace \
                `description` with `doc.description`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }
        if let Some(spanned) = &self.kind {
            let err: Result<()> = Err(wrn!(
                "`kind` no longer exists in the 2.0 format; replace \
                `kind` with `doc.kind`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }
        if let Some(spanned) = &self.hideInPalette {
            let err: Result<()> = Err(wrn!(
                "`hideInPalette` no longer exists in the 2.0 format; replace \
                `hideInPalette` with `doc.hideInPalette`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }
        if let Some(spanned) = &self.hideInDocs {
            let err: Result<()> = Err(wrn!(
                "`hideInDocs` no longer exists in the 2.0 format; replace \
                `hideInDocs` with `doc.hideInDocs`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }

        if let Some(spanned) = &self.combinedName {
            let err: Result<()> = Err(wrn!(
                "`combinedName` no longer exists in the 2.0 format; replace \
                `combinedName` with `doc.combeind.name`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }
        if let Some(spanned) = &self.combinedDescription {
            let err: Result<()> = Err(wrn!(
                "`combinedDescription` no longer exists in the 2.0 format; replace \
                `combinedDescription` with `doc.combeind.description`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }
        if let Some(spanned) = &self.combinedKey {
            let err: Result<()> = Err(wrn!(
                "`combinedKey` no longer exists in the 2.0 format; replace \
                `combinedKey` with `doc.combeind.key`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }

        if let Some(spanned) = &self.resetTransient {
            let err: Result<()> = Err(wrn!(
                "`resetTransient` no longer exists in the 2.0 format; replace \
                `resetTransient` with `finalKey`",
            ))
            .with_range(&spanned.span());
            errors.push(err.unwrap_err())
        }

        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(());
        }
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
    pub(crate) prefixes: Prefix,
    pub finalKey: bool,
    pub(crate) repeat: TypedValue<i32>,
    pub tags: Vec<String>,
    pub doc: BindingDoc,
}

const TEXT_FOCUS_CONDITION: &str = "(editorTextFocus || master-key.keybindingPaletteOpen \
                 && master-key.keybindingPaletteBindingMode)";

lazy_static! {
    static ref WHITESPACE: Regex = Regex::new(r"\s+").unwrap();
    static ref KEY_WITH_MODIFIER: Regex = Regex::new(r"(?i)Ctrl|Alt|Cmd|Win|Meta").unwrap();
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
        if has_prefix && self.finalKey {
            return Err(err(
                "`finalKey` must be `false` when `master-key.prefix` is run",
            ))?;
        }

        return Ok(commands);
    }

    pub(crate) fn new(
        input: BindingInput,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Self> {
        let commands = regularize_commands(&input, scope)?;

        // id validation
        if let Some(_) = input.id {
            return Err(err("`id` field is reserved"))?;
        }

        // foreach validation
        if let Some(_) = input.foreach {
            // we do not expect this to ever happen, `expand_foreach`
            // should always be executed before `new`
            panic!("`foreach` included unresolved variables"); // LCOV_EXCL_LINE
        }

        // finalKey validation
        let has_prefix = commands.iter().any(|c| c.command == "master-key.prefix");
        let final_key_result: Option<bool> = resolve!(input, finalKey, scope)?;
        #[allow(non_snake_case)]
        let finalKey = final_key_result.unwrap_or(!has_prefix);
        if has_prefix && finalKey {
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
        let has_modifier = KEY_WITH_MODIFIER.is_match(&key[0]);
        when = if has_modifier {
            if let Some(w) = when {
                Some(
                    EDITOR_TEXT_FOCUS
                        .replace_all(&w, TEXT_FOCUS_CONDITION)
                        .to_string(),
                )
            } else {
                Option::None
            }
        } else {
            if let Some(w) = when {
                Some(format!("({}) && {TEXT_FOCUS_CONDITION}", w))
            } else {
                Some(TEXT_FOCUS_CONDITION.to_string())
            }
        };

        // warning about unknown fields
        for (key, _) in input.other_fields {
            let err: Result<()> = Err(wrn!(
                "The field `{}` is unrecognized and will be ignored",
                key,
            ));
            warnings.push(err.unwrap_err());
        }

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
            doc: match input.doc {
                Some(x) => BindingDoc::new(x, scope, warnings)?,
                Option::None => BindingDoc::default(),
            },
        };

        return Ok(result);
    }

    pub(crate) fn resolve_prefixes(
        mut binds: Vec<Binding>,
        spans: &Vec<Range<usize>>,
    ) -> ResultVec<Vec<Binding>> {
        let mut all_prefixes = HashSet::new();
        let empty_vec = vec![];
        for bind in &binds {
            let explicit_prefixes = match &bind.prefixes {
                Prefix::Any(false) => &empty_vec,
                Prefix::AnyOf(x) => x,
                _ => continue, // these types don't define new prefixes, they reference what already exists
            };
            if explicit_prefixes.len() > 0 {
                for p in explicit_prefixes {
                    let seq = WHITESPACE
                        .split(&p)
                        .chain(bind.key.iter().map(String::as_str));
                    for s in list_prefixes(seq) {
                        all_prefixes.insert(s.join(" "));
                    }
                }
            } else {
                let prefixes = list_prefixes(bind.key.iter().map(String::as_str));
                let offset = if bind
                    .commands
                    .iter()
                    .any(|c| c.command == "master-key.prefix")
                {
                    0
                } else {
                    1
                };
                for s in prefixes[0..(prefixes.len() - offset)].iter() {
                    all_prefixes.insert(s.join(" "));
                }
            };
        }

        let mut errors = Vec::new();
        for (bind, span) in binds.iter_mut().zip(spans.iter()) {
            bind.prefixes = match &bind.prefixes {
                Prefix::Any(true) => Prefix::AnyOf(all_prefixes.iter().map(String::from).collect()),
                Prefix::Any(false) => Prefix::AnyOf(vec!["".to_string()]),
                Prefix::AllBut(x) => {
                    let x_set: HashSet<_> = x.iter().map(String::from).collect();
                    let selected = all_prefixes.difference(&x_set);
                    let undefined = x_set.difference(&all_prefixes);
                    let undefined_str = undefined
                        .map(|x| format!("`{x}`"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    if undefined_str.len() > 0 {
                        let error: Result<()> =
                            Err(err!("Prefix(es) undefined: {undefined_str}")).with_range(span);

                        errors.push(error.unwrap_err());
                    }
                    Prefix::AnyOf(selected.map(|x| x.to_owned()).collect())
                }
                other @ _ => other.clone(),
            }
        }
        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(binds);
        }
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
    pub kind: Option<String>,
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
    pub(crate) fn new(
        input: BindingDocInput,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Self> {
        // kind validation
        let kind_span = input.kind.as_ref().map(|x| x.span());
        let kind: Option<String> = resolve!(input, kind, scope)?;
        if let Some(k) = &kind {
            if !scope.kinds.contains(k) {
                return Err(err!("Undefined kind `{}`", k)).with_range(&kind_span.unwrap())?;
            }
        };

        // warning about unknown fields
        for (key, _) in input.other_fields {
            let err: Result<()> = Err(wrn!(
                "The field `{}` is unrecognized and will be ignored",
                key,
            ));
            warnings.push(err.unwrap_err());
        }

        return Ok(BindingDoc {
            name: resolve!(input, name, scope)?,
            description: resolve!(input, description, scope)?,
            hideInPalette: resolve!(input, hideInPalette, scope)?,
            hideInDocs: resolve!(input, hideInDocs, scope)?,
            combined: match input.combined {
                Some(x) => Some(CombinedBindingDoc::new(x, scope, warnings)?),
                Option::None => None,
            },

            kind,
        });
    }
}

#[wasm_bindgen]
impl CombinedBindingDoc {
    pub(crate) fn new(
        input: CombinedBindingDocInput,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Self> {
        // warning about unknown fields
        for (key, _) in input.other_fields {
            let err: Result<()> = Err(wrn!(
                "The field `{}` is unrecognized and will be ignored",
                key,
            ));
            warnings.push(err.unwrap_err());
        }

        return Ok(CombinedBindingDoc {
            name: resolve!(input, name, scope)?,
            key: resolve!(input, key, scope)?,
            description: resolve!(input, description, scope)?,
        });
    }
}

//
// ================ `[[bind]]` output to keybinding.json ================
//

// The `Binding` objects are serialized separately (in `settings.json`) and loaded into
// memory when the extension loads. To associate each with a keybinding we serialize an
// associated `KeyBinding` object that makes a call to `master-key.do`; `do` then looks
// up the right `Binding` object based on the `id` field of `KeyBinding`

// object is a valid JSON object to store in `keybinding.json`; extra metadata is
// stored in the arguments of `master-key.do`
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "command")]
pub enum BindingOutput {
    #[serde(rename = "master-key.do")]
    Do {
        key: String,
        when: Option<String>,
        args: BindingOutputArgs,
    },
    #[serde(rename = "master-key.prefix")]
    Prefix {
        key: String,
        when: Option<String>,
        args: PrefixArgs,
    },
}

impl BindingOutput {
    pub fn cmp_priority(&self, other: &Self) -> std::cmp::Ordering {
        return match (self, other) {
            (
                Self::Do {
                    args: BindingOutputArgs { priority: a, .. },
                    ..
                },
                Self::Do {
                    args: BindingOutputArgs { priority: b, .. },
                    ..
                },
            ) => f64::total_cmp(a, b),
            (
                Self::Prefix {
                    args: PrefixArgs { priority: a, .. },
                    ..
                },
                Self::Prefix {
                    args: PrefixArgs { priority: b, .. },
                    ..
                },
            ) => f64::total_cmp(a, b),
            (Self::Prefix { .. }, Self::Do { .. }) => std::cmp::Ordering::Less,
            (Self::Do { .. }, Self::Prefix { .. }) => std::cmp::Ordering::Greater,
        };
    }
}

pub trait KeyId {
    fn key_id(&self) -> i32;
}

impl KeyId for BindingOutputArgs {
    fn key_id(&self) -> i32 {
        return self.key_id;
    }
}

impl KeyId for PrefixArgs {
    fn key_id(&self) -> i32 {
        return self.key_id;
    }
}

impl KeyId for BindingOutput {
    fn key_id(&self) -> i32 {
        match self {
            BindingOutput::Do { args, .. } => args.key_id(),
            BindingOutput::Prefix { args, .. } => args.key_id(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct BindingOutputArgs {
    // this uniquely identifies the key sequence used pressed for this binding
    // (used by nested calls to `master-key.prefix`)
    pub(crate) key_id: i32,
    // this uniquely identifiers the command that runs after pressing a binding
    // (which is retrieved by `maaster-key.do`)
    pub(crate) command_id: i32,
    // these fields help us track and order binding outputs, we don't need them serialized
    #[serde(skip)]
    pub(crate) priority: f64,
    // these fields are used in tracking and help improve legibility of the output bindings
    // in the keybindings.json file, and so they are stored
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) prefix: String,
    pub(crate) mode: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PrefixArgs {
    // this uniquely identifies the key sequence used pressed for this binding
    pub(crate) key_id: i32,
    // human readable field displaying the prefix (there are other arguments to
    // `master-key.prefix` but they are not used by automatically generated bindings, which
    // is what this type is for)
    pub(crate) prefix: String,
    // these fields help us track and order binding outputs, we don't need them serialized
    #[serde(skip)]
    pub(crate) priority: f64,
}

// BindingId uniquely identifies a the triggers the distinguish different bindings
// if these three fields are the same, there are conflicts in the keybinding file
#[derive(Clone, Debug, PartialEq, Hash)]
struct BindingId {
    key: Vec<String>,
    mode: String,
    when: String,
}
impl Eq for BindingId {}

// For each unique `BindingId`, we need to know a few things about it
struct BindingProperties {
    // the span where the binding was first defined; if we find a second
    // definition our error message can point to the first definition
    span: Range<usize>,
    // the code tells us how to create `when` clauses that are conditioned
    // on this keypress having already happened (as a prefix)
    code: i32,
    // whether this binding was defined implicitly as a prefix of an explicit binding, or if
    // it was defined explicitly within a keybinding file; all implicit bindings imply the
    // same exact command, so it's okay if they overlap.
    implicit: bool,
}

// tracks all unique bindings
pub(crate) struct BindingCodes {
    codes: HashMap<BindingId, BindingProperties>,
    // `count` is used to generate new, unique `id` fields
    count: i32,
}

impl BindingCodes {
    pub(crate) fn new() -> Self {
        return BindingCodes {
            codes: HashMap::new(),
            count: 0,
        };
    }
    pub(crate) fn key_code(
        &mut self,
        key: &Vec<impl ToString>,
        mode: &str,
        when: &Option<impl ToString>,
        span: &Range<usize>,
        implicit: bool,
    ) -> ResultVec<(i32, bool)> {
        let id = BindingId {
            key: key.iter().map(ToString::to_string).collect(),
            mode: mode.to_string(),
            when: match when {
                Some(x) => x.to_string(),
                Option::None => "".to_string(),
            },
        };
        if let Entry::Occupied(mut old @ OccupiedEntry { .. }) = self.codes.entry(id.clone()) {
            // it's okay to overwrite implicit bindings, but we don't want two explicitly
            // defined binding
            if !old.get().implicit && !implicit {
                let errors: Vec<Result<i32>> = vec![
                    Err(wrn!(
                        "Duplicate key sequence for mode `{mode}`. First instance is \
                             defined at "
                    ))
                    .with_range(&span)
                    .with_ref_range(&old.get().span),
                    Err(wrn!(
                        "Duplicate key sequence for mode `{mode}`. This sequence is \
                             also defined later in the file at "
                    ))
                    .with_range(&old.get().span)
                    .with_ref_range(&span),
                ];
                return Err(errors
                    .into_iter()
                    .map(Result::unwrap_err)
                    .collect::<Vec<_>>())?;
            } else if !implicit {
                // if the new binding is explicit, overwrite the old one
                old.insert(BindingProperties {
                    span: span.clone(),
                    code: old.get().code,
                    implicit,
                });
                return Ok((old.get().code, true));
            }
            return Ok((old.get().code, false));
        } else {
            // create a new entry
            self.count += 1;
            self.codes.insert(
                id,
                BindingProperties {
                    span: span.clone(),
                    code: self.count,
                    implicit,
                },
            );

            return Ok((self.count, true));
        }
    }
}

fn join_when_vec(when: &Vec<String>) -> Option<String> {
    if when.len() == 0 {
        return None;
    } else {
        return Some(format!("({})", when.join(") && (")));
    }
}

/// Creates all valid prefixes of a vector: e.g. `[a, b, c]`
/// yields `[[a], [a, b], [a, b, c]]`.
pub(crate) fn list_prefixes(seq: impl Iterator<Item = impl ToString>) -> Vec<Vec<String>> {
    let mut all_prefixes = Vec::new();
    let mut current_prefix = Vec::new();
    for key in seq {
        current_prefix.push(key);
        all_prefixes.push(current_prefix.iter().map(ToString::to_string).collect())
    }

    return all_prefixes;
}

impl Binding {
    /// Generates the `BindingOutput` items that will be stored in `keybindings.json`
    ///
    /// For each `Binding` item there are actually many implied `keybinding.json` entries.
    /// We have to define duplicates for each `mode`, and each `prefix` element.
    pub(crate) fn outputs(
        &self,
        command_id: i32,
        scope: &Scope,
        span: Range<usize>,
        codes: &mut BindingCodes,
    ) -> ResultVec<Vec<BindingOutput>> {
        let mut result = Vec::new();

        // create a distinct binding for each mode...
        for mode in &self.mode {
            let mut when_with_mode = match &self.when {
                Some(when) => vec![when.clone()],
                Option::None => vec![],
            };
            if mode != &scope.default_mode {
                when_with_mode.push(format!("master-key.mode == '{mode}'"));
            }
            let prefixes = match &self.prefixes {
                Prefix::AnyOf(x) => x,
                x @ _ => panic!("Unexpected, unresolved prefix: {x:?}"),
            };
            // ...and a distinct binding for each `self.prefix`
            for prefix in prefixes {
                self.outputs_for_mode_and_prefix(
                    command_id,
                    &span,
                    &mode,
                    &prefix,
                    &when_with_mode,
                    codes,
                    &mut result,
                )?;
            }
        }

        return Ok(result);
    }

    /// there are a few things going on with prefixes in this next function, which are worth
    /// delineating between
    ///
    /// explicit prefixes: those prefixes specified in `[[bind]]`; they list one or more
    /// sequences of keys that can occur before the defined keybinding.
    ///
    /// listed prefixes: this is the complete set of prefixes a given key sequence has,
    /// including the explicit prefix that gets prepended to the binding (e.g. "a b c" has
    /// two prefixes: "a" and "a b")
    ///
    /// Example:
    ///
    /// ```toml
    /// [[bind]]
    /// key = "a b"
    /// prefixes = ["x y", "k h"]
    /// ```
    ///
    /// there are two terminal bindings: one for the "x y" and one for the "k h" explicit
    /// prefix. This leads to two iterations of the `for explicit_prefix` loop below, where
    /// we generate BindingOutput::Prefix items as follows:
    ///
    /// - iteration 1 (prefix `"x y"`): `[["x"], ["x", "y"], ["x", "y", "a"]]`
    /// - iteration 2 (prefix `"k h"`): `[["k"], ["k", "h"], ["k", "h", "a"]]`
    ///
    /// We need to define a binding in `keybindings.json` per listed prefix because those each
    /// require a call to `master-key.prefix` to allow documentation to update between each
    /// key-press of a multi-press binding. This also allows for user specified keys to
    /// cancel a keybinding sequence (the same way escape cancels keybindings in vim). It is
    /// also how we could eventually implement vim-like behavior where one binding (e.g. `c`
    /// to change a line) could actually be a prefix of another (e.g. `c c` to comment a
    /// line).
    ///

    fn outputs_for_mode_and_prefix(
        &self,
        command_id: i32,
        span: &Range<usize>,
        mode: &str,
        explicit_prefix: &str,
        when_with_mode: &Vec<String>,
        codes: &mut BindingCodes,
        result: &mut Vec<BindingOutput>,
    ) -> ResultVec<()> {
        // split the current explicit prefix into individual keys and then prepend
        // it to the key sequence for this binding
        let prefix_seq = WHITESPACE
            .split(&explicit_prefix)
            .filter(|x| !x.is_empty())
            .chain(self.key.iter().map(String::as_str));
        // generate a keybindings.json entry for each listed prefix of this Binding
        let prefixes = list_prefixes(prefix_seq);
        let mut old_prefix_code = 0; // 0 is never returned by `key_code` method
        let mut old_prefix_str = "".to_string();
        for prefix in prefixes[0..(prefixes.len() - 1)].iter() {
            let mut when;
            // TODO: key_code should signal when there is already a higher
            // priority binding that's been added, and prevent
            // us from inserting a new binding here
            let (prefix_code, is_new_code) =
                codes.key_code(&prefix, &mode, &self.when, span, true)?;
            when = when_with_mode.clone();
            when.push(format!("master-key.prefixCode == {old_prefix_code}"));
            if is_new_code {
                result.push(BindingOutput::Prefix {
                    key: prefix.last().unwrap().clone(),
                    when: join_when_vec(&when),
                    args: PrefixArgs {
                        priority: 0.0,
                        key_id: prefix_code,
                        prefix: old_prefix_str,
                    },
                });
            }
            old_prefix_code = prefix_code;
            old_prefix_str = prefix.clone().join(" ");
        }

        // generate keybindings.json entry for this Binding's actual
        // command
        let mut when = when_with_mode.clone();
        when.push(format!("master-key.prefixCode == {old_prefix_code}"));

        // we can unwrap here because non-implicit bindings always
        // throw an error if they already exist
        let (code, _) =
            codes.key_code(&prefixes.last().unwrap(), &mode, &self.when, span, false)?;

        result.push(BindingOutput::Do {
            key: self.key.last().unwrap().clone(),
            when: join_when_vec(&when),
            args: BindingOutputArgs {
                command_id,
                key_id: code,
                mode: mode.to_string(),
                priority: self.priority,
                prefix: old_prefix_str,
                name: self.doc.name.clone(),
                description: self.doc.description.clone(),
            },
        });
        return Ok(());
    }
}

// ================ Tests ================
//

#[allow(non_snake_case)]
#[cfg(test)]
mod tests {
    use test_log::test;

    use rhai::Dynamic;
    use std::collections::HashMap;

    use crate::file::tests::unwrap_table;

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
        prefixes.anyOf = "c"
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
            unwrap_table(&args),
            HashMap::from([
                ("a".into(), Value::String("2".into())),
                ("b".into(), Value::Integer(3))
            ])
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
        let prefixes: Prefix = resolve!(result, prefixes, &mut scope).unwrap();
        let prefix_strs = match prefixes {
            Prefix::AnyOf(x) => x,
            _ => panic!("unexpected"),
        };
        assert_eq!(prefix_strs, ["c"]);

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

        let mut _warnings = Vec::new();
        let combined: CombinedBindingDoc =
            CombinedBindingDoc::new(doc.combined.unwrap(), &mut scope, &mut _warnings).unwrap();
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
            unwrap_table(&result.args.unwrap().into_inner()),
            HashMap::from([("to".into(), Value::String("left".into()))])
        );

        let when: Option<String> = resolve!(result, when, &mut scope).unwrap();
        assert_eq!(when, None);
    }

    #[test]
    fn reserved_id_field() {
        let data = r#"
        id = "biz"
        key = "a"
        command = "foo"
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = Binding::new(input, &mut scope, &mut warnings).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("`id` field"));
    }

    #[test]
    fn simple_command_merging() {
        let data = r#"
        [[bind]]
        doc.name = "default"
        command = "cursorMove"
        prefixes.anyOf = ["a"]

        [[bind]]
        key = "l"
        doc.name = "←"
        args.to = "left"
        prefixes.anyOf = ["b", "c"]
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
            unwrap_table(&left.args.unwrap().into_inner()),
            HashMap::from([("to".into(), Value::String("left".into()))])
        );

        let prefixes: Prefix = resolve!(left, prefixes, &mut scope).unwrap();
        let prefix_strs = match prefixes {
            Prefix::AnyOf(x) => x,
            _ => panic!("unexpected"),
        };
        assert_eq!(prefix_strs, ["b".to_string(), "c".to_string()]);

        let doc = left.doc.unwrap();
        assert!(doc.combined.is_none());
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

        assert_eq!(
            left.args.unwrap().into_inner(),
            expected.args.unwrap().into_inner()
        );
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
        let mut warnings = Vec::new();
        let result = Binding::new(input, &mut scope, &mut warnings).unwrap();

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
        let mut warnings = Vec::new();
        let err = Binding::new(input, &mut scope, &mut warnings).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("Undefined mode"));
        assert_eq!(report[0].range.start.line, 3);
    }

    #[test]
    fn final_key_validation() {
        let data = r#"
        key = "a"
        command = "runCommands"
        finalKey = true
        args.commands = ["a", "master-key.prefix"]
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = Binding::new(input, &mut scope, &mut warnings).unwrap_err();
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
        let mut warnings = Vec::new();
        let result = Binding::new(input, &mut scope, &mut warnings).unwrap();
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
        let mut warnings = Vec::new();
        let result = Binding::new(input, &mut scope, &mut warnings).unwrap();
        assert!(result.when.unwrap().contains("keybindingPaletteOpen"));
    }

    #[test]
    fn default_is_wrong_type() {
        let data = r#"
        key = "a"
        command = "foo"
        default = "{{1+2}}"
        "#;

        let err = toml::from_str::<BindingInput>(data).unwrap_err();
        assert!(err.to_string().contains("default must"));
    }

    // TODO: are there any edge cases / failure modes I want to look at in the tests
    // (most of the things seem likely to be covered by serde / toml parsing, and the
    // stuff I would want to check should be done at a higher level when I'm working
    // through default resolution across multiple commands rather than the within
    // command tests I'm working on here)
}

// TODO: define the "output" type for `Binding` that can actually be passed to javascript
