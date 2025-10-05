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
use log::{error, info};

use crate::bind::{Binding, BindingCodes, BindingInput, BindingOutput, KeyId, UNKNOWN_RANGE};
use crate::define::{Define, DefineInput};
use crate::error::{ErrorContext, ErrorReport, ResultVec, flatten_errors};
use crate::expression::Scope;
use crate::mode::{ModeInput, Modes};

use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
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
    key_bind: Vec<BindingOutput>,
}

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
        BindingInput::add_to_scope(&bind_input, &mut scope)?;
        let _ = scope
            .parse_asts(&bind_input)
            .map_err(|mut es| errors.append(&mut es.errors));

        let bind_and_span: Vec<_> = bind_input
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
                            .map(|x| Ok((Binding::new(x, &mut scope)?, span.clone())))
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

        // TODO: store spans so we can do avoid serializing this data??
        let mut key_bind = Vec::new();
        let mut bind = Vec::new();
        let mut codes = BindingCodes::new();
        for (i, (bind_item, span)) in bind_and_span.into_iter().enumerate() {
            key_bind.append(&mut bind_item.outputs(i as i32, &scope, span, &mut codes)?);
            bind.push(bind_item);
        }
        key_bind.sort_by(BindingOutput::cmp_priority);
        // remove key_bind values with the exact same `key_id`, keeping the one
        // with the highest priority (last items)
        let mut seen_codes = HashSet::new();
        let mut final_key_bind = VecDeque::with_capacity(key_bind.len());
        for key in key_bind.into_iter().rev() {
            if !seen_codes.contains(&key.key_id()) {
                seen_codes.insert(key.key_id());
                final_key_bind.push_front(key);
            }
        }

        if errors.len() == 0 {
            return Ok(KeyFile {
                define,
                bind,
                key_bind: final_key_bind.into(),
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
    use crate::bind::BindingOutputArgs;
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

        assert_eq!(result.bind[0].key[0], "l");
        assert_eq!(result.bind[0].commands[0].command, "cursorRight");
        assert_eq!(result.bind[1].key[0], "h");
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
        assert_eq!(result.bind[0].key[0], "a");
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
        assert_eq!(result.bind[0].key[0], "a");
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
    fn eval_prefix_expressions() {
        let data = r#"
        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "z"
        command = "biz"
        prefixes = '{{all_prefixes()}}'

        [[bind]]
        key = "w"
        command = "baz"
        prefixes = '{{not_prefixes(["d e"])}}'
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert!(result.bind[2].prefixes.iter().any(|x| x == "a"));
        assert!(result.bind[2].prefixes.iter().any(|x| x == "a b"));
        assert!(result.bind[2].prefixes.iter().any(|x| x == "d"));
        assert!(result.bind[2].prefixes.iter().any(|x| x == "d e"));
        assert_eq!(result.bind[2].prefixes.len(), 4);
        assert!(result.bind[3].prefixes.iter().any(|x| x == "a"));
        assert!(result.bind[3].prefixes.iter().any(|x| x == "a b"));
        assert!(result.bind[3].prefixes.iter().any(|x| x == "d"));
        assert_eq!(result.bind[3].prefixes.len(), 3);
    }

    #[test]
    fn validate_prefix_expressions() {
        let data = r#"
        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "w"
        command = "baz"
        prefixes = '{{not_prefixes(["d k"])}}'
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("prefix `d k`"));
        assert_eq!(report[0].range.start.line, 12)
    }

    #[test]
    fn validate_prefixes_are_static() {
        let data = r#"
        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "w"
        command = "baz"
        prefixes = '{{["d e", "g h"]}}'
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        info!("report: {report:#?}");
        assert!(report[0].message.contains("statically defined"));
        assert_eq!(report[0].range.start.line, 12)
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

    #[test]
    fn command_expansion_validates_final_key() {
        let data = r#"
        [[define.val]]
        flag = true
        bar = "test"

        [[define.command]]
        id = "foo"
        command = "runCommands"
        args.commands = ["a", "b", "master-key.prefix"]

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
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("`finalKey`"));
        assert_eq!(report[0].range.start.line, 10);
    }

    #[test]
    fn command_expansion_dynamically_validates_final_key() {
        let data = r#"
        [[define.val]]
        flag = true
        bar = "test"

        [[define.command]]
        id = "foo"
        command = "runCommands"
        args.commands = ["a", "b", '{{"master-key" + ".prefix"}}']

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
        let err = result.bind[0].commands(&mut scope).unwrap_err();
        assert!(format!("{err}").contains("`finalKey`"))
    }

    #[test]
    fn output_bindings_overwrite_implicit_prefix() {
        let data = r#"
        [[bind]]
        key = "a b"
        command = "foo"

        [[bind]]
        key = "a"
        finalKey = false
        command = "master-key.prefix"
        args.cursor = "Block"
        doc.name = "explicit prefix"
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert_eq!(result.key_bind.len(), 2);
        if let BindingOutput::Do {
            key,
            args: BindingOutputArgs { prefix, .. },
            ..
        } = &result.key_bind[0]
        {
            assert_eq!(key, "b");
            assert_eq!(prefix, "a");
        } else {
            error!("Unexpected binding {:#?}", result.key_bind[0]);
            assert!(false);
        }

        if let BindingOutput::Do {
            key,
            args: BindingOutputArgs { prefix, name, .. },
            ..
        } = &result.key_bind[1]
        {
            assert_eq!(key, "a");
            assert_eq!(prefix, "");
            assert_eq!(name, "explicit prefix")
        } else {
            error!("Unexpected binding {:#?}", result.key_bind[0]);
            assert!(false);
        }
    }

    #[test]
    fn output_bindings_identify_duplicates() {
        let data = r#"
        [[bind]]
        key = "a k"
        command = "bob"

        [[bind]]
        key = "a k"
        command = "allowed conditional"
        when = "master-key.count > 0"

        [[bind]]
        key = "a k"
        command = "duplicate"
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("Duplicate key"));
        assert_eq!(report[0].range.start.line, 10);
        assert_eq!(report[1].range.start.line, 1);
    }

    #[test]
    fn output_bindings_expand_prefixes() {
        let data = r#"
        [[bind]]
        key = "a b"
        command = "foo"
        prefixes = ["x y", "h k"]
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert_eq!(result.key_bind.len(), 8)
    }

    // TODO: write a test for required field `key` and ensure the span
    // is narrowed to the appropriate `[[bind]]` element; also should only error once
    // (right now we're erroring on the expanded value)
}
