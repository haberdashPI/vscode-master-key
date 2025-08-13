use std::collections::HashMap;

use crate::bind::{Binding, BindingInput, Command, CommandInput};
use crate::error::{Context, Error, ErrorContext, ErrorWithContext, Result, ResultVec, unexpected};
use crate::util::Requiring;
use crate::variable::VariableExpanding;

#[allow(unused_imports)]
use log::info;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::Spanned;
use validator::Validate;
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Clone, Debug, Validate)]
pub struct DefineInput {
    pub var: Option<Vec<HashMap<String, Spanned<toml::Value>>>>,
    pub command: Option<Vec<Spanned<CommandInput>>>,
    pub bind: Option<Vec<Spanned<BindingInput>>>,
}

// TODO: resolve variables for each item in `DefineInput` until
// there are no variables left to resolve or we hit a limit
// NOTE: we might have to implement pruning to get this to
// run in a reasonable time

pub trait VariableResolver {
    fn resolve_variables(&self, x: &mut impl VariableExpanding) -> ResultVec<()>;
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default)]
pub struct Define {
    #[wasm_bindgen(skip)]
    pub bind: HashMap<String, BindingInput>,
    #[wasm_bindgen(skip)]
    pub command: HashMap<String, Command>,
    #[wasm_bindgen(skip)]
    pub var: HashMap<String, toml::Value>,
}

fn map_with_err<T, R, F>(x: HashMap<String, Spanned<T>>, f: &mut F) -> ResultVec<HashMap<String, R>>
where
    F: FnMut(T) -> Result<R>,
{
    let mut errors = Vec::new();
    let result = x
        .into_iter()
        .filter_map(|(k, v)| {
            let span = v.span();
            let result = f(v.into_inner()).context_range(&span);
            return result.map_err(|e| errors.push(e)).ok().map(|v| (k, v));
        })
        .collect();
    if errors.len() > 0 {
        return Err(errors);
    } else {
        return Ok(result);
    }
}

impl Define {
    pub fn new(input: DefineInput) -> ResultVec<Define> {
        // STEP 1: resolve all definitions so that there are no interpolations of
        // `var.`, `bind.` or `command.` variables
        let mut resolved_bind = HashMap::<String, Spanned<BindingInput>>::new();
        let mut resolved_command = HashMap::<String, Spanned<CommandInput>>::new();
        let mut resolved_var = HashMap::<String, toml::Value>::new();

        // TODO: we don't want to parse expressions that start with a reference
        // to a var. command. or bind. variable to be read as a variable reference here
        // (also a good thing to writ ea test for down below)

        // STEP 1a: resolve [[define.var]] blocks; fields can have any structure but they
        // must only reference previously defined variables (we've included the TOML feature
        // to preserve order, so variables can reference other variables defined within the
        // same block)
        for def_block in input.var.into_iter().flatten() {
            for (var, mut value) in def_block.into_iter() {
                value.expand_with_getter(|id| {
                    if let Some((prefix, name)) = id.split_once('.') {
                        if prefix == "var" {
                            let resolved = resolved_var.get(name).
                                ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
                            return Ok(Some(resolved.clone()));
                        } else if prefix == "bind" || prefix == "command" {
                            return Err(Error::ForwardReference(format!(
                                "`{id}`; you cannot refer to `{prefix}` values within `var` definitions"
                            )))?;
                        }
                    }
                    // TODO: refactor so that we use a unique enum type instead of
                    // Some/None to signal resolution

                    // other types of variables are left unresolved
                    return Ok(None);
                })?;
                resolved_var.insert(var.clone(), value.get_ref().clone());
            }
        }

        // STEP 1b: resolve [[define.command]] blocks
        for mut def in input.command.into_iter().flatten() {
            def.get_mut().expand_with_getter(|id| {
                if let Some((prefix, name)) = id.split_once('.') {
                    if prefix == "var" {
                        let value = resolved_var
                                .get(name)
                                .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
                        return Ok(Some(value.clone()));
                    } else if prefix == "command" {
                        let val = resolved_command.get(id).ok_or_else(|| {
                            Error::UndefinedVariable(format!("`{id}`"))
                        })?;
                        return Ok(Some(toml::Value::try_from(val.get_ref().without_id())?))
                    } else if prefix == "bind" {
                        return Err(Error::ForwardReference(format!(
                            "`{id}`; you cannot refer to `{prefix}` values within `command` definitions"
                        )))?;
                    }
                }
                return Ok(None);
            })?;
            let id = def.get_ref().id.clone();
            resolved_command.insert(
                id.require("id")
                    .context_range(&def.span())?
                    .get_ref()
                    .clone(),
                def,
            );
        }

        // STEP 1c: resolve [[define.bind]] blocks
        for mut def in input.bind.into_iter().flatten() {
            def.get_mut().expand_with_getter(|id| {
                if let Some((prefix, name)) = id.split_once('.') {
                    if prefix == "var" {
                        let value = resolved_var
                            .get(name)
                            .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
                        return Ok(Some(value.clone()));
                    } else if prefix == "command" {
                        let val = resolved_command
                            .get(name)
                            .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
                        return Ok(Some(toml::Value::try_from(val.get_ref().without_id())?));
                    } else if prefix == "bind" {
                        let val = resolved_bind
                            .get(name)
                            .ok_or_else(|| Error::UndefinedVariable(format!("`{id}`")))?;
                        return Ok(Some(toml::Value::try_from(val.get_ref().without_id())?));
                    }
                }
                return Ok(None);
            })?;
            let id = def.get_ref().id.clone();
            resolved_bind.insert(
                id.require("id")
                    .context_range(&def.span())?
                    .get_ref()
                    .clone(),
                def,
            );
        }

        // STEP 2: cleanup results for use in `Define` struct

        // TODO: because resolution to the Binding and Command structs does not occur until
        // later, we could, in theory end up with a *lot* of errors for the same lines, it
        // will be important to clean up the output to only show one of these errors and
        // remove the other instances; or convince our selves no such issue will arise
        let bind = resolved_bind
            .into_iter()
            .map(|(k, v)| (k, v.into_inner().without_id()))
            .collect();
        let command = map_with_err(resolved_command, &mut |c| Command::new(c.without_id()))?;

        return Ok(Define {
            bind,
            command,
            var: resolved_var,
        });
    }
}

