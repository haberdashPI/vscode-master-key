// TODO: refactor this *AFTER* we've got `bind` working again

// use core::error;
// use std::collections::HashMap;

// use crate::bind::{Binding, BindingInput, Command, CommandInput};
// use crate::error::{Context, Error, ErrorContext, ErrorWithContext, Result, ResultVec, unexpected};
// use crate::util::Requiring;
// use crate::value::VariableExpanding;

// use indexmap::IndexMap;
// #[allow(unused_imports)]
// use log::info;
// use serde::{Deserialize, Serialize};
// use serde_wasm_bindgen;
// use toml::Spanned;
// use wasm_bindgen::prelude::*;

// #[derive(Deserialize, Serialize, Clone, Debug)]
// pub struct DefineInput {
//     pub var: Option<Vec<IndexMap<String, Spanned<toml::Value>>>>,
//     pub command: Option<Vec<Spanned<CommandInput>>>,
//     pub bind: Option<Vec<Spanned<BindingInput>>>,
// }

// pub trait VariableResolver {
//     fn resolve_variables(&self, x: &mut impl VariableExpanding) -> ResultVec<()>;
// }

// #[wasm_bindgen]
// #[derive(Clone, Debug, Default)]
// pub struct Define {
//     #[wasm_bindgen(skip)]
//     pub bind: HashMap<String, BindingInput>,
//     #[wasm_bindgen(skip)]
//     pub command: HashMap<String, Command>,
//     #[wasm_bindgen(skip)]
//     pub var: HashMap<String, toml::Value>,
// }

// fn map_with_err<T, R, F>(x: HashMap<String, Spanned<T>>, f: f) -> ResultVec<HashMap<String, R>>
// where
//     F: FnMut(T) -> Result<R>,
// {
//     let mut errors = Vec::new();
//     let result = x
//         .into_iter()
//         .filter_map(|(k, v)| {
//             let span = v.span();
//             let result = f(v.into_inner()).context_range(&span);
//             return result.map_err(|e| errors.push(e)).ok().map(|v| (k, v));
//         })
//         .collect();
//     if errors.len() > 0 {
//         return Err(errors);
//     } else {
//         return Ok(result);
//     }
// }

// impl Define {
//     pub fn new(input: DefineInput) -> ResultVec<Define> {
//         // STEP 1: resolve all definitions so that there are no interpolations of
//         // `var.`, `bind.` or `command.` variables
//         let mut resolved_bind = HashMap::<String, Spanned<BindingInput>>::new();
//         let mut resolved_command = HashMap::<String, Spanned<CommandInput>>::new();
//         let mut resolved_var = HashMap::<String, toml::Value>::new();
//         let mut errors = Vec::new();

//         // STEP 1a: resolve [[define.var]] blocks; fields can have any structure but they
//         // must only reference previously defined variables (we've included the TOML feature
//         // to preserve order, so variables can reference other variables defined within the
//         // same block)

//         // TODO: do not resolve `var` values, and do not allow `{{}}` inside of `var.` values
//         for def_block in input.var.into_iter().flatten() {
//             for (var, mut value) in def_block.into_iter() {
//                 let mut var_result = value.expand_with_getter(|id| {
//                     if let Some((prefix, name)) = id.split_once('.') {
//                         if prefix == "var" {
//                             return Err(Error::Constraint(
//                                 "no references to `var` within a `var` definition".into()
//                             ))?;
//                         } else if prefix == "bind" || prefix == "command" {
//                             return Err(Error::ForwardReference(format!(
//                                 "`{id}`; you cannot refer to `{prefix}` values within `var` definitions"
//                             )))?;
//                         }
//                     }
//                     // TODO: refactor so that we use a unique enum type instead of
//                     // Some/None to signal resolution

//                     // other types of variables are left unresolved
//                     return Ok(None);
//                 });
//                 if let Err(ref mut errs) = var_result {
//                     errors.append(errs);
//                 }
//                 resolved_var.insert(var.clone(), value.get_ref().clone());
//             }
//         }

//         // STEP 1b: resolve [[define.command]] blocks
//         for mut def in input.command.into_iter().flatten() {
//             let mut command_result = def.get_mut().expand_with_getter(|id| {
//                 if let Some((prefix, name)) = id.split_once('.') {
//                     if prefix == "var" {
//                         let value = resolved_var
//                                 .get(name)
//                                 .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
//                         return Ok(Some(value.clone()));
//                     } else if prefix == "command" {
//                         let val = resolved_command.get(id).ok_or_else(|| {
//                             Error::UndefinedVariable(format!("`{id}`"))
//                         })?;
//                         return Ok(Some(toml::Value::try_from(val.get_ref().without_id())?))
//                     } else if prefix == "bind" {
//                         return Err(Error::ForwardReference(format!(
//                             "`{id}`; you cannot refer to `{prefix}` values within `command` definitions"
//                         )))?;
//                     }
//                 }
//                 return Ok(None);
//             });
//             if let Err(ref mut errs) = command_result {
//                 errors.append(errs);
//             }

