// TODO: refactor this *AFTER* we've got `bind` working again

use core::error;
use std::collections::{HashMap, hash_map};

use crate::bind::validation::BindingReference;
use crate::bind::{Binding, BindingInput, Command, CommandInput};
use crate::error::{Context, Error, ErrorContext, ErrorWithContext, Result, ResultVec, unexpected};
use crate::util::{Merging, Resolving};
use crate::value::{Expanding, Value};

use indexmap::IndexMap;
use lazy_static::lazy_static;
#[allow(unused_imports)]
use log::info;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::Spanned;
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Clone, Debug, Default)]
pub struct DefineInput {
    pub var: Option<Vec<IndexMap<String, Spanned<Value>>>>,
    pub command: Option<Vec<Spanned<CommandInput>>>,
    pub bind: Option<Vec<Spanned<BindingInput>>>,
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default)]
pub struct Define {
    #[wasm_bindgen(skip)]
    pub bind: HashMap<String, BindingInput>,
    #[wasm_bindgen(skip)]
    pub command: HashMap<String, CommandInput>,
    #[wasm_bindgen(skip)]
    pub var: HashMap<String, Value>,
}

impl Define {
    pub fn new(input: DefineInput) -> ResultVec<Define> {
        let mut resolved_bind = HashMap::<String, BindingInput>::new();
        let mut resolved_command = HashMap::<String, CommandInput>::new();
        let mut resolved_var = HashMap::<String, Value>::new();
        let mut errors: Vec<ErrorWithContext> = Vec::new();

        for def_block in input.var.into_iter().flatten() {
            for (var, value) in def_block.into_iter() {
                match value.resolve("`{var}` definition") {
                    Ok(x) => {
                        resolved_var.insert(var, x);
                    }
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                    }
                }
            }
        }

        for def in input.command.into_iter().flatten() {
            let id = def.get_ref().id.clone();
            let span = id
                .ok_or_else(|| Error::RequiredField("`id` field".into()))
                .context_range(&def.span());
            match span {
                Err(e) => errors.push(e.into()),
                Ok(x) => match x.resolve("`id` field") {
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                    }
                    Ok(id) => {
                        resolved_command.insert(id, def.into_inner());
                    }
                },
            }
        }

        for def in input.bind.into_iter().flatten() {
            let id = def.get_ref().id.clone();
            let span = id
                .ok_or_else(|| Error::RequiredField("`id` field".into()))
                .context_range(&def.span());
            match span {
                Err(e) => errors.push(e.into()),
                Ok(x) => match x.resolve("`id` field") {
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                    }
                    Ok(x) => {
                        resolved_bind.insert(x, def.into_inner());
                    }
                },
            }
        }

        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            // TODO: because resolution to the Binding and Command structs does not occur until
            // later, we could, in theory end up with a *lot* of errors for the same lines, it
            // will be important to clean up the output to only show one of these errors and
            // remove the other instances; or convince our selves no such issue will arise
            return Ok(Define {
                bind: resolved_bind,
                command: resolved_command,
                var: resolved_var,
            });
        }
    }
}

// NOTE: why don't we provide public access to `bind` and `command`: this avoids
// extra implementation work, when the main use case for these two categories of
// definitions is to make the binding file more concise; `var.` values on
// the other hand are often used at runtime
#[wasm_bindgen]
impl Define {
    // TODO: implement rhai evaluation
    pub fn var(&self, key: &str) -> Result<JsValue> {
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        let value = self
            .var
            .get(key)
            .ok_or_else(|| Error::RequiredField(format!("`{key}` field")))?;
        return match value.serialize(&to_json) {
            Ok(result) => Ok(result),
            Err(_) => unexpected("unexpected serialization error"),
        };
    }
}

lazy_static! {
    pub static ref BIND_REF: Regex = Regex::new(r"^bind\.([\w--\d]+\w*)$").unwrap();
    pub static ref COMMAND_REF: Regex = Regex::new(r"^command\.([\w--\d]+\w*)$").unwrap();
}

impl Define {
    pub fn expand(&mut self, binding: BindingInput) -> ResultVec<BindingInput> {
        // resolve default values
        let binding = if let Some(ref default) = binding.default {
            let BindingReference(name) = default.as_ref();
            let entry = self.bind.entry(name.clone());
            let occupied_entry = match entry {
                hash_map::Entry::Vacant(_) => Err(Error::UndefinedVariable(name.clone()))?,
                hash_map::Entry::Occupied(entry) => entry,
            };
            let mut default_value;
            if !occupied_entry.get().is_constant() {
                default_value = occupied_entry.remove();
                default_value = self.expand(default_value)?;
                self.bind.insert(name.clone(), default_value.clone());
            } else {
                default_value = occupied_entry.get().clone()
            }
            default_value.merge(binding)
        } else {
            binding
        };

        return binding.map_expressions(&mut |exp: String| {
            let command = COMMAND_REF.captures(&exp);
            if let Some(captures) = command {
                let name = captures.get(1).expect("variable name").as_str();
                return Ok(self
                    .command
                    .get(name)
                    .ok_or_else(|| Error::UndefinedVariable(name.to_string()))?
                    .without_id()
                    .into());
            }
            if BIND_REF.is_match(&exp) {
                Err(Error::Constraint(
                    "`bind.` reference in `default` field only".into(),
                ))?
            }
            return Ok(Value::Expression(exp));
        });
    }
}

mod tests {
    // use test_log::test;

    use super::*;
    #[test]
    fn simple_parsing() {
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

        assert_eq!(result.var.get("y").unwrap(), &Value::String("bill".into()));
        assert_eq!(result.var.get("joe").unwrap(), &Value::String("bob".into()));
        let foo = result.bind.get("foo").unwrap();
        assert_eq!(foo.key.as_ref().to_owned().unwrap().unwrap(), "x");
        let args = foo.args.as_ref().unwrap().clone().into_inner();
        assert_eq!(
            args,
            Value::Table(IndexMap::from([
                ("k".into(), Value::Integer(1)),
                ("h".into(), Value::Integer(2))
            ]))
        );

        let foobar = result.command.get("foobar").unwrap();
        let command: String = foobar.command.clone().resolve("`command`").unwrap();
        assert_eq!(command, "runCommands");
        let commands = foobar.args.as_ref().unwrap().clone().into_inner();
        assert_eq!(
            commands,
            Value::Table(IndexMap::from([(
                "commands".into(),
                Value::Array(vec![
                    Value::String("foo".into()),
                    Value::String("bar".into())
                ])
            )]))
        );
    }
}
