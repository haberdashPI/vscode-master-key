#![allow(non_snake_case)]

#[allow(unused_imports)]
use log::info;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::convert::identity;
use toml::Spanned;
use wasm_bindgen::prelude::*;

pub mod command;
mod foreach;
pub mod validation;

use crate::bind::command::{Command, regularize_commands};
use crate::bind::validation::{BindingReference, KeyBinding};
use crate::error::{Result, ResultVec, reserved, unexpected};
use crate::expression::Scope;
use crate::expression::value::{Expanding, TypedValue, Value};
use crate::util::{Merging, Plural, Required, Resolving};

pub const UNKNOWN_RANGE: core::ops::Range<usize> = usize::MIN..usize::MAX;

fn default_mode() -> Spanned<Plural<TypedValue<String>>> {
    return Spanned::new(
        UNKNOWN_RANGE,
        Plural::One(TypedValue::Constant("default".into())),
    );
}

fn span_required_default<T>() -> Spanned<Required<T>> {
    return Spanned::new(UNKNOWN_RANGE, Required::DefaultValue);
}

fn span_plural_default<T>() -> Spanned<Plural<T>> {
    return Spanned::new(UNKNOWN_RANGE, Plural::Zero);
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
#[derive(Deserialize, Clone, Debug)]
pub struct BindingInput {
    // implementation detail of `BindingInput`: this field should only be `Some` when used
    // as a part of an entry to `Define`. It is removed downstream using `without_id`.
    pub(crate) id: Option<Spanned<String>>,

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
    #[serde(default)]
    pub args: Option<Spanned<Value>>,

    /// @forBindingField bind
    ///
    /// - ❗`key`: the
    ///   [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that
    ///   triggers `command`.
    #[serde(default = "span_required_default")]
    pub key: Spanned<Required<KeyBinding>>,

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
    ///   [`all_modes_but`](/expressions/functions#all_modes_but)
    #[serde(default = "default_mode")]
    pub mode: Spanned<Plural<TypedValue<String>>>,
    /// @forBindingField bind
    ///
    /// - `priority`: The ordering of the keybinding relative to others; determines which
    ///   bindings take precedence. Defaults to 0.
    #[serde(default)]
    pub priority: Option<Spanned<TypedValue<f64>>>,
    /// @forBindingField bind
    ///
    /// - `default`: the default values to use for fields, specified as
    ///    string of the form `{{bind.[name]}}`.
    ///    See [`define`](/bindings/define) for more details.
    #[serde(default)]
    pub default: Option<Spanned<BindingReference>>,
    /// @forBindingField bind
    ///
    /// - `foreach`: Allows parametric definition of multiple keybindings, see
    ///   [`foreach` clauses](#foreach-clauses).
    #[serde(default)]
    pub foreach: Option<BTreeMap<String, Vec<Spanned<Value>>>>,

    /// @forBindingField bind
    ///
    /// - `prefixes`: array of strings or an expression of producing such an array.
    ///   (see also [`all_prefixes`](expressions/functions#all_prefixes).
    ///   The prefixes determine one or more *unresolved* key
    ///   sequences that can have occurred before typing this key. See
    ///   [`master-key.prefix`](/commands/prefix) for details. Defaults to `""` (a.k.a.
    ///   no prefix is allowed). Setting this to <code v-pre>{{all_prefixes}}</code>,
    ///   will allow a key binding to work regardless of any unresolved key
    ///   sequence that has been pressed: this is how `esc` is defined to work
    ///   in Larkin.
    #[serde(default = "span_plural_default")]
    pub prefixes: Spanned<Plural<TypedValue<String>>>,

    /// @forBindingField bind
    ///
    /// - `finalKey`: (boolean, default=true) Whether this key should clear any transient
    ///   state associated with the pending keybinding prefix. See
    ///   [`master-key.prefix`](/commands/prefix) for details.
    #[serde(default)]
    pub finalKey: Option<Spanned<TypedValue<bool>>>,

    /// @forBindingField bind
    ///
    /// - ⚡ `repeat`: The number of times to repeat the command; this can be a runtime
    ///   [expression](/expressions/index). This defaults to zero: one repeat means the
    ///   command is run twice.
    repeat: Option<Spanned<TypedValue<i32>>>,

    /// @forBindingField bind
    ///
    /// - `doc`: Documentation for this keybinding, none of the fields of this object
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
/// - All variables available to an [expression](/expressions/index), prefixed with
///   `master-key.`
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
            self.doc.is_constant(),
        ]
        .into_iter()
        .all(identity)
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
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
                Spanned::new(UNKNOWN_RANGE, Plural::Zero)
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
                Spanned::new(UNKNOWN_RANGE, Plural::Zero)
            }),
            finalKey: self.finalKey.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            repeat: self.repeat.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
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
    /// - `combinedName/combinedKey/combinedDescription`: in the suggestion palette and
    ///   textual documentation, keys that have the same `combinedName` will be
    ///   represented as single entry, using the `combinedKey` and `combinedDescription`
    ///   instead of `key` and `description`. The `combinedKey` for a multi-key sequence
    ///   should only include the suffix key. You need only define `combinedKey` and
    ///   `combinedDescription` once across keys that share the same `combinedName`
    ///   entry.
    #[serde(default)]
    pub combinedName: Option<Spanned<TypedValue<String>>>,
    #[serde(default)]
    pub combinedKey: Option<Spanned<TypedValue<String>>>,
    #[serde(default)]
    pub combinedDescription: Option<Spanned<TypedValue<String>>>,

    /// @forBindingField bind
    /// @order 10
    ///
    /// - `kind`: The broad cagegory of commands this binding falls under. There should
    ///   be no more than 4-5 of these. Each `kind` here should have a corresponding
    ///   entry in the top-level `kind` array.
    #[serde(default)]
    pub kind: Option<Spanned<TypedValue<String>>>,
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
            combinedName: self.combinedName.coalesce(y.combinedName),
            combinedKey: self.combinedKey.coalesce(y.combinedKey),
            combinedDescription: self.combinedDescription.coalesce(y.combinedDescription),
            kind: self.kind.coalesce(y.kind),
        }
    }
}

