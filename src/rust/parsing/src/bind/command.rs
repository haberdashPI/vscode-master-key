#[allow(unused_imports)]
use log::info;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use toml::Spanned;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    bind::{BindingInput, UNKNOWN_RANGE},
    err,
    error::{ErrorContext, Result, ResultVec, err},
    expression::{
        Scope,
        value::{Expanding, Expression, TypedValue, Value},
    },
    resolve,
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
    /// @forBindingField bind
    /// @order 15
    /// - ❗`command`: as per the top level `command` field, this is a the command you wish to
    ///   run.
    pub command: Spanned<Required<TypedValue<String>>>,
    /// @forBindingField bind
    /// @order 15
    /// - ⚡ `args`: as per the top level `args` field. Can include
    ///   runtime [expressions](/expressions/index).
    pub args: Option<Spanned<Value>>,
    /// - ⚡ `skipWhen`: an [expression](/expressions/index) that, when evaluated to false, will
    ///    cause the command to *not* be run.
    pub skipWhen: Option<Spanned<TypedValue<bool>>>,
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
        F: FnMut(Expression) -> Result<Value>,
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
            skipWhen: self.skipWhen.map_expressions(f).unwrap_or_else(|mut e| {
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
            skipWhen: self.skipWhen.clone(),
        };
    }
}

impl From<CommandInput> for Value {
    fn from(value: CommandInput) -> Self {
        let mut entries = HashMap::new();
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
    let command: String = input.clone().command.resolve("`command`")?;
    if command != "runCommands" {
        let commands = vec![Command {
            command,
            args: match &input.args {
                None => Value::Table(HashMap::new()),
                Some(spanned) => spanned.as_ref().clone(),
            },
            skipWhen: TypedValue::Constant(false),
        }];
        return Ok(commands);
    } else {
        let spanned = input
            .args
            .as_ref()
            .ok_or_else(|| err("`runCommands` must have `args` field"))?;
        let args_pos = spanned.span();
        let args = spanned.as_ref().to_owned();
        let commands = match args {
            Value::Table(kv) => kv
                .get("commands")
                .ok_or_else(|| err("`runCommands` must have `args.commands` field"))?
                .clone(),
            _ => {
                return Err(err("Expected `args` to be an object with `commands` field"))?;
            }
        };
        let command_vec = match commands {
            Value::Array(items) => items,
            _ => {
                return Err(err("Expected `args.commands` of `runCommands` to \
                    be a vector of commands to run."))?;
            }
        };

        let mut command_result = Vec::with_capacity(command_vec.len());

        for command in command_vec {
            let (command, args, skipWhen) = match command {
                Value::String(str) => (
                    str.to_owned(),
                    Value::Table(HashMap::new()),
                    TypedValue::default(),
                ),
                Value::Table(kv) => {
                    let result = kv.get("command").ok_or_else(|| {
                        err("expected `args.commands.command` field for `runCommands`")
                    })?;
                    let command_name = match result {
                        Value::String(x) => x.to_owned(),
                        _ => {
                            return Err(err("expected `command` to be a string"))
                                .with_range(&args_pos)?;
                        }
                    };
                    let result = match kv.get("args") {
                        None => &Value::Table(HashMap::new()),
                        Some(x) => x,
                    };
                    let args = match result {
                        x @ Value::Table(_) => x,
                        x @ Value::Array(_) => x,
                        _ => {
                            return Err(err("expected `args` to be a table or array"))?;
                        }
                    };

                    let result = match kv.get("skipWhen") {
                        None => Value::Boolean(false),
                        Some(x) => x.clone(),
                    };
                    let skipWhen: TypedValue<bool> = result.try_into()?;
                    (command_name, args.to_owned(), skipWhen)
                }
                _ => {
                    return Err(err(
                        "`commands` to be an array that includes objects and strings only",
                    ))?;
                }
            };
            command_result.push(Command {
                command,
                args,
                skipWhen,
            })
        }

        return Ok(command_result);
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Debug, Serialize)]
pub struct Command {
    pub command: String,
    pub(crate) args: Value,
    pub(crate) skipWhen: TypedValue<bool>,
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
            Err(e) => Err(err!("object failed to serialize: {e}"))?,
            Ok(x) => Ok(x),
        };
    }
}

impl Command {
    pub fn new(input: CommandInput) -> ResultVec<Self> {
        if let Some(_) = input.id {
            return Err(err("`id` fields is reserved"))?;
        }
        return Ok(Command {
            command: resolve!(input, command)?,
            args: match input.args {
                Some(x) => x.into_inner(),
                None => Value::Table(HashMap::new()),
            },
            skipWhen: resolve!(input, skipWhen)?,
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::bind::command::regularize_commands;
    use test_log::test;

    use super::*;

    #[test]
    fn parse_regularize_commands() {
        let data = r#"
        command = "runCommands"

        [[args.commands]]
        command = "a"

        [[args.commands]]
        command = "b"
        args = { foo = 1, bar = 2 }

        [[args.commands]]
        command = "c"
        args = [1,2]
        skipWhen = "{{count > 2}}"
        "#;

        let bind = toml::from_str::<BindingInput>(data).unwrap();
        let commands = regularize_commands(&bind).unwrap();

        assert_eq!(commands[0].command, "a");
        assert_eq!(commands[1].command, "b");
        assert_eq!(commands[2].command, "c");

        assert_eq!(commands[0].args, Value::Table(HashMap::new()));
        assert_eq!(
            commands[1].args,
            Value::Table(HashMap::from([
                ("foo".to_string(), Value::Integer(1)),
                ("bar".to_string(), Value::Integer(2)),
            ]))
        );
        assert_eq!(
            commands[2].args,
            Value::Array(vec![Value::Integer(1), Value::Integer(2)])
        );

        assert_eq!(commands[0].skipWhen, TypedValue::Constant(false));
        assert_eq!(commands[1].skipWhen, TypedValue::Constant(false));
        assert_eq!(
            commands[2].skipWhen,
            TypedValue::Variable(Value::Exp(Expression {
                content: "count > 2".to_string(),
                span: UNKNOWN_RANGE,
                scope: smallvec::SmallVec::new(),
            }))
        );
    }

    #[test]
    fn command_is_required() {
        let data = r#"
        command = "runCommands"

        [[args.commands]]
        command = "a"

        [[args.commands]]
        args = { foo = 1, bar = 2 }
        "#;

        let bind = toml::from_str::<BindingInput>(data).unwrap();
        let commands = regularize_commands(&bind).unwrap_err();
        let msg = match commands.errors[0].error {
            crate::error::RawError::Static(x) => x,
            _ => {
                assert!(false);
                ""
            }
        };

        assert_eq!(
            msg,
            "expected `args.commands.command` field for `runCommands`"
        );
    }
}
