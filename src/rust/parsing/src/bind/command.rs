#[allow(unused_imports)]
use log::info;

use core::ops::Range;
use rhai::{CustomType, TypeBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use toml::Spanned;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    bind::{BindingInput, UNKNOWN_RANGE},
    err,
    error::{ErrorContext, ParseError, Result, ResultVec, err, flatten_errors},
    expression::{
        Scope,
        value::{Expanding, Expression, TypedValue, Value},
    },
    file::KeyFileResult,
    resolve,
    util::{Required, Resolving},
    wrn,
};

/// @forBindingField bind
/// @order 14
///
/// ## Running Multiple Commands
///
/// When `bind.command` is set to `runCommands`, you can run multiple commands with a single
/// key press. The`bind.args.commands` list is an array that can contain the following
/// types:
///
/// - string: the name of the command to run
/// - object: describes the command to run
/// - an expression referencing a command <code v-pre>{{command.[commandId]}}</code>; this
///   is a command defined in the [`[[define]]`](/bindings/define) section.
///
/// The object fields are defined as follows:
///
#[allow(non_snake_case)]
#[derive(Deserialize, Clone, Debug)]
pub struct CommandInput {
    // should only be `Some` in context of `Define(Input)`
    pub(crate) id: Option<Spanned<TypedValue<String>>>,
    /// @forBindingField bind
    /// @order 15
    ///
    /// - ❗`command`: as per the top level `command` field, this is the command you wish to
    ///   run.
    pub command: Spanned<Required<TypedValue<String>>>,
    /// @forBindingField bind
    /// @order 15
    ///
    /// - ⚡ `args`: as per the top level `args` field. Can include
    ///   runtime [expressions](/expressions/index).
    pub args: Option<Spanned<Value>>,
    /// @forBindingField bind
    /// @order 15
    ///
    /// - ⚡ `skipWhen`: an [expression](/expressions/index) evaluated at run-time. When
    ///    `true` the command will not be run.
    pub skipWhen: Option<Spanned<TypedValue<bool>>>,

    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
}

// impl Expanding for CommandInput {
//     fn is_constant(&self) -> bool {
//         if self.command.is_constant() {
//             return false;
//         }
//         if self.args.is_constant() {
//             return false;
//         }
//         return true;
//     }
//     fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
//     where
//         F: FnMut(Expression) -> Result<Value>,
//     {
//         let mut errors = Vec::new();
//         let result = CommandInput {
//             id: self.id,
//             command: self.command.map_expressions(f).unwrap_or_else(|mut e| {
//                 errors.append(&mut e.errors);
//                 Spanned::new(UNKNOWN_RANGE, Required::DefaultValue)
//             }),
//             args: self.args.map_expressions(f).unwrap_or_else(|mut e| {
//                 errors.append(&mut e.errors);
//                 None
//             }),
//             skipWhen: self.skipWhen.map_expressions(f).unwrap_or_else(|mut e| {
//                 errors.append(&mut e.errors);
//                 None
//             }),
//         };
//         if errors.len() > 0 {
//             return Err(errors.into());
//         } else {
//             return Ok(result);
//         }
//     }
// }

impl CommandInput {
    pub(crate) fn without_id(&self) -> Self {
        return CommandInput {
            id: None,
            command: self.command.clone(),
            args: self.args.clone(),
            skipWhen: self.skipWhen.clone(),
            other_fields: self.other_fields.clone(),
        };
    }

    pub(crate) fn check_other_fields(&self, warnings: &mut Vec<ParseError>) {
        // warning about unknown fields
        for (key, _) in &self.other_fields {
            let err: Result<()> = Err(wrn!(
                "The field `{}` is unrecognized and will be ignored",
                key,
            ));
            warnings.push(err.unwrap_err());
        }
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
        return Value::Table(entries, None);
    }
}

pub(crate) trait CommandInputLike {
    fn command(&self, scope: &mut Scope) -> ResultVec<String>;
    fn args(&self) -> Option<Spanned<Value>>;
    #[allow(non_snake_case)]
    fn skipWhen(&self) -> TypedValue<bool> {
        return TypedValue::Constant(false);
    }
}

