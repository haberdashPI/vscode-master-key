#![allow(non_snake_case)]

#[allow(unused_imports)]
use log::info;

use std::collections::HashMap;
use std::collections::VecDeque;
use std::convert::identity;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::Spanned;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

mod foreach;
pub mod validation;

use crate::bind::foreach::expand_keys;
use crate::bind::validation::{BindingReference, KeyBinding};
use crate::error::{Error, ErrorContext, Result, ResultVec, constrain, reserved, unexpected};
use crate::util::{Merging, Plural, Required, Resolving};
use crate::value::{Expanding, TypedValue, Value};

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

/**
 * @bindingField bind
 * @description an actual keybinding; extends the schema used by VSCode's `keybindings.json`
 *
 * **Example**
 *
 * ```toml
 * [[bind]]
 * name = "left"
 * key = "h"
 * mode = "normal"
 * command = "cursorLeft"
 * ```
 * The `bind` element has two categories of fields: functional and documenting.
 *
 * ## Functional Fields
 *
 * The functional fields determine what the keybinding does. Required fields are marked with
 * a `*`.
 *
 */
#[derive(Deserialize, Clone, Debug)]
pub struct BindingInput {
    // should only be `Some` in context of `Define(Input)`
    pub(crate) id: Option<Spanned<String>>,
    /**
     * @forBindingField bind
     *
     * - `command`*: A string denoting the command to execute. This is a command
     *   defined by VSCode or an extension thereof.
     *   See [finding commands](#finding-commands). This field has special
     *   behavior when set to`runCommands`
     *   (see [running multiple commands](#running-multiple-commands)).
     */
    #[serde(default = "span_required_default")]
    pub command: Spanned<Required<TypedValue<String>>>,

    /**
     * @forBindingField bind
     *
     * - `args`: The arguments to directly pass to the `command`, these are static
     *   values.
     */
    #[serde(default)]
    pub args: Option<Spanned<Value>>,

    /**
     * @forBindingField bind
     *
     * - `key`*: the
     *   [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that
     *   triggers `command`.
     */
    #[serde(default = "span_required_default")]
    pub key: Spanned<Required<KeyBinding>>,
    /**
     * @forBindingField bind
     *
     * - `when`: A [when
     *   clause](https://code.visualstudio.com/api/references/when-clause-contexts)
     *   context under which the binding will be active. Also see Master Key's
     *   [available contexts](#available-contexts)
     */
    pub when: Option<Spanned<TypedValue<String>>>,
    /**
     * @forBindingField bind
     *
     * - `mode`: The mode during which the binding will be active. The default mode is
     *   used when this field is not specified (either directly or via the `defaults`
     *   field). You can also specify multiple modes as an array of strings. To specify
     *   a binding that is applied in all modes use "{{all_modes()}}".
     */
    #[serde(default = "default_mode")]
    pub mode: Spanned<Plural<TypedValue<String>>>,
    /**
     * @forBindingField bind
     *
     * - `priority`: The ordering of the keybinding relative to others; determines which
     *   bindings take precedence. Defaults to 0.
     */
    #[serde(default)]
    pub priority: Option<Spanned<TypedValue<f64>>>,
    /**
     * @forBindingField bind
     *
     * - `default`: the default values to use for fields, specified as
     *    string of the form `{{bind.[name]}}`.
     *    See [`define`](/bindings/define) for more details.
     */
    #[serde(default)]
    pub default: Option<Spanned<BindingReference>>,
    /**
     * @forBindingField bind
     *
     * - `foreach`: Allows parametric definition of multiple keybindings, see
     *   [`foreach` clauses](#foreach-clauses).
     */
    #[serde(default)]
    pub foreach: Option<IndexMap<String, Vec<Spanned<Value>>>>,