impl Expanding for BindingDocInput {
    fn is_constant(&self) -> bool {
        [
            self.name.is_constant(),
            self.description.is_constant(),
            self.hideInPalette.is_constant(),
            self.hideInDocs.is_constant(),
            self.combinedName.is_constant(),
            self.combinedKey.is_constant(),
            self.combinedDescription.is_constant(),
            self.kind.is_constant(),
        ]
        .into_iter()
        .all(identity)
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        Self: Sized,
        F: FnMut(String) -> Result<Value>,
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
            combinedName: self
                .combinedName
                .map_expressions(f)
                .unwrap_or_else(|mut e| {
                    errors.append(&mut e.errors);
                    None
                }),
            combinedKey: self.combinedKey.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                None
            }),
            combinedDescription: self.combinedDescription.map_expressions(f).unwrap_or_else(
                |mut e| {
                    errors.append(&mut e.errors);
                    None
                },
            ),
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

//
// ================ `[[bind]]` object ================
//

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct Binding {
    pub key: String,
    pub commands: Vec<Command>,
    pub when: Option<String>,
    pub mode: Vec<String>,
    pub priority: f64,
    pub prefixes: Vec<String>,
    pub finalKey: bool,
    pub(crate) repeat: Option<TypedValue<i32>>,
    pub doc: Option<BindingDoc>,
}

#[wasm_bindgen]
impl Binding {
    pub fn repeat(&mut self, scope: &mut Scope) -> ResultVec<i32> {
        return match scope.expand(&self.repeat)? {
            None => Ok(0),
            Some(val) => Ok(val.into()),
        };
    }

    pub(crate) fn new(input: BindingInput) -> ResultVec<Self> {
        if let Some(_) = input.id {
            return reserved("id")?;
        }

        if let Some(_) = input.foreach {
            return unexpected("`foreach` with unresolved variables")?;
        }
        let commands = regularize_commands(&input)?;

        // TODO this is where we should validate that prefix has `finalKey == false`

        return Ok(Binding {
            commands: commands,
            key: input.key.resolve("`key` field")?,
            when: input.when.resolve("`when` field")?,
            mode: input.mode.resolve("`mode` field")?,
            priority: input.priority.resolve("`priority` field")?.unwrap_or(0.0),
            prefixes: input.prefixes.resolve("`prefixes` fields")?,
            finalKey: input.finalKey.resolve("`finalKey` field")?.unwrap_or(true),
            repeat: input.repeat.resolve("`repeat` field")?,
            doc: match input.doc {
                Some(doc) => Some(BindingDoc::new(doc)?),
                None => None,
            },
        });
    }
}