pub(crate) struct CommandValue<'a> {
    pub(crate) command: String,
    pub(crate) args: Option<&'a Value>,
    pub(crate) range: Range<usize>,
}

impl<'a> CommandInputLike for CommandValue<'a> {
    fn command(&self, _scope: &mut Scope) -> ResultVec<String> {
        return Ok(self.command.clone());
    }
    fn args(&self) -> Option<Spanned<Value>> {
        match self.args {
            Some(args) => Some(Spanned::new(self.range.clone(), args.clone())),
            Option::None => None,
        }
    }
}

impl CommandInputLike for BindingInput {
    fn command(&self, scope: &mut Scope) -> ResultVec<String> {
        return Ok(self.command.clone().resolve("command", scope)?);
    }

    fn args(&self) -> Option<Spanned<Value>> {
        return self.args.clone();
    }
}

impl CommandInputLike for Command {
    fn command(&self, _scope: &mut Scope) -> ResultVec<String> {
        return Ok(self.command.clone());
    }
    fn args(&self) -> Option<Spanned<Value>> {
        return Some(Spanned::new(UNKNOWN_RANGE, self.args.clone()));
    }
    fn skipWhen(&self) -> TypedValue<bool> {
        return self.skipWhen.clone();
    }
}

fn maybe_span(spans: Option<HashMap<String, Range<usize>>>, key: &str) -> Option<Range<usize>> {
    if let Some(spans) = spans {
        if let Some(span) = spans.get(key) {
            return Some(span.clone());
        }
    }
    return None;
}