//             let id = def.get_ref().id.clone();
//             resolved_command.insert(
//                 id.require("id")
//                     .context_range(&def.span())?
//                     .get_ref()
//                     .clone(),
//                 def,
//             );
//         }

//         // STEP 1c: resolve [[define.bind]] blocks
//         for mut def in input.bind.into_iter().flatten() {
//             let mut bind_result = def.get_mut().expand_with_getter(|id| {
//                 if let Some((prefix, name)) = id.split_once('.') {
//                     if prefix == "var" {
//                         let value = resolved_var
//                             .get(name)
//                             .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
//                         return Ok(Some(value.clone()));
//                     } else if prefix == "command" {
//                         let val = resolved_command
//                             .get(name)
//                             .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
//                         return Ok(Some(toml::Value::try_from(val.get_ref().without_id())?));
//                     } else if prefix == "bind" {
//                         let val = resolved_bind
//                             .get(name)
//                             .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
//                         return Ok(Some(toml::Value::try_from(val.get_ref().without_id())?));
//                     }
//                 }
//                 return Ok(None);
//             });
//             if let Err(ref mut errs) = bind_result {
//                 errors.append(errs);
//             }

//             let id = def.get_ref().id.clone();
//             resolved_bind.insert(
//                 id.require("id")
//                     .context_range(&def.span())?
//                     .get_ref()
//                     .clone(),
//                 def,
//             );
//         }

//         // STEP 2: cleanup results for use in `Define` struct

//         if errors.len() > 0 {
//             return Err(errors);
//         } else {
//             // TODO: because resolution to the Binding and Command structs does not occur until
//             // later, we could, in theory end up with a *lot* of errors for the same lines, it
//             // will be important to clean up the output to only show one of these errors and
//             // remove the other instances; or convince our selves no such issue will arise
//             let bind = resolved_bind
//                 .into_iter()
//                 .map(|(k, v)| (k, v.into_inner().without_id()))
//                 .collect();
//             let command = map_with_err(resolved_command, |c| Command::new(c.without_id()))?;
//             return Ok(Define {
//                 bind,
//                 command,
//                 var: resolved_var,
//             });
//         }
//     }
// }

// // NOTE: why don't we provide public access to `bind` and `command`: this avoids
// // extra implementation work, when the main use case for these two categories of
// // definitions is to make the binding file more concise; `var.` values on
// // the other hand are often used at runtime
// #[wasm_bindgen]
// impl Define {
//     pub fn var(&self, key: &str) -> Result<JsValue> {
//         let to_json = serde_wasm_bindgen::Serializer::json_compatible();
//         let value = self.var.get(key).require(format!("`{key}` field"))?;
//         return match value.serialize(&to_json) {
//             Ok(result) => Ok(result),
//             Err(_) => unexpected("unexpected serialization error"),
//         };
//     }
// }

// // TODO: we don't actually want to resolve `var.`s as they might change during runtime
// // TODO: we need to avoid parsing expressions as variables to insert

// impl VariableResolver for Define {
//     fn resolve_variables(&self, x: &mut impl VariableExpanding) -> ResultVec<()> {
//         x.expand_with_getter(|var| {
//             if let Some((prefix, name)) = var.split_once('.') {
//                 if prefix == "var" {
//                     return Ok(Some(
//                         self.var
//                             .get(name)
//                             .ok_or_else(|| Error::UndefinedVariable(var.into()))?
//                             .clone(),
//                     ));
//                 } else if prefix == "command" {
//                     let val = self
//                         .command
//                         .get(name)
//                         .ok_or_else(|| Error::UndefinedVariable(var.into()))?
//                         .clone();
//                     return Ok(Some(toml::Value::try_from(val)?));
//                 } else if prefix == "bind" {
//                     let val = self
//                         .bind
//                         .get(name)
//                         .ok_or_else(|| Error::UndefinedVariable(var.into()))?
//                         .clone();
//                     return Ok(Some(toml::Value::try_from(val)?));
//                 }
//             }
//             return Ok(None);
//         })?;
//         return Ok(());
//     }
// }

// mod tests {
//     // use test_log::test;

//     use super::*;
//     #[test]
//     fn simple_parsing() {
//         let data = r#"
//         [[var]]
//         y = "bill"

//         [[bind]]
//         id = "foo"
//         key = "x"
//         command = "foo"
//         args = { k = 1, h = 2 }

//         [[command]]
//         id = "foobar"
//         command = "runCommands"
//         args.commands = ["foo", "bar"]