    /**
     * @forBindingField bind
     *
     * - `prefixes`: (array of strings or the string
     *   <code v-pre>{{all_prefixes}}</code>). Determines one or more *unresolved* key
     *   sequences that can have occurred before typing this key. See
     *   [`master-key.prefix`](/commands/prefix) for details. Defaults to `""` (a.k.a.
     *   no prefix is allowed). This can be set to <code v-pre>{{all_prefixes}}</code>,
     *   if you wish to allow the key binding to work regardless of any unresolved key
     *   sequence that has been pressed (e.g. this is used for the "escape" key binding
     *   in Larkin).
     */
    #[serde(default = "span_plural_default")]
    pub prefixes: Spanned<Plural<TypedValue<String>>>,

    /**
     * @forBindingField bind
     *
     * - `finalKey`: (boolean, default=true) Whether this key should clear any transient
     *   state associated with the pending keybinding prefix. See
     *   [`master-key.prefix`](/commands/prefix) for details.
     */
    #[serde(default)]
    pub finalKey: Option<Spanned<TypedValue<bool>>>,

    /**
     * @forBindingField bind
     *
     *  **TODO**: update docs, and make it possible to be a number or a string
     *
     * - `repeat`: This is an [expression](/expressions/index). It is expected
     *   to evaluate to the number of times to repeat the command. Defaults to zero: one
     *   repeat means the command is run twice.
     * - `command` will be repeated the given
     *   number of times.
     */
    repeat: Option<Spanned<TypedValue<i32>>>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * ## Documenting Fields
     *
     * The documenting fields determine how the keybinding is documented. They are all
     * optional.
     *
     * - `name`: A very description for the command; this must fit in the visual
     *   documentation so it shouldn't be much longer than five characters for most
     *   keys. Favor unicode symbols such as → and ← over text.
     */
    #[serde(default)]
    pub name: Option<Spanned<TypedValue<String>>>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `description`: A longer description of what the command does. Shouldn't be much
     *   longer than a single sentence for most keys. Save more detailed descriptions
     *   for the literate comments.
     */
    #[serde(default)]
    pub description: Option<Spanned<TypedValue<String>>>,
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `hideInPalette/hideInDocs`: whether to show the keys in the popup suggestions
     *   and the documentation. These both default to false.
     */
    #[serde(default)]
    pub hideInPalette: Option<Spanned<TypedValue<bool>>>,
    #[serde(default)]
    pub hideInDocs: Option<Spanned<TypedValue<bool>>>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `combinedName/combinedKey/combinedDescription`: in the suggestion palette and
     *   textual documentation, keys that have the same `combinedName` will be
     *   represented as single entry, using the `combinedKey` and `combinedDescription`
     *   instead of `key` and `description`. The `combinedKey` for a multi-key sequence
     *   should only include the suffix key. All but the first key's `combinedKey` and
     *   `combinedDescription` are ignored.
     */
    #[serde(default)]
    pub combinedName: Option<Spanned<TypedValue<String>>>,
    #[serde(default)]
    pub combinedKey: Option<Spanned<TypedValue<String>>>,
    #[serde(default)]
    pub combinedDescription: Option<Spanned<TypedValue<String>>>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `kind`: The broad cagegory of commands this binding falls under. There should
     *   be no more than 4-5 of these. Each `kind` here should have a corresponding
     *   entry in the top-level `kind` array.
     */
    #[serde(default)]
    pub kind: Option<Spanned<TypedValue<String>>>,
}

