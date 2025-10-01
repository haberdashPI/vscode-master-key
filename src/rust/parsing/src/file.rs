///
/// @file bindings/index.md
/// @order -10
///
/// # Master Keybindings
///
/// This defines version 2.0 of the master keybinding file format.
///
/// Master keybindings are [TOML](https://toml.io/en/) files composed of the following
/// top-level fields:
///
///

// NOTE: .simple-src-docs.config.toml is setup to insert a list of
// bindings here, between the above text and the below example

/// @file bindings/index.md
/// @order 50
///
/// Here's a minimal example, demonstrating the most basic use of each field
///
/// ```toml
/// [header]
/// # this denotes the file-format version, it must be semver compatible with 2.0
/// version = "2.0"
/// name = "My Bindings"
///
/// [[mode]]
/// name = "insert"
///
/// [[mode]]
/// name = "normal"
/// default = true
///
/// [[kind]]
/// name = "motion"
/// description = "Commands that move your cursor"
///
/// [[kind]]
/// name = "mode"
/// description = "Commands that change the keybinding mode"
///
/// [[bind]]
/// key = "i"
/// doc.name = "insert"
/// mode = "normal"
/// command = "master-key.enterInsert"
/// doc.kind = "mode"
///
/// [[bind]]
/// key = "escape"
/// doc.name = "normal"
/// mode = "insert"
/// command = "master-key.enterNormal"
/// doc.kind = "mode"
///
/// [[define.bind]]
/// id = "basic_motion"
/// mode = "normal"
/// doc.kind = "motion"
/// command = "cursorMove"
///
/// [[bind]]
/// doc.name = "right"
/// defaults = "{{basic_motion}}"
/// key = "l"
/// args.to = "right"
///
/// [[bind]]
/// doc.name = "left"
/// defaults = "{{basic_motion}}"
/// key = "h"
/// args.to = "left"
///
/// [[define.val]]
/// foo = 1
///
/// [[bind]]
/// doc.name = "double right"
/// key = "g l"
/// defaults = "{{basic_motion}}"
/// args.to = "right"
/// args.value = "{{foo+1}}"
/// ```
#[allow(unused_imports)]
use log::info;

use crate::bind::{Binding, BindingInput, UNKNOWN_RANGE};
use crate::define::{Define, DefineInput};
use crate::error::{ErrorContext, ErrorReport, ResultVec, flatten_errors};
use crate::expression::Scope;
use crate::mode::{ModeInput, Modes};

use serde::{Deserialize, Serialize};
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: copy over docs from typescript
#[derive(Deserialize, Clone, Debug)]
struct KeyFileInput {
    define: Option<DefineInput>,
    mode: Option<Vec<Spanned<ModeInput>>>,
    bind: Option<Vec<Spanned<BindingInput>>>,
}

#[derive(Clone, Debug, Serialize)]
#[wasm_bindgen]
pub struct KeyFile {
    define: Define,
    modes: Modes,
    bind: Vec<Binding>,
}

// TODO: implement methods to access/store bindings

impl KeyFile {
    // TODO: refactor to have each section's processing in corresponding module
    // for that section
    fn new(input: KeyFileInput, mut scope: &mut Scope) -> ResultVec<KeyFile> {
        let mut errors = Vec::new();

        // [[define]]
        let define_input = input.define.unwrap_or_default();
        let mut define = match Define::new(define_input, &mut scope) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Define::default()
            }
            Ok(x) => x,
        };

        // [[mode]]
        let mode_input = input
            .mode
            .unwrap_or_else(|| vec![Spanned::new(UNKNOWN_RANGE, ModeInput::default())]);
        let modes = match Modes::new(mode_input, &mut scope) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Modes::default()
            }
            Ok(x) => x,
        };

        // [[bind]]
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

        define.add_to_scope(&mut scope)?;
        let _ = scope
            .parse_asts(&bind_input)
            .map_err(|mut es| errors.append(&mut es.errors));

        let bind: Vec<_> = bind_input
            .into_iter()
            .flat_map(|x| {
                let span = x.span().clone();
                match x.into_inner().expand_foreach(&mut scope) {
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
                            .map(|x| Binding::new(x, &mut scope))
                            .collect::<ResultVec<Vec<_>>>()
                            .with_range(&span);
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
            return Ok(KeyFile {
                define,
                bind,
                modes,
            });
        } else {
            return Err(errors.into());
        }
    }
}

