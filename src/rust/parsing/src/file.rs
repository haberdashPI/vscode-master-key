// top-level parsing of an entire file
use crate::bind::{Binding, BindingInput, Scope};
use crate::define::{Define, DefineInput};
use crate::error::{self, ErrorContext, ErrorReport, ResultVec, flatten_errors};

use serde::{Deserialize, Serialize};
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: copy over docs from typescript
#[derive(Deserialize, Clone, Debug)]
struct KeyFileInput {
    define: Option<DefineInput>,
    bind: Option<Vec<Spanned<BindingInput>>>,
}

#[derive(Clone, Debug)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct KeyFile {
    pub define: Define,
    pub bind: Vec<Binding>,
}

impl KeyFile {
    fn new(input: KeyFileInput) -> ResultVec<KeyFile> {
        let mut errors = Vec::new();
        let define_input = input.define.unwrap_or_default();
        let mut define = match Define::new(define_input) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Define::default()
            }
            Ok(x) => x,
        };

        let input_iter = input
            .bind
            .into_iter()
            .flatten()
            .map(|x| Ok(Spanned::new(x.span(), define.expand(x.into_inner())?)));

        let bind_input = match flatten_errors(input_iter) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Vec::new()
            }
            Ok(x) => x,
        };

        let mut scope = Scope::new();
        let _ = scope
            .parse_asts(&bind_input)
            .map_err(|mut es| errors.append(&mut es.errors));

        let bind: Vec<_> = bind_input
            .into_iter()
            .flat_map(|x| {
                let span = x.span().clone();
                match x.into_inner().expand_foreach() {
                    Ok(replicates) => {
                        // we resolve the foreach elements originating from a single item
                        // here, rather than expanding and flattening all errors across
                        // every iteration of the `foreach`. That's because we only want the
                        // first instance of an error at a given text span to show up in the
                        // final error output (e.g. if we have [[bind]] item with
                        // foreach.key = [1,2,3] we don't want an error about a missing
                        // required `key` field` to show up three times
                        let items = replicates
                            .into_iter()
                            .map(Binding::new)
                            .collect::<ResultVec<Vec<_>>>()
                            .context_range(&span);
                        match items {
                            Ok(x) => x,
                            Err(mut e) => {
                                errors.append(&mut e.errors);
                                Vec::new()
                            }
                        }
                    }
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                        Vec::new()
                    }
                }
            })
            .collect();

        if errors.len() == 0 {
            return Ok(KeyFile { define, bind });
        } else {
            return Err(errors.into());
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct KeyFileResult {
    pub file: Option<KeyFile>,
    pub errors: Option<Vec<ErrorReport>>,
}

#[wasm_bindgen]
pub fn parse_keybinding_bytes(file_content: Box<[u8]>) -> KeyFileResult {
    return match parse_bytes_helper(&file_content) {
        Ok(result) => KeyFileResult {
            file: Some(result),
            errors: None,
        },
        Err(err) => KeyFileResult {
            file: None,
            errors: Some(err.errors.iter().map(|e| e.report(&file_content)).collect()),
        },
    };
}

fn parse_bytes_helper(file_content: &[u8]) -> ResultVec<KeyFile> {
    let parsed = toml::from_slice::<KeyFileInput>(file_content)?;
    return KeyFile::new(parsed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use test_log::test;

    #[test]
    fn parse_example() {
        let data = r#"
        [[define.var]]
        foo = "bar"

        [[bind]]
        key = "l"
        mode = "normal"
        command = "cursorRight"

        [[bind]]
        key = "h"
        model = "normal"
        command = "cursorLeft"
        "#;

        let result = parse_string(data);
        let items = result.file.unwrap();

        assert_eq!(items.bind[0].key, "l");
        assert_eq!(items.bind[0].commands[0].command, "cursorRight");
        assert_eq!(items.bind[1].key, "h");
        assert_eq!(items.bind[1].commands[0].command, "cursorLeft");
    }

    #[test]
    fn resolve_bind_and_command() {
        let data = r#"

        [[define.var]]
        foo_string = "bizbaz"

        [[define.command]]
        id = "run_shebang"
        command = "shebang"
        args.a = 1
        args.b = "{{var.foo_string}}"

        [[define.bind]]
        id = "whole_shebang"
        name = "the whole shebang"
        command = "runCommands"
        args.commands = ["{{command.run_shebang}}", "bar"]

        [[bind]]
        default = "{{bind.whole_shebang}}"
        key = "a"
        "#;

        let result = KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap()).unwrap();

        assert_eq!(result.bind[0].name.as_ref().unwrap(), "the whole shebang");
        assert_eq!(result.bind[0].key, "a");
        assert_eq!(result.bind[0].commands[0].command, "shebang");
        assert_eq!(
            result.bind[0].commands[0].args,
            Value::Table(IndexMap::from([
                ("a".into(), Value::Integer(1)),
                ("b".into(), Value::Expression("var.foo_string".into())),
            ]))
        );
        assert_eq!(result.bind[0].commands[1].command, "bar");
    }

    #[test]
    fn resolve_nested_command() {
        let data = r#"

        [[define.command]]
        id = "run_shebang"
        command = "shebang"
        args.a = 1
        args.b = "{{var.foo_string}}"

        [[define.bind]]
        id = "a"
        args.commands = ["{{command.run_shebang}}", "bar"]

        [[define.bind]]
        id = "b"
        key = "x"
        command = "runCommands"
        default = "{{bind.a}}"

        [[bind]]
        default = "{{bind.b}}"
        name = "the whole shebang"
        key = "a"
        "#;

        let result = KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap()).unwrap();

        assert_eq!(result.bind[0].name.as_ref().unwrap(), "the whole shebang");
        assert_eq!(result.bind[0].key, "a");
        assert_eq!(result.bind[0].commands[0].command, "shebang");
        assert_eq!(
            result.bind[0].commands[0].args,
            Value::Table(IndexMap::from([
                ("a".into(), Value::Integer(1)),
                ("b".into(), Value::Expression("var.foo_string".into())),
            ]))
        );
        assert_eq!(result.bind[0].commands[1].command, "bar");
    }

    #[test]
    fn expand_foreach() {
        let data = r#"
        [[bind]]
        foreach.key = ["{{keys(`[0-9]`)}}"]
        key = "c {{key}}"
        name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        let result = KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap()).unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(result.bind.len(), 10);
        for i in 0..9 {
            assert_eq!(
                result.bind[i].name.as_ref().unwrap().clone(),
                expected_name[i]
            );
            assert_eq!(
                result.bind[i].commands[0].args,
                Value::Table(IndexMap::from([(
                    "value".to_string(),
                    Value::String(expected_value[i].clone())
                ),]))
            );
        }
    }

    #[test]
    fn foreach_error() {
        let data = r#"
        [[bind]]
        foreach.key = ["{{keys(`[0-9]`)}}"]
        name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        // TODO: ensure that a proper span is shown here
        let result = KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap());
        let report = result.unwrap_err().report(data);
        assert_eq!(
            report[0].items[0].message,
            Some("requires `key` field".to_string())
        );
        assert_eq!(report[0].items[1].range.as_ref().unwrap().start.line, 1);
        assert_eq!(report[0].items[1].range.as_ref().unwrap().end.line, 1);
    }

    // TODO: write a test for required field `key` and ensure the span
    // is narrowed to the appropriate `[[bind]]` element; also should only error once
    // (right now we're erroring on the expanded value)
}