//
// ---------------- `bind.doc` object ----------------
//

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct BindingDoc {
    pub name: Option<String>,
    pub description: Option<String>,
    pub hideInPalette: bool,
    pub hideInDocs: bool,
    pub combinedName: Option<String>,
    pub combinedKey: Option<String>,
    pub combinedDescription: Option<String>,
    pub kind: Option<String>,
}

#[wasm_bindgen]
impl BindingDoc {
    pub(crate) fn new(input: BindingDocInput) -> ResultVec<Self> {
        return Ok(BindingDoc {
            name: input.name.resolve("`name` field")?,
            description: input.description.resolve("`description` field")?,
            hideInPalette: input
                .hideInPalette
                .resolve("`hideInPalette`")?
                .unwrap_or(false),
            hideInDocs: input
                .hideInDocs
                .resolve("`hideInPalette`")?
                .unwrap_or(false),
            combinedName: input.combinedName.resolve("`combinedName` field")?,
            combinedKey: input.combinedKey.resolve("`combinedKey` field")?,
            combinedDescription: input
                .combinedDescription
                .resolve("`combinedDescription` field")?,
            kind: input.kind.resolve("`kind` field")?,
        });
    }
}

//
// ================ Tests ================
//

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
        name = "foo"
        description = "foo bar bin"
        hideInPalette = false
        hideInDocs = false
        combinedName = "Up/down"
        combinedKey = "A/B"
        combinedDescription = "bla bla bla"
        kind = "biz"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();

        assert_eq!(
            String::from(result.command.into_inner().unwrap()),
            "do".to_string()
        );

        let args = result.args.unwrap().into_inner();
        assert_eq!(
            args,
            Value::Table(BTreeMap::from([
                ("a".into(), Value::String("2".into())),
                ("b".into(), Value::Integer(3))
            ]))
        );
        let key: String = result.key.into_inner().unwrap().into();
        assert_eq!(key, "a".to_string());
        let when: String = result.when.unwrap().into_inner().into();
        assert_eq!(when, "joe > 1".to_string());
        let mode: Vec<String> = result
            .mode
            .into_inner()
            .map(|m| m.clone().into())
            .to_array();

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
        let prefixes: Vec<String> = result
            .prefixes
            .into_inner()
            .map(|m| m.clone().into())
            .to_array();
        assert_eq!(prefixes, ["c"]);

        let finalKey: bool = result.finalKey.unwrap().into_inner().into();
        assert_eq!(finalKey, true);

        let name: String = result.name.unwrap().into_inner().into();
        assert_eq!(name, "foo");

        let description: String = result.description.unwrap().into_inner().into();
        assert_eq!(description, "foo bar bin");

        let hideInDocs: bool = result.hideInDocs.unwrap().into_inner().into();
        assert_eq!(hideInDocs, false);

        let hideInPalette: bool = result.hideInPalette.unwrap().into_inner().into();
        assert_eq!(hideInPalette, false);

        let combinedName: String = result.combinedName.unwrap().into_inner().into();
        assert_eq!(combinedName, "Up/down");

        let combinedKey: String = result.combinedKey.unwrap().into_inner().into();
        assert_eq!(combinedKey, "A/B");

        let combinedDescription: String = result.combinedDescription.unwrap().into_inner().into();
        assert_eq!(combinedDescription, "bla bla bla");

        let kind: String = result.kind.unwrap().into_inner().into();
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
            Value::Table(BTreeMap::from([(
                "to".into(),
                Value::String("left".into())
            )]))
        );

        assert_eq!(
            String::from(result.mode.into_inner().to_array().first().unwrap().clone()),
            "default".to_string()
        );
        assert_eq!(result.combinedDescription, None);
        assert_eq!(result.combinedName, None);
    }

    #[test]
    fn simple_command_merging() {
        let data = r#"
        [[bind]]
        name = "default"
        command = "cursorMove"
        prefixes = ["a"]

        [[bind]]
        key = "l"
        name = "←"
        args.to = "left"
        prefixes = ["b", "c"]
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let left = default.merge(left);

        let key: String = left.key.into_inner().unwrap().into();
        assert_eq!(key, "l".to_string());
        assert_eq!(
            String::from(left.command.into_inner().unwrap()),
            "cursorMove"
        );

        assert_eq!(
            left.args.unwrap().into_inner(),
            Value::Table(BTreeMap::from([(
                "to".into(),
                Value::String("left".into())
            )]))
        );

        let prefixes: Vec<String> = left
            .prefixes
            .into_inner()
            .map(|m| m.clone().into())
            .to_array();
        assert_eq!(prefixes, ["b".to_string(), "c".to_string()]);

        assert_eq!(left.combinedDescription, None);
        assert_eq!(left.combinedName, None);
    }

    #[test]
    fn merge_nested_arguments() {
        let data = r#"
            [[bind]]
            name = "default"
            command = "cursorMove"
            args.foo = { a = 2, b = 3, c = { x = 1 } }

            [[bind]]
            key = "r"
            name = "→"
            args.foo = { d = 12, c = { y = 2 } }

            [[bind]]
            key = "x"
            name = "expected"
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
            name = "test {{a}}-{{b}}"
            command = "run-{{a}}"
            args.value = "with-{{b}}"
        "#;

        let mut result = toml::from_str::<BindingInput>(data).unwrap();
        let items = result.expand_foreach().unwrap();

        let expected_command = vec!["run-1", "run-1", "run-2", "run-2"];
        let expected_value = vec!["with-x", "with-y", "with-x", "with-y"];
        let expected_name = vec!["test 1-x", "test 1-y", "test 2-x", "test 2-y"];

        for i in 0..4 {
            let item = items[i].clone();
            assert_eq!(
                String::from(item.command.into_inner().unwrap()),
                expected_command[i]
            );

            assert_eq!(
                String::from(item.name.unwrap().into_inner()),
                expected_name[i]
            );
            assert_eq!(
                item.args.unwrap().into_inner(),
                Value::Table(BTreeMap::from([(
                    "value".to_string(),
                    Value::String(expected_value[i].into())
                )]))
            );
        }
    }

    #[test]
    fn expand_foreach_keys() {
        // TODO: error out if the regex inside of `{{}}` is not valid (right now it just
        // fails silently)
        let data = r#"
            foreach.key = ["{{keys(`[0-9]`)}}"]
            name = "update {{key}}"
            command = "foo"
            args.value = "{{key}}"
        "#;

        let mut result = toml::from_str::<BindingInput>(data).unwrap();
        let items = result.expand_foreach().unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(items.len(), 10);
        for i in 0..9 {
            let name: String = items[i].name.as_ref().unwrap().get_ref().clone().into();
            assert_eq!(name, expected_name[i]);
            let value = items[i].args.as_ref().unwrap().get_ref().clone();
            assert_eq!(
                value,
                Value::Table(BTreeMap::from([(
                    "value".to_string(),
                    Value::String(expected_value[i].clone())
                )]))
            );
        }
    }

    #[test]
    fn expand_args() {
        let data = r#"
            key = "k"
            name = "test"
            command = "foo"
            args.value = '{{joe + "_biz"}}'
            args.number = '{{2+1}}'
        "#;

        let input = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        scope.parse_asts(&input);
        let result = Binding::new(input).unwrap();
        scope.state.set_or_push("joe", Dynamic::from("fiz"));
        let flat_args = result.commands[0].toml_args(&mut scope).unwrap();

        let mut args_expected = toml::map::Map::new();
        args_expected.insert(
            "value".to_string(),
            toml::Value::String("fiz_biz".to_string()),
        );
        args_expected.insert("number".to_string(), toml::Value::Integer(3));
        assert_eq!(flat_args, toml::Value::Table(args_expected));
    }

    // TODO: are there any edge cases / failure modes I want to look at in the tests
    // (most of the things seem likely to be covered by serde / toml parsing, and the
    // stuff I would want to check should be done at a higher level when I'm working
    // through default resolution across multiple commands rather than the within
    // command tests I'm working on here)
}

// TODO: define the "output" type for `Binding` that can actually be passed to javascript