pub(crate) fn regularize_commands(
    input: &impl CommandInputLike,
    scope: &mut Scope,
    warnings: &mut Vec<ParseError>,
) -> ResultVec<Vec<Command>> {
    let command: String = input.command(scope)?;
    if command != "runCommands" {
        let commands = vec![Command {
            command,
            args: match input.args() {
                None => Value::Table(HashMap::new(), None),
                Some(spanned) => spanned.as_ref().clone(),
            },
            skipWhen: input.skipWhen(),
        }];
        return Ok(commands);
    } else {
        let args = input.args();
        let spanned = args
            .as_ref()
            .ok_or_else(|| err("`runCommands` must have `args` field"))?;
        let args_pos = spanned.span();
        let args = spanned.as_ref().to_owned();
        let (commands, commands_span) = match args {
            Value::Table(kv, span) => {
                let commands = kv
                    .get("commands")
                    .ok_or_else(|| err("`runCommands` must have `args.commands` field"))?
                    .clone();
                let span = span.map(|sp| sp["commands"].clone());
                (commands, span)
            }
            _ => {
                return Err(err("Expected `args` to be an object with `commands` field"))?;
            }
        };
        let command_vec = match commands {
            Value::Array(items) => items,
            _ => {
                return Err(err("Expected `args.commands` of `runCommands` to \
                    be a vector of commands to run."))
                .with_range(&commands_span)?;
            }
        };

        let mut command_result = Vec::with_capacity(command_vec.len());

        for command in command_vec {
            #[allow(non_snake_case)]
            let (command, args, skipWhen) = match command {
                Value::String(str) => (
                    str.to_owned(),
                    Value::Table(HashMap::new(), None),
                    TypedValue::default(),
                ),
                Value::Table(kv, spans) => {
                    for (k, _) in &kv {
                        if k != "command" && k != "args" && k != "skipWhen" {
                            let err: Result<()> =
                                Err(wrn!("The field `{k}` is unrecognized and will be ignored",))
                                    .with_range(&match &spans {
                                        Some(s) => Some(s[k].clone()),
                                        None => None,
                                    });
                            warnings.push(err.unwrap_err());
                        }
                    }

                    let result = kv
                        .get("command")
                        .ok_or_else(|| {
                            err("expected `args.commands.command` field for `runCommands`")
                        })
                        .with_range(&commands_span)?;
                    let command_name = match result {
                        Value::String(x) => x.to_owned(),
                        _ => {
                            return Err(err("expected `command` to be a string")).with_range(
                                &maybe_span(spans, "command").unwrap_or(args_pos.clone()),
                            )?;
                        }
                    };
                    // check for recursive `runCommands` call
                    // and recursively regularize it if present
                    if command_name == "runCommands" {
                        if kv.get("skipWhen").is_some() {
                            // TODO: support `skipWhen` by injecting
                            // it into the children commands below
                            Err(err(
                                "`skipWhen` is not supported on a `runCommands` command",
                            ))
                            .with_range(
                                &maybe_span(spans, "skipWhen").unwrap_or(args_pos.clone()),
                            )?;
                        }
                        let mut commands = regularize_commands(
                            &(CommandValue {
                                command: command_name,
                                args: kv.get("args"),
                                range: args_pos.clone(),
                            }),
                            scope,
                            warnings,
                        )?;
                        command_result.append(&mut commands);
                        continue;
                    } else {
                        let result = match kv.get("args") {
                            Option::None => &Value::Table(HashMap::new(), None),
                            Some(x) => x,
                        };
                        let args = match result {
                            x @ Value::Table(_, _) => x,
                            x @ Value::Array(_) => x,
                            x @ Value::Exp(_) => x,
                            _x => {
                                return Err(err("expected `args` to be a table or array"))
                                    .with_range(
                                        &maybe_span(spans, "args").unwrap_or(args_pos.clone()),
                                    )?;
                            }
                        };

                        let result = match kv.get("skipWhen") {
                            Option::None => Value::Boolean(false),
                            Some(x) => x.clone(),
                        };
                        let skipWhen: TypedValue<bool> = result.try_into()?;
                        (command_name, args.to_owned(), skipWhen)
                    }
                }
                x @ Value::Exp(_) => (
                    "runCommands".to_string(),
                    Value::Table(
                        HashMap::from([("commands".to_string(), Value::Array(vec![x]))]),
                        None,
                    ),
                    TypedValue::Constant(false),
                ),
                _ => {
                    return Err(err(
                        "`commands` to be an array that includes objects and strings only",
                    ))
                    .with_range(&commands_span)?;
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

#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Deserialize, Debug, Serialize, PartialEq, CustomType)]
pub struct Command {
    pub command: String,
    #[serde(default)]
    pub(crate) args: Value,
    #[serde(default)]
    pub(crate) skipWhen: TypedValue<bool>,
}

impl Expanding for Command {
    fn is_constant(&self) -> bool {
        return self.skipWhen.is_constant() && self.args.is_constant();
    }

    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        Self: Sized,
        F: FnMut(Expression) -> Result<Value>,
    {
        let mut errors = Vec::new();
        let result = Command {
            command: self.command,
            args: self.args.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                Value::Table(HashMap::new(), None)
            }),
            skipWhen: self.skipWhen.map_expressions(f).unwrap_or_else(|mut e| {
                errors.append(&mut e.errors);
                TypedValue::Constant(false)
            }),
        };

        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            return Ok(result);
        }
    }
}

impl Resolving<Vec<Command>> for Vec<CommandInput> {
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<Vec<Command>> {
        Ok(flatten_errors(
            self.into_iter().map(|x| x.resolve(name, scope)),
        )?)
    }
}

impl Resolving<Command> for CommandInput {
    fn resolve(self, _name: &'static str, scope: &mut Scope) -> ResultVec<Command> {
        return Ok(Command::new(self, scope)?);
    }
}

#[wasm_bindgen]
impl Command {
    pub fn resolve(&self, result: &mut KeyFileResult) -> CommandOutput {
        return match self.resolve_helper(&mut result.scope) {
            Ok(x) => x,
            Err(e) => CommandOutput {
                errors: Some(e.errors.iter().map(|x| format!("{}", x)).collect()),
                command: "master-key.ignore".to_string(),
                messages: Some(result.scope.report_messages()),
                args: JsValue::null(),
            },
        };
    }
    fn resolve_helper(&self, scope: &mut Scope) -> ResultVec<CommandOutput> {
        let expanded = scope.expand(self)?;

        if expanded.skipWhen.clone().resolve("skipWhen", scope)? {
            return Ok(CommandOutput {
                errors: None,
                command: "master-key.ignore".to_string(),
                messages: Some(scope.report_messages()),
                args: JsValue::null(),
            });
        }
        let command = expanded.command.clone();
        let args = expanded.args()?;
        return Ok(CommandOutput {
            errors: None,
            messages: Some(scope.report_messages()),
            command,
            args,
        });
    }

    pub(crate) fn args(&self) -> ResultVec<JsValue> {
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        let toml: toml::Value = self.args.clone().into();
        return match toml.serialize(&to_json) {
            Err(e) => Err(err!("object failed to serialize: {e}"))?,
            Ok(x) => Ok(x),
        };
    }
    pub(crate) fn new(input: CommandInput, scope: &mut Scope) -> ResultVec<Self> {
        if let Some(_) = input.id {
            return Err(err("`id` field is reserved"))?;
        }
        return Ok(Command {
            command: resolve!(input, command, scope)?,
            args: match input.args {
                Some(x) => x.into_inner(),
                Option::None => Value::Table(HashMap::new(), None),
            },
            skipWhen: resolve!(input, skipWhen, scope)?,
        });
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Debug, CustomType)]
pub struct CommandOutput {
    pub command: String,
    #[rhai_type(skip)]
    pub errors: Option<Vec<String>>,
    #[rhai_type(skip)]
    pub messages: Option<Vec<String>>,
    pub args: JsValue,
}

impl CommandOutput {
    pub fn noop() -> Self {
        CommandOutput {
            command: "master-key.ignore".to_string(),
            errors: None,
            messages: None,
            args: JsValue::null(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::bind::command::regularize_commands;
    use crate::file::tests::unwrap_table;
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
        skipWhen = "{{key.count > 2}}"
        "#;

        let mut scope = Scope::new();
        let bind = toml::from_str::<BindingInput>(data).unwrap();
        let mut warnings = Vec::new();
        let commands = regularize_commands(&bind, &mut scope, &mut warnings).unwrap();

        assert_eq!(commands[0].command, "a");
        assert_eq!(commands[1].command, "b");
        assert_eq!(commands[2].command, "c");

        assert_eq!(commands[0].args, Value::Table(HashMap::new(), None));
        assert_eq!(
            unwrap_table(&commands[1].args),
            HashMap::from([
                ("foo".to_string(), Value::Integer(1)),
                ("bar".to_string(), Value::Integer(2)),
            ])
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
                content: "key.count > 2".to_string(),
                span: UNKNOWN_RANGE,
                error: None,
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
        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let commands = regularize_commands(&bind, &mut scope, &mut warnings).unwrap_err();
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

    #[test]
    fn command_gets_flattened() {
        let data = r#"
        command = "runCommands"

        [[args.commands]]
        command = "a"

        [[args.commands]]
        command = "b"

        [[args.commands]]
        command = "runCommands"
        args.commands = ["biz", "baz"]
        "#;

        let bind = toml::from_str::<BindingInput>(data).unwrap();
        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let commands = regularize_commands(&bind, &mut scope, &mut warnings).unwrap();
        assert_eq!(
            commands
                .iter()
                .map(|x| x.command.clone())
                .collect::<Vec<_>>(),
            [
                "a".to_string(),
                "b".to_string(),
                "biz".to_string(),
                "baz".to_string()
            ]
        )
    }

    #[test]
    fn tags_resolve_command() {
        let data = Command {
            command: "selection-utilities.insertAround".to_string(),
            args: Value::Table(
                HashMap::from([
                    (
                        "after".to_string(),
                        Value::Exp(Expression {
                            content: "braces[captured].?after ?? captured".to_string(),
                            error: None,
                            span: UNKNOWN_RANGE,
                            scope: smallvec::smallvec![],
                        }),
                    ),
                    (
                        "before".to_string(),
                        Value::Exp(Expression {
                            content: "braces[captured].?before ?? captured".to_string(),
                            error: None,
                            span: UNKNOWN_RANGE,
                            scope: smallvec::smallvec![],
                        }),
                    ),
                    ("followCursor".to_string(), Value::Boolean(true)),
                ]),
                None,
            ),
            skipWhen: TypedValue::Constant(false),
        };
    }
}