impl BindingInput {
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
            name: self.name.clone(),
            description: self.description.clone(),
            hideInPalette: self.hideInPalette.clone(),
            hideInDocs: self.hideInDocs.clone(),
            combinedName: self.combinedName.clone(),
            combinedKey: self.combinedKey.clone(),
            combinedDescription: self.combinedDescription.clone(),
            kind: self.kind.clone(),
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
            kind: self.kind.coalesce(y.kind),
            when: self.when.coalesce(y.when),
            mode: self.mode.coalesce(y.mode),
            priority: self.priority.coalesce(y.priority),
            default: self.default.coalesce(y.default),
            foreach: self.foreach,
            prefixes: self.prefixes.coalesce(y.prefixes),
            finalKey: self.finalKey.coalesce(y.finalKey),
            repeat: self.repeat.coalesce(y.repeat),
            name: self.name.coalesce(y.name),
            description: self.description.coalesce(y.description),
            hideInPalette: self.hideInPalette.coalesce(y.hideInPalette),
            hideInDocs: self.hideInDocs.coalesce(y.hideInDocs),
            combinedName: self.combinedName.coalesce(y.combinedName),
            combinedKey: self.combinedKey.coalesce(y.combinedKey),
            combinedDescription: self.combinedDescription.coalesce(y.combinedDescription),
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct CommandInput {
    // should only be `Some` in context of `Define(Input)`
    pub(crate) id: Option<Spanned<TypedValue<String>>>,
    pub command: Spanned<Required<TypedValue<String>>>,
    pub args: Option<Spanned<Value>>,
}

impl Expanding for CommandInput {
    fn is_constant(&self) -> bool {
        if self.command.is_constant() {
            return false;
        }
        if self.args.is_constant() {
            return false;
        }
        return true;
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        let mut errors = Vec::new();
        let result = CommandInput {
            id: self.id,
            command: self.command.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                Spanned::new(UNKNOWN_RANGE, Required::DefaultValue)
            }),
            args: self.args.map_expressions(f).unwrap_or_else(|mut e| {
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

impl CommandInput {
    pub(crate) fn without_id(&self) -> Self {
        return CommandInput {
            id: None,
            command: self.command.clone(),
            args: self.args.clone(),
        };
    }
}

impl From<CommandInput> for Value {
    fn from(value: CommandInput) -> Self {
        let mut entries = IndexMap::new();
        let command = value.command.into_inner();
        if let Required::Value(command_value) = command {
            entries.insert("command".to_string(), command_value.into());
        }
        if let Some(arg_value) = value.args {
            entries.insert("args".to_string(), arg_value.into_inner());
        }
        return Value::Table(entries);
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Debug, Serialize)]
pub struct Command {
    pub command: String,
    pub(crate) args: Value,
}

// TODO: here is where we would want to invoke rhai to resolve any outstanding expressions

#[wasm_bindgen]
pub struct Scope {
    asts: HashMap<String, rhai::AST>,
    engine: rhai::Engine,
    state: rhai::Scope<'static>,
    queues: HashMap<String, VecDeque<Command>>,
}

// TODO: we'll need to define `CustomType` on `Value` and `Command`
#[wasm_bindgen]
impl Scope {
    // TODO: incorporate command queues
    fn expand<T>(&mut self, obj: &T) -> ResultVec<T>
    where
        T: Expanding + Clone,
    {
        for (k, v) in self.queues.iter() {
            // TODO: tell engine how to handle dequeues
            // TODO: I don't love that we have to copy the queue for every evaluation
            // there's probalby a better solution here
            self.state.set_or_push(k, v.clone());
        }
        return Ok(obj.clone().map_expressions(&mut |expr| {
            let ast = &self.asts[&expr];
            let result = self.engine.eval_ast_with_scope(&mut self.state, &ast);
            let value: rhai::Dynamic = match result {
                Err(x) => Err(Error::ExpressionEval(format!("{}", x)))?,
                Ok(x) => x,
            };
            let result_value: Value = match value.clone().try_cast_result() {
                Err(e) => Err(Error::Rhai(format!("{}", e)))?,
                Ok(x) => x,
            };
            return Ok(result_value);
        })?);
    }

    fn parse_asts(&mut self, x: impl Expanding + Clone) -> ResultVec<()> {
        x.clone().map_expressions(&mut |expr| {
            let ast = self.engine.compile_expression(expr.clone())?;
            self.asts.insert(expr.clone(), ast);
            return Ok(Value::Expression(expr));
        })?;
        return Ok(());
    }

    #[wasm_bindgen(constructor)]
    pub fn new() -> Scope {
        let engine = rhai::Engine::new();

        return Scope {
            asts: HashMap::new(),
            engine: engine,
            state: rhai::Scope::new(),
            queues: HashMap::new(),
        };
    }

    pub fn set(&mut self, name: String, value: JsValue) -> Result<()> {
        let toml: toml::Value = match serde_wasm_bindgen::from_value(value) {
            Err(e) => Err(Error::JsSerialization(format!("{}", e)))?,
            Ok(x) => x,
        };
        let val: Value = toml.try_into()?;
        self.state.set_or_push(&name, val);
        return Ok(());
    }

    pub fn unset(&mut self, name: String) -> Result<()> {
        return Ok(self
            .state
            .remove(&name)
            .ok_or_else(|| Error::UndefinedVariable(name))?);
    }

    pub fn get(&self, name: String) -> Result<JsValue> {
        let x: &rhai::Dynamic = self
            .state
            .get(&name)
            .ok_or_else(|| Error::UndefinedVariable(name))?;
        let x: Value = match x.clone().try_cast_result() {
            Err(e) => Err(Error::Rhai(format!("{}", e)))?,
            Ok(x) => x,
        };
        let x: toml::Value = x.into();
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        return match x.serialize(&to_json) {
            Err(e) => Err(Error::JsSerialization(format!("{}", e)))?,
            Ok(x) => Ok(x),
        };
    }

    pub fn add_to_command_queue(&mut self, queue: String, x: Command) {
        let queue = self.queues.entry(queue).or_insert_with(|| VecDeque::new());
        queue.push_back(x);
        // TODO: pop queue if it gets too large
    }

    pub fn pop_command_queue(&mut self, queue: String) -> Option<Command> {
        let queue = self.queues.entry(queue).or_insert_with(|| VecDeque::new());
        return queue.pop_front();
    }

    // TODO: function to evaluate args of replay and return a range of expressions
    // to replay in type script
}

#[wasm_bindgen]
impl Command {
    #[wasm_bindgen(getter)]
    pub fn args(&self, scope: &mut Scope) -> ResultVec<JsValue> {
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        let flat_args = scope.expand(&self.args)?;

        return match toml::Value::from(flat_args).serialize(&to_json) {
            Err(e) => Err(Error::JsSerialization(format!("{}", e)))?,
            Ok(x) => Ok(x),
        };
    }
}

impl Command {
    pub fn new(input: CommandInput) -> ResultVec<Self> {
        if let Some(_) = input.id {
            return reserved("id")?;
        }
        return Ok(Command {
            command: input.command.resolve("`command` field")?,
            args: match input.args {
                Some(x) => x.into_inner(),
                None => Value::Table(IndexMap::new()),
            },
        });
    }
}

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
impl Binding {
    pub fn repeat_count(&self) -> std::result::Result<String, JsError> {
        return Ok("TODO".into());
    }
}

// TODO: define functions for variable expansion on `Binding??`

// TODO: convert errors to my own error type for Validation and serde_wasm_bindgen error

impl BindingInput {
    fn has_foreach(&self) -> bool {
        if let Some(foreach) = &self.foreach {
            return foreach.len() > 0;
        }
        return false;
    }

    pub fn expand_foreach(self) -> ResultVec<Vec<BindingInput>> {
        if self.has_foreach() {
            let foreach = expand_keys(self.foreach.clone().unwrap())?;
            foreach.require_constant().context_str(
                "`foreach` values can only include expressions of the form {{keys(`regex`)}}",
            )?;

            let values = expand_foreach_values(foreach).into_iter().map(|values| {
                let mut result = self.clone();
                result.foreach = None;
                result
                    .map_expressions(&mut |x| {
                        Ok(values
                            .get(&x)
                            .map_or_else(|| Value::Expression(x), |ex| ex.clone()))
                    })
                    .expect("no errors") // since our mapping function has no errors
            });
            return Ok(values.collect());
        }
        return Ok(vec![self]);
    }
}

fn expand_foreach_values(foreach: IndexMap<String, Vec<Value>>) -> Vec<IndexMap<String, Value>> {
    let mut result = vec![IndexMap::new()];

    for (k, vals) in foreach {
        result = result
            .iter()
            .flat_map(|seed| {
                vals.iter().map(|v| {
                    let mut with_k = seed.clone();
                    with_k.insert(k.clone(), v.clone());
                    return with_k;
                })
            })
            .collect();
    }

    return result;
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

fn regularize_commands(input: &BindingInput) -> ResultVec<Vec<Command>> {
    let command: String = input.clone().command.resolve("`command` field")?;
    if command != "runCommands" {
        let commands = vec![Command {
            command,
            args: match &input.args {
                None => Value::Table(IndexMap::new()),
                Some(spanned) => spanned.as_ref().clone(),
            },
        }];
        return Ok(commands);
    } else {
        let spanned = input
            .args
            .as_ref()
            .ok_or_else(|| Error::Constraint("`runCommands` must have `args` field".to_string()))?;
        let args_pos = spanned.span();
        let args = spanned.as_ref().to_owned();
        let commands = match args {
            Value::Table(kv) => kv
                .get("commands")
                .ok_or_else(|| {
                    Error::Constraint("`runCommands` must have `args.commands` field".into())
                })?
                .clone(),
            _ => Err(Error::Validation(
                "Expected `args` to be an object with `commands` field".to_string(),
            ))?,
        };
        let command_vec = match commands {
            Value::Array(items) => items,
            _ => Err(Error::Validation(
                "Expected `args.commands` of `runCommands` to \
                be a vector of commands to run."
                    .to_string(),
            ))?,
        };

        let mut command_result = Vec::with_capacity(command_vec.len());

        for command in command_vec {
            let (command, args) = match command {
                Value::String(str) => (str.to_owned(), Value::Table(IndexMap::new())),
                Value::Table(kv) => {
                    let result = kv.get("command").ok_or_else({
                        || {
                            Error::RequiredField(
                                "`args.commands.command` field for `runCommands`".into(),
                            )
                        }
                    })?;
                    let command_name = match result {
                        Value::String(x) => x.to_owned(),
                        _ => {
                            return Err(Error::Constraint("`command` to be a string".into()))
                                .context_range(&args_pos)?;
                        }
                    };
                    let result = kv.get("args").ok_or_else(|| {
                        Error::RequiredField("`args.commands.arg` field for `runCommands`".into())
                    })?;
                    let args = match result {
                        x @ Value::Table(_) => x,
                        x @ Value::Array(_) => x,
                        _ => {
                            return Err(Error::Constraint("`args` to be a table or array".into()))?;
                        }
                    };
                    (command_name, args.to_owned())
                }
                _ => {
                    return constrain(
                        "`commands` to be an array that includes objects and strings only",
                    )?;
                }
            };
            command_result.push(Command { command, args })
        }

        return Ok(command_result);
    }
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

#[cfg(test)]
mod tests {
    use test_log::test;

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
            Value::Table(IndexMap::from([
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
            Value::Table(IndexMap::from([(
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
            Value::Table(IndexMap::from([(
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
                Value::Table(IndexMap::from([(
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
                Value::Table(IndexMap::from([(
                    "value".to_string(),
                    Value::String(expected_value[i].clone())
                )]))
            );
        }
    }

    // TODO: implement functions that don't require WASM runtime
    // to test here, and then test JS wrapped functions in integration tests
    #[test]
    fn expand_args() {
        let data = r#"
            key = "k"
            name = "test"
            command = "foo"
            args.value = '{{joe + "_biz"}}'
            args.number = '{{2+1}}'
        "#;

        let result = Binding::new(toml::from_str::<BindingInput>(data).unwrap()).unwrap();
        let mut scope = Scope::new();
        scope.set("joe".to_string(), JsValue::from_str("fiz"));
        let flat_args = result.commands[0].args(&mut scope).unwrap();

        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        let mut args_table = toml::map::Map::new();
        args_table.insert(
            "value".to_string(),
            toml::Value::String("fiz_biz".to_string()),
        );
        args_table.insert("number".to_string(), toml::Value::Integer(3));
        let expected = toml::Value::Table(args_table).serialize(&to_json).unwrap();

        assert_eq!(flat_args, expected)
    }

    // TODO: test out command queue evaluation in expressions

    // TODO: are there any edge cases / failure modes I want to look at in the tests
    // (most of the things seem likely to be covered by serde / toml parsing, and the
    // stuff I would want to check should be done at a higher level when I'm working
    // through default resolution across multiple commands rather than the within
    // command tests I'm working on here)
}

// TODO: define the "output" type for `Binding` that can actually be passed to javascript