// TODO: don't use clone on `file`
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
    let mut scope = Scope::new(); // TODO: do something with this scope??
    return KeyFile::new(parsed, &mut scope);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bind::UNKNOWN_RANGE;
    use crate::expression::value::Expression;
    use crate::expression::value::Value;
    use smallvec::SmallVec;
    use std::collections::HashMap;
    use test_log::test;

    #[test]
    fn parse_example() {
        let data = r#"
        [[define.val]]
        foo = "bar"

        [[mode]]
        name = "normal"
        default = true

        [[bind]]
        key = "l"
        mode = "normal"
        command = "cursorRight"

        [[bind]]
        key = "h"
        model = "normal"
        command = "cursorLeft"
        "#;

        let result = parse_bytes_helper(data.as_bytes()).unwrap();

        assert_eq!(result.bind[0].key, "l");
        assert_eq!(result.bind[0].commands[0].command, "cursorRight");
        assert_eq!(result.bind[1].key, "h");
        assert_eq!(result.bind[1].commands[0].command, "cursorLeft");
    }

    #[test]
    fn resolve_bind_and_command() {
        let data = r#"

        [[define.val]]
        foo_string = "bizbaz"

        [[define.command]]
        id = "run_shebang"
        command = "shebang"
        args.a = 1
        args.b = "{{val.foo_string}}"

        [[define.bind]]
        id = "whole_shebang"
        doc.name = "the whole shebang"
        command = "runCommands"
        args.commands = ["{{command.run_shebang}}", "bar"]

        [[bind]]
        default = "{{bind.whole_shebang}}"
        key = "a"
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();

        assert_eq!(result.bind[0].doc.name, "the whole shebang");
        assert_eq!(result.bind[0].key, "a");
        assert_eq!(result.bind[0].commands[0].command, "shebang");
        assert_eq!(
            result.bind[0].commands[0].args,
            Value::Table(HashMap::from([
                ("a".into(), Value::Integer(1)),
                (
                    "b".into(),
                    Value::Exp(Expression {
                        content: "val.foo_string".into(),
                        span: UNKNOWN_RANGE,
                        error: None,
                        scope: SmallVec::new(),
                    })
                ),
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
        args.b = "{{val.foo_string}}"

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
        doc.name = "the whole shebang"
        key = "a"
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();

        assert_eq!(result.bind[0].doc.name, "the whole shebang");
        assert_eq!(result.bind[0].key, "a");
        assert_eq!(result.bind[0].commands[0].command, "shebang");
        assert_eq!(
            result.bind[0].commands[0].args,
            Value::Table(HashMap::from([
                ("a".into(), Value::Integer(1)),
                (
                    "b".into(),
                    Value::Exp(Expression {
                        content: "val.foo_string".into(),
                        span: UNKNOWN_RANGE,
                        error: None,
                        scope: SmallVec::new(),
                    })
                ),
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
        doc.name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(result.bind.len(), 10);
        for i in 0..9 {
            let args: toml::Value = result.bind[i].commands(&mut scope).unwrap()[0]
                .clone()
                .args
                .into();
            assert_eq!(result.bind[i].doc.name, expected_name[i]);
            assert_eq!(
                args,
                toml::Value::Table(
                    [(
                        "value".to_string(),
                        toml::Value::String(expected_value[i].clone())
                    )]
                    .into_iter()
                    .collect()
                )
            );
        }
    }

    #[test]
    fn foreach_error() {
        let data = r#"
        [[bind]]
        foreach.key = ["{{keys(`[0-9]`)}}"]
        doc.name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        // TODO: ensure that a proper span is shown here
        let mut scope = Scope::new();
        let result = KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert_eq!(report[0].message, "`key` field is required".to_string());
        assert_eq!(report[0].range.start.line, 1);
        assert_eq!(report[0].range.end.line, 1);
    }

    #[test]
    fn define_val_at_read() {
        let data = r#"
        [[define.val]]
        foo = "bar"

        [[bind]]
        key = "x"
        command = "{{val.foo}}"
        args.val = 2
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert_eq!(result.bind[0].commands[0].command, "bar");
    }

    #[test]
    fn just_one_default_mode() {
        let data = r#"
        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "b"
        default = true
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("default mode already set"));
        assert_eq!(report[0].range.start.line, 5)
    }

    #[test]
    fn includes_default_mode() {
        let data = r#"
        [[mode]]
        name = "a"

        [[mode]]
        name = "b"
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(
            report[0]
                .message
                .contains("exactly one mode must be the default")
        );
        assert_eq!(report[0].range.start.line, 0)
    }

    #[test]
    fn unique_mode_name() {
        let data = r#"
        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "a"
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("mode name is not unique"));
        assert_eq!(report[0].range.start.line, 5)
    }

    #[test]
    fn parse_use_mode() {
        let data = r#"
        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "b"
        whenNoBinding.useMode = "a"
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert_eq!(
            result.modes.get("b").unwrap().whenNoBinding,
            crate::mode::WhenNoBinding::UseMode("a".to_string())
        )
    }

    #[test]
    fn validate_use_mode() {
        let data = r#"
        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "b"
        whenNoBinding.useMode = "c"
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("mode `c` is not defined"));
        assert_eq!(report[0].range.start.line, 7)
    }

    #[test]
    fn eval_mode_expressions() {
        let data = r#"
        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "b"

        [[mode]]
        name = "c"

        [[bind]]
        key = "a"
        command = "foo"
        mode = '{{all_modes()}}'

        [[bind]]
        key = "b"
        command = "bar"
        mode = '{{not_modes(["c"])}}'
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert!(result.bind[0].mode.iter().any(|x| x == "a"));
        assert!(result.bind[0].mode.iter().any(|x| x == "b"));
        assert!(result.bind[0].mode.iter().any(|x| x == "c"));
        assert!(result.bind[1].mode.iter().any(|x| x == "a"));
        assert!(result.bind[1].mode.iter().any(|x| x == "b"));
        assert!(!result.bind[1].mode.iter().any(|x| x == "c"));
    }

    #[test]
    fn validate_mode_expressions() {
        let data = r#"
        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "b"

        [[mode]]
        name = "c"

        [[bind]]
        key = "b"
        command = "bar"
        mode = '{{not_modes(["d"])}}'
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("mode `d`"));
        assert_eq!(report[0].range.start.line, 14)
    }

    #[test]
    fn command_expansion() {
        let data = r#"
        [[define.val]]
        flag = true
        bar = "test"

        [[define.command]]
        id = "foo"
        command = "runCommands"
        args.commands = ["a", "b", "c"]

        [[bind]]
        key = "x"
        command = "runCommands"

        [[bind.args.commands]]
        command = "x"
        args.val = 1
        args.name = "{{val.bar}}"

        [[bind.args.commands]]
        command = "y"
        skipWhen = "{{val.flag}}"

        [[bind.args.commands]]
        command = "runCommands"
        args.commands = ["j", "k", "{{command.foo}}"]
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        let commands = result.bind[0].commands(&mut scope).unwrap();
        assert_eq!(commands[0].command, "x");
        assert_eq!(commands[1].command, "j");
        assert_eq!(commands[2].command, "k");
        assert_eq!(commands[3].command, "a");
        assert_eq!(commands[4].command, "b");
        assert_eq!(commands[5].command, "c");
        assert_eq!(commands.len(), 6);
    }

    // TODO: write a test for required field `key` and ensure the span
    // is narrowed to the appropriate `[[bind]]` element; also should only error once
    // (right now we're erroring on the expanded value)
}
