use std::collections::HashMap;

use crate::bind::{Binding, BindingInput, Command, CommandInput};
use crate::error::{Context, ErrorContext, ErrorWithContext, Result, unexpected};
use crate::util::Requiring;

#[allow(unused_imports)]
use log::info;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::{Spanned, Value};
use validator::Validate;
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Clone, Debug, Validate)]
pub struct DefineInput {
    pub bind: Option<HashMap<String, Spanned<BindingInput>>>,
    pub command: Option<HashMap<String, Spanned<CommandInput>>>,
    pub var: Option<toml::Table>,
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default)]
pub struct Define {
    bind: Option<HashMap<String, Binding>>,
    command: Option<HashMap<String, Command>>,
    var: Option<toml::Table>,
}

#[wasm_bindgen]
impl Define {
    pub fn bind(&self, key: &str) -> Result<Binding> {
        let value = self
            .bind
            .as_ref()
            .require(format!("`{key}` field"))?
            .get(key)
            .require(format!("`{key}` field"))?;
        return Ok(value.clone());
    }

    pub fn command(&self, key: &str) -> Result<Command> {
        let value = self
            .command
            .as_ref()
            .require(format!("`{key}` field"))?
            .get(key)
            .require(format!("`{key}` field"))?;
        return Ok(value.clone());
    }

    pub fn var(&self, key: &str) -> Result<JsValue> {
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        let value = self
            .var
            .as_ref()
            .require(format!("`{key}` field"))?
            .get(key)
            .require(format!("`{key}` field"))?;
        return match value.serialize(&to_json) {
            Ok(result) => Ok(result),
            Err(_) => unexpected("unexpected serialization error"),
        };
    }
}

fn map_with_err<T, R, F>(
    x: HashMap<String, Spanned<T>>,
    f: &mut F,
) -> std::result::Result<HashMap<String, R>, Vec<ErrorWithContext>>
where
    F: FnMut(T) -> Result<R>,
{
    let mut errors = Vec::new();
    let result = x
        .into_iter()
        .filter_map(|(k, v)| {
            let span = v.span();
            let result = f(v.into_inner()).context(Context::Range(span));
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
    pub fn new(input: DefineInput) -> std::result::Result<Define, Vec<ErrorWithContext>> {
        let bind = match input.bind {
            Some(x) => Some(map_with_err(x, &mut |b| Binding::new(b))?),
            None => None,
        };
        let command = match input.command {
            Some(x) => Some(map_with_err(x, &mut |c| Command::new(c))?),
            None => None,
        };

        return Ok(Define {
            bind,
            command,
            var: input.var,
        });
    }
}

mod tests {
    use test_log::test;

    use super::*;
    #[test]
    fn complete_parsing() {
        let data = r#"
        var.y = "bill"

        [bind.foo]
        key = "x"
        command = "foo"
        args = { k = 1, h = 2 }

        [command.foobar]
        command = "runCommands"
        args.commands = ["foo", "bar"]

        [var.x]
        joe = "bob"
        "#;

        let result = toml::from_str::<DefineInput>(data).unwrap();
        assert_eq!(
            result
                .var
                .as_ref()
                .unwrap()
                .get("y")
                .unwrap()
                .as_str()
                .unwrap(),
            "bill"
        );

        assert_eq!(
            result
                .var
                .as_ref()
                .unwrap()
                .get("x")
                .unwrap()
                .as_table()
                .unwrap()
                .get("joe")
                .unwrap()
                .as_str()
                .unwrap(),
            "bob"
        );

        let ref foo = result.bind.as_ref().unwrap().get("foo").unwrap().as_ref();
        assert_eq!(foo.key.as_ref().as_ref().unwrap(), "x");
        assert_eq!(foo.command.as_ref().as_ref().unwrap(), "foo");
        assert_eq!(
            foo.args
                .as_ref()
                .unwrap()
                .as_ref()
                .get("k")
                .unwrap()
                .as_integer()
                .unwrap(),
            1
        );
        assert_eq!(
            foo.args
                .as_ref()
                .unwrap()
                .as_ref()
                .get("h")
                .unwrap()
                .as_integer()
                .unwrap(),
            2
        );

        let foobar = result
            .command
            .as_ref()
            .unwrap()
            .get("foobar")
            .unwrap()
            .as_ref();
        assert_eq!(foobar.command.as_ref().as_ref().unwrap(), "runCommands");
        let commands = foobar
            .args
            .as_ref()
            .unwrap()
            .as_ref()
            .get("commands")
            .unwrap();
        let command_list = commands.as_array().unwrap();
        assert_eq!(command_list[0].as_str().unwrap(), "foo");
        assert_eq!(command_list[1].as_str().unwrap(), "bar");

        let define = Define::new(result);
        let foo_out = define
            .as_ref()
            .unwrap()
            .bind
            .as_ref()
            .unwrap()
            .get("foo")
            .unwrap();
        assert_eq!(foo_out.commands[0].command, "foo");
    }
}

// TODO: tests