// NOTE: why don't we provide public access to `bind` and `command`: this avoids
// extra implementation work, when the main use case for these two categories of
// definitions is to make the binding file more concise; `var.` values on
// the other hand are often used at runtime
#[wasm_bindgen]
impl Define {
    pub fn var(&self, key: &str) -> Result<JsValue> {
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        let value = self.var.get(key).require(format!("`{key}` field"))?;
        return match value.serialize(&to_json) {
            Ok(result) => Ok(result),
            Err(_) => unexpected("unexpected serialization error"),
        };
    }
}

impl VariableResolver for Define {
    fn resolve_variables(&self, x: &mut impl VariableExpanding) -> ResultVec<()> {
        x.expand_with_getter(|var| {
            if let Some((prefix, name)) = var.split_once('.') {
                if prefix == "var" {
                    return Ok(Some(
                        self.var
                            .get(name)
                            .ok_or_else(|| Error::UndefinedVariable(var.into()))?
                            .clone(),
                    ));
                } else if prefix == "command" {
                    let val = self
                        .command
                        .get(name)
                        .ok_or_else(|| Error::UndefinedVariable(var.into()))?
                        .clone();
                    return Ok(Some(toml::Value::try_from(val)?));
                } else if prefix == "bind" {
                    let val = self
                        .bind
                        .get(name)
                        .ok_or_else(|| Error::UndefinedVariable(var.into()))?
                        .clone();
                    return Ok(Some(toml::Value::try_from(val)?));
                }
            }
            return Ok(None);
        })?;
        return Ok(());
    }
}

mod tests {
    use test_log::test;

    use super::*;
    #[test]
    fn complete_parsing() {
        let data = r#"
        [[var]]
        y = "bill"

        [[bind]]
        id = "foo"
        key = "x"
        command = "foo"
        args = { k = 1, h = 2 }

        [[command]]
        id = "foobar"
        command = "runCommands"
        args.commands = ["foo", "bar"]

        [[var]]
        joe = "bob"

        "#;

        let result = Define::new(toml::from_str::<DefineInput>(data).unwrap()).unwrap();

        assert_eq!(result.var.get("y").unwrap().as_str().unwrap(), "bill");
        assert_eq!(result.var.get("joe").unwrap().as_str().unwrap(), "bob");
        let foo = result.bind.get("foo").unwrap();
        assert_eq!(foo.key.get_ref().as_ref().unwrap().as_str(), "x");
        assert_eq!(
            foo.args
                .as_ref()
                .unwrap()
                .get_ref()
                .get("k")
                .unwrap()
                .as_integer()
                .unwrap(),
            1
        )

        // let ref foo = result.bind.as_ref().unwrap().get("foo").unwrap().as_ref();
        // assert_eq!(foo.key.as_ref().as_ref().unwrap(), "x");
        // assert_eq!(foo.command.as_ref().as_ref().unwrap(), "foo");
        // assert_eq!(
        //     foo.args
        //         .as_ref()
        //         .unwrap()
        //         .as_ref()
        //         .get("k")
        //         .unwrap()
        //         .as_integer()
        //         .unwrap(),
        //     1
        // );
        // assert_eq!(
        //     foo.args
        //         .as_ref()
        //         .unwrap()
        //         .as_ref()
        //         .get("h")
        //         .unwrap()
        //         .as_integer()
        //         .unwrap(),
        //     2
        // );

        // let foobar = result
        //     .command
        //     .as_ref()
        //     .unwrap()
        //     .get("foobar")
        //     .unwrap()
        //     .as_ref();
        // assert_eq!(foobar.command.as_ref().as_ref().unwrap(), "runCommands");
        // let commands = foobar
        //     .args
        //     .as_ref()
        //     .unwrap()
        //     .as_ref()
        //     .get("commands")
        //     .unwrap();
        // let command_list = commands.as_array().unwrap();
        // assert_eq!(command_list[0].as_str().unwrap(), "foo");
        // assert_eq!(command_list[1].as_str().unwrap(), "bar");

        // let define = Define::new(result);
        // let foo_out = define
        //     .as_ref()
        //     .unwrap()
        //     .bind
        //     .as_ref()
        //     .unwrap()
        //     .get("foo")
        //     .unwrap();
        // assert_eq!(foo_out.commands[0].command, "foo");
    }
}

// TODO: tests