//         [[var]]
//         joe = "bob"

//         "#;

//         let result = Define::new(toml::from_str::<DefineInput>(data).unwrap()).unwrap();

//         assert_eq!(result.var.get("y").unwrap().as_str().unwrap(), "bill");
//         assert_eq!(result.var.get("joe").unwrap().as_str().unwrap(), "bob");
//         let foo = result.bind.get("foo").unwrap();
//         assert_eq!(foo.key.as_ref().to_owned().unwrap().unwrap(), "x");
//         assert_eq!(
//             foo.args
//                 .as_ref()
//                 .unwrap()
//                 .get_ref()
//                 .get("k")
//                 .unwrap()
//                 .as_integer()
//                 .unwrap(),
//             1
//         );

//         assert_eq!(
//             foo.args
//                 .as_ref()
//                 .unwrap()
//                 .get_ref()
//                 .get("h")
//                 .unwrap()
//                 .as_integer()
//                 .unwrap(),
//             2
//         );

//         let foobar = result.command.get("foobar").unwrap();
//         assert_eq!(foobar.command, "runCommands");
//         let commands = foobar.args.get("commands").unwrap().as_array().unwrap();
//         assert_eq!(commands[0].as_str().unwrap(), "foo");
//         assert_eq!(commands[1].as_str().unwrap(), "bar");
//     }

//     #[test]
//     fn parsing_resolved_variables() {
//         let data = r#"
//         [[var]]
//         foo = 1

//         [[var]]
//         foo_string = "number-{{var.foo}}"

//         [[command]]
//         id = "run_shebang"
//         command = "shebang"
//         args.a = 1
//         args.b = "{{var.foo_string}}"

//         [[bind]]
//         id = "whole_shebang"
//         key = "a"
//         name = "the whole shebang"
//         command = "runCommands"
//         args.commands = ["{{command.run_shebang}}", "bar"]
//         "#;

//         let result = Define::new(toml::from_str::<DefineInput>(data).unwrap()).unwrap();
//         let bind_args = result
//             .bind
//             .get("whole_shebang")
//             .as_ref()
//             .unwrap()
//             .args
//             .as_ref()
//             .unwrap();
//         let bind_commands = bind_args
//             .get_ref()
//             .get("commands")
//             .unwrap()
//             .as_array()
//             .unwrap();
//         assert_eq!(
//             bind_commands[0].get("command").unwrap().as_str().unwrap(),
//             "shebang"
//         );
//         assert_eq!(
//             bind_commands[0]
//                 .get("args")
//                 .unwrap()
//                 .get("b")
//                 .unwrap()
//                 .as_str()
//                 .unwrap(),
//             "number-1"
//         );
//         assert_eq!(bind_commands[1].as_str().unwrap(), "bar");
//     }

//     #[test]
//     fn parsing_order_error() {
//         let data = r#"
//         [[var]]
//         k = "{{command.foo}}"

//         [[var]]
//         a = 1

//         [[var]]
//         b = "{{var.a}}-boot"

//         [[command]]
//         id = "foo"
//         command = "joe"
//         args.x = 1

//         [[command]]
//         id = "bar"
//         command = "runCommands"
//         args.commands = ["{{command.biz}}", "baz"]

//         [[command]]
//         id = "biz"
//         command = "bob"
//         args.y = 2
//         args.x = "{{bind.horace}}"

//         [[bind]]
//         id = "horace"
//         key = "ctrl+k"
//         command = "cursorLeft"
//         args.value = "{{count}}"

//         [[bind]]
//         default = "{{bind.horace}}"
//         id = "bob"
//         key = "ctrl+y"
//         command = "cursorRight"

//         [[bind]]
//         default = "{{bind.will}}"
//         id = "bob"
//         key = "ctrl+k"
//         command = "cursorDown"
//         "#;
//         // TODO: add `default` key to `bind` so we can accomplish the todo below
//         // TODO: test for missing `bind`
//         let result = Define::new(toml::from_str::<DefineInput>(data).unwrap()).unwrap_err();
//         assert!(if let Error::ForwardReference(ref str) = result[0].error {
//             str.starts_with("`command.foo`")
//         } else {
//             false
//         });
//         assert!(if let Error::Constraint(ref str) = result[1].error {
//             str.starts_with("no references to `var`")
//         } else {
//             false
//         });
//         assert!(if let Error::UndefinedVariable(ref str) = result[2].error {
//             str.starts_with("`command.biz`")
//         } else {
//             false
//         });
//         assert!(if let Error::ForwardReference(ref str) = result[3].error {
//             str.starts_with("`bind.horace`")
//         } else {
//             false
//         });
//         info!("result: {:#?}", result);
//         assert_eq!(result.len(), 4);
//     }
// }
