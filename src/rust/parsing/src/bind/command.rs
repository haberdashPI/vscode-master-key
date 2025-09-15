use std::collections::BTreeMap;
use serde::{Deserialize, Serialize};
use toml::Spanned;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    bind::{BindingInput, UNKNOWN_RANGE},
    error::{RawError, ErrorContext, Error, Result, ResultVec, constrain, reserved},
    expression::Scope,
    expression::value::{Expanding, TypedValue, Value},
    util::{Required, Resolving},
};

/// @forBindingField bind @order 15
///
/// ## Running Multiple Commands
///
/// When `bind.command` is set to `runCommands`, you can run multiple commands with a single
/// key press. The`bind.args.commands` list is an array that can contain the following
/// types:
///
/// - string: the name of the command to run
/// - object: with `command`, and optionally `args` and `skipWhen` fields.
/// - an expression referencing a command `{{command.[commandId]}}`; this is a
///   command defined in the [`[[define]]`](/bindings/define) section.
///
/// The object fields are defined as follows:
///
#[derive(Deserialize, Clone, Debug)]
pub struct CommandInput {
    // should only be `Some` in context of `Define(Input)`
    pub(crate) id: Option<Spanned<TypedValue<String>>>,
    /// @forBindingField bind @order 15
    /// - ❗`command`: as per the top level `command` field, this is a the command you wish to
    ///   run.
    pub command: Spanned<Required<TypedValue<String>>>,
    /// @forBindingField bind @order 15
    /// - ⚡ `args`: as per the top level `args` field. Can include
    ///   runtime [expressions](/expressions/index).
    /// - ⚡ `skipWhen`: an [expression](/expressions/index) that, when evaluated to false, will
    ///    cause the command to *not* be run.
    // **TODO**: implement `skipWhen`
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
        let mut entries = BTreeMap::new();
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

pub(crate) fn regularize_commands(input: &BindingInput) -> ResultVec<Vec<Command>> {
    let command: String = input.clone().command.resolve("`command` field")?;
    if command != "runCommands" {
        let commands = vec![Command {
            command,
            args: match &input.args {
                None => Value::Table(BTreeMap::new()),
                Some(spanned) => spanned.as_ref().clone(),
            },
        }];
        return Ok(commands);
    } else {
        let spanned = input
            .args
            .as_ref()
            .ok_or_else(|| RawError::Constraint("`runCommands` must have `args` field".to_string()))?;
        let args_pos = spanned.span();
        let args = spanned.as_ref().to_owned();
        let commands = match args {
            Value::Table(kv) => kv
                .get("commands")
                .ok_or_else(|| {
                    RawError::Constraint("`runCommands` must have `args.commands` field".into())
                })?
                .clone(),
            _ => Err(RawError::Validation(
                "Expected `args` to be an object with `commands` field".to_string(),
            ))?,
        };
        let command_vec = match commands {
            Value::Array(items) => items,
            _ => Err(RawError::Validation(
                "Expected `args.commands` of `runCommands` to \
                be a vector of commands to run."
                    .to_string(),
            ))?,
        };

        let mut command_result = Vec::with_capacity(command_vec.len());

        for command in command_vec {
            let (command, args) = match command {
                Value::String(str) => (str.to_owned(), Value::Table(BTreeMap::new())),
                Value::Table(kv) => {
                    let result = kv.get("command").ok_or_else({
                        || {
                            RawError::RequiredField(
                                "`args.commands.command` field for `runCommands`".into(),
                            )
                        }
                    })?;
                    let command_name = match result {
                        Value::String(x) => x.to_owned(),
                        _ => {
                            let err: Error =
                                RawError::Constraint("`command` to be a string".into()).into();
                            Err(err).context_range(&args_pos)?
                        }
                    };
                    let result = kv.get("args").ok_or_else(|| {
                        RawError::RequiredField("`args.commands.arg` field for `runCommands`".into())
                    })?;
                    let args = match result {
                        x @ Value::Table(_) => x,
                        x @ Value::Array(_) => x,
                        _ => {
                            return Err(RawError::Constraint("`args` to be a table or array".into()))?;
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

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Debug, Serialize)]
pub struct Command {
    pub command: String,
    pub(crate) args: Value,
}

#[wasm_bindgen]
impl Command {
    pub(crate) fn toml_args(&self, scope: &mut Scope) -> ResultVec<toml::Value> {
        let flat_args = scope.expand(&self.args)?;
        return Ok(toml::Value::from(flat_args));
    }

    pub fn args(&self, scope: &mut Scope) -> ResultVec<JsValue> {
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        return match self.toml_args(scope)?.serialize(&to_json) {
            Err(e) => Err(RawError::JsSerialization(format!("{}", e)))?,
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
                None => Value::Table(BTreeMap::new()),
            },
        });
    }
}
