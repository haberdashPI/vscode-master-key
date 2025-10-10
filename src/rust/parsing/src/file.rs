///
/// @file bindings/index.md
/// @order -10
///
/// # Master Keybindings
///
/// This defines version 2.0 of the master keybinding file format.
/// Breaking changes from version 1.0 are [described below](#breaking-changes)
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
/// version = "2.0.0"
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
/// ## Breaking Changes
///
/// The following changes were made from version 1.0 of the file format.
///
/// - `header.version` is now 2.0
/// - [`[[define]]`](/bindings/define) now has several sub fields. Definitions
///   previously under `[[define]]` should now usually go under `[[define.val]]`, but
///   also see `[[define.command]]`.
/// - generalized [expressions](/expressions/index) which then changed or replaced several
///   other features:
///   - `bind.computedArgs` no longer exists: instead place expressions inside of `args`
///   - [`bind.foreach`](/bindings/bind#foreach-clause) have changed
///     - `{key: [regex]}` is now <span v-pre><code>{{keys(&grave;[regex]&grave;)}}</code></span>
///     - foreach variables are interpolated as expressions (<span v-pre>`{{symbol}}`</span>
///       instead of `{symbol}`).
///   - `bind.path` and `[[path]]`: A similar, but more explicit approach
///      is possible using `default` and [`define.bind`](/bindings/define#binding-definitions)
///   - replaced `mode = []` with <span v-pre>`mode = '{{all_modes()}}'`</span>
///   - replaced <code>"&lt;all-prefixes&gt;"</code> with <span v-pre>`'{{all_prefixes()}}'`</span> **TODO**
///   - replaced `mode = ["!insert", "!capture"]` with
///     <span v-pre>`mode = '{{not_modes(["insert", "capture"])}}'`</span>
/// - renamed several fields:
///   - `name`, `description`, `hideInPalette` and `hideInDocs` moved to
///     `doc.name`, `doc.description`, `doc.hideInPalette` and `doc.hideInDocs`
///   - `combinedName`, `combinedDescription` and `combinedKey` moved to
///     `doc.combined.name`, `doc.combined.description` and `doc.combined.key`.
///   - `resetTransient` is now [`finalKey`](/bindings/bind)
///   - `bind.if` is renamed to [`bind.skipWhen`](/bindings/bind)
///   - `name` renamed to `register` in [`(re)storeNamed`](/commands/storeNamed) command
///   - Rename replay-related command fields:
///     - `at` to `whereIndexIs`
///     - `range` to `whereRangeIs`
///     - the variable `i` renamed to `index`
#[allow(unused_imports)]
use log::{error, info};

use crate::bind::{
    Binding, BindingCodes, BindingInput, BindingOutput, KeyId, LegacyBindingInput, UNKNOWN_RANGE,
};
use crate::define::{Define, DefineInput};
use crate::error::{ErrorContext, ErrorReport, ErrorSet, Result, ResultVec, flatten_errors};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Expression, Value};
use crate::kind::Kind;
use crate::mode::{ModeInput, Modes};
use crate::{err, wrn};

use lazy_static::lazy_static;
use regex::Regex;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: copy over docs from typescript
#[derive(Deserialize, Clone, Debug)]
struct KeyFileInput {
    header: Header,
    define: Option<DefineInput>,
    mode: Option<Vec<Spanned<ModeInput>>>,
    bind: Option<Vec<Spanned<BindingInput>>>,
    kind: Option<Vec<Spanned<Kind>>>,
}

#[derive(Deserialize, Clone, Debug)]
struct Header {
    version: Spanned<Version>,
}

#[derive(Clone, Debug, Serialize)]
#[wasm_bindgen]
pub struct KeyFile {
    define: Define,
    mode: Modes,
    bind: Vec<Binding>,
    kind: HashMap<String, String>,
    key_bind: Vec<BindingOutput>,
}

impl KeyFile {
    // TODO: refactor to have each section's processing in corresponding module
    // for that section
    fn new(input: KeyFileInput, mut scope: &mut Scope) -> ResultVec<KeyFile> {
        let mut errors = Vec::new();

        // [header]
        let version = input.header.version.as_ref();
        if !VersionReq::parse("2.0").unwrap().matches(version) {
            let r: Result<()> = Err(wrn!(
                "This version of master key is only compatible with the 2.0 file format."
            ))
            .with_range(&input.header.version.span());
            errors.push(r.unwrap_err().into());
        }

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

        // [[kind]]
        let kind = Kind::process(&input.kind, &mut scope)?;

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

        let (mut bind, bind_span): (Vec<_>, Vec<_>) = bind_input
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
            .unzip();
        bind = Binding::resolve_prefixes(bind, &bind_span)?;

        // TODO: store spans so we can do avoid serializing this data??
        let mut key_bind = Vec::new();
        let mut codes = BindingCodes::new();
        // TODO: call `resolve_prefixes` first
        for (i, (bind_item, span)) in bind.iter_mut().zip(bind_span.into_iter()).enumerate() {
            key_bind.append(&mut bind_item.outputs(i as i32, &scope, span, &mut codes)?);
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
                mode: modes,
                kind,
                key_bind: final_key_bind.into(),
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
        Ok((result, warnings)) => KeyFileResult {
            file: Some(result),
            errors: Some(
                warnings
                    .errors
                    .iter()
                    .map(|e| e.report(&file_content))
                    .collect(),
            ),
        },
        Err(err) => KeyFileResult {
            file: None,
            errors: Some(err.errors.iter().map(|e| e.report(&file_content)).collect()),
        },
    };
}

fn parse_bytes_helper(file_content: &[u8]) -> ResultVec<(KeyFile, ErrorSet)> {
    // ensure there's a directive
    // we know that the content was converted from a string on the typescript side
    // so we're cool with an unchecked conversion
    // TODO: maybe we implement this check in typescript??
    let has_directive: bool = {
        let mut result: bool = false;
        let skip_line = Regex::new(r"\s*(#.*)?").unwrap();
        let lines = unsafe { str::from_utf8_unchecked(file_content).lines() };
        for line in lines {
            if !skip_line.is_match(line) {
                break;
            }
            if Regex::new(r"^\s*#:master-keybindings\s*$")
                .unwrap()
                .is_match(line)
            {
                result = true;
                break;
            }
        }
        result
    };
    if !has_directive {
        Err(err!(
            "To be treated as a master keybindings file, the TOML document must \
             include the directive `#:master-keybindings` on a line by itself
             before any TOML data."
        ))
        .with_range(&(0..0))?;
    }

    let parsed = toml::from_slice::<KeyFileInput>(file_content)?;

    let mut scope = Scope::new(); // TODO: do something with this scope??
    let bind = parsed.bind.clone();
    let result = KeyFile::new(parsed, &mut scope);

    let legacy_check = bind.map_expressions(&mut |ex @ Expression { .. }| {
        if OLD_EXPRESSION.is_match(&ex.content) {
            Err(wrn!(
                "In format 2.0, expressions must now be surrounded in double curly\
                        braces, not single.",
            ))
            .with_range(&ex.span.clone())?;
        }
        return Ok(Value::Exp(ex));
    });
    let mut warnings = match legacy_check {
        Err(e) => e,
        Ok(_) => vec![].into(),
    };
    match result {
        Ok(key_file) => Ok((key_file, warnings)),
        Err(mut e) => Err({
            e.errors.append(&mut warnings.errors);
            e
        }),
    }
}

//
// ---------------- Legacy Keybinding warnings ----------------
//

#[derive(Deserialize, Clone, Debug)]
struct LegacyKeyFileInput {
    bind: Vec<Spanned<LegacyBindingInput>>,
    path: Option<Vec<Spanned<toml::Value>>>,
}

lazy_static! {
    static ref OLD_EXPRESSION: Regex = Regex::new(r"\{\w+\}").unwrap();
}

impl LegacyKeyFileInput {
    fn check(&self) -> ErrorSet {
        let mut errors = Vec::new();
        for bind in &self.bind {
            match bind.as_ref().check() {
                Ok(()) => (),
                Err(mut e) => errors.append(&mut e.errors),
            }
        }

        let empty = vec![];
        for path in self.path.as_ref().unwrap_or(&empty) {
            let err: Result<()> = Err(wrn!(
                "`[[path]]` section is not supported in the 2.0 format; replace `path` \
                with `[[define.bind]]` and review more details in documentation"
            ))
            .with_range(&path.span());
            errors.push(err.unwrap_err());
        }

        return errors.into();
    }
}

pub fn identify_legacy_warnings_helper(file_content: &[u8]) -> ResultVec<()> {
    let warnings = toml::from_slice::<LegacyKeyFileInput>(&file_content)?;
    return Err(warnings.check());
}

pub fn identify_legacy_warnings(file_content: Box<[u8]>) -> KeyFileResult {
    return match identify_legacy_warnings_helper(&file_content) {
        Ok(()) => KeyFileResult {
            file: None,
            errors: None,
        },
        Err(e) => KeyFileResult {
            file: None,
            errors: Some(e.errors.iter().map(|x| x.report(&file_content)).collect()),
        },
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bind::BindingOutputArgs;
    use crate::bind::UNKNOWN_RANGE;
    use crate::bind::prefix::Prefix;
    use crate::expression::value::Expression;
    use crate::expression::value::Value;
    use smallvec::SmallVec;
    use std::collections::HashMap;
    use test_log::test;

    #[test]
    fn parse_example() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

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

        let (result, _) = parse_bytes_helper(data.as_bytes()).unwrap();

        assert_eq!(result.bind[0].key[0], "l");
        assert_eq!(result.bind[0].commands[0].command, "cursorRight");
        assert_eq!(result.bind[1].key[0], "h");
        assert_eq!(result.bind[1].commands[0].command, "cursorLeft");
    }

    #[test]
    fn validate_version() {
        let data = r#"
        [header]
        version = "1.0.0"

        [[bind]]
        key = "a"
        command = "foo"
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("version"));
        assert_eq!(report[0].range.start.line, 2);
    }

    #[test]
    fn validate_comment_directive() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "b"
        "#;

        let err = parse_bytes_helper(data.as_bytes()).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("directive"));
        assert_eq!(report[0].range.start.line, 0);
    }

    #[test]
    fn resolve_bind_and_command() {
        let data = r#"
        [header]
        version = "2.0.0"


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
        [header]
        version = "2.0.0"


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
        [header]
        version = "2.0.0"

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
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 4);
        assert_eq!(report[0].range.end.line, 4);
    }

    #[test]
    fn define_val_at_read() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 8)
    }

    #[test]
    fn includes_default_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 4)
    }

    #[test]
    fn unique_mode_name() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 8)
    }

    #[test]
    fn parse_use_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

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
            result.mode.get("b").unwrap().whenNoBinding,
            crate::mode::WhenNoBinding::UseMode("a".to_string())
        )
    }

    #[test]
    fn validate_use_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 10)
    }

    #[test]
    fn eval_mode_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 17)
    }

    fn unwrap_prefixes(prefix: &Prefix) -> &Vec<String> {
        return match prefix {
            Prefix::AnyOf(x) => x,
            x @ _ => panic!("Unexpected, unresolved prefix: {x:?}"),
        };
    }

    #[test]
    fn eval_prefix_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "z"
        command = "biz"
        prefixes.any = true

        [[bind]]
        key = "w"
        command = "baz"
        prefixes.allBut = ["d e"]
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "a")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "a b")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "d")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "d e")
        );
        assert_eq!(unwrap_prefixes(&result.bind[2].prefixes).len(), 4);
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "a")
        );
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "a b")
        );
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "d")
        );
        assert_eq!(unwrap_prefixes(&result.bind[3].prefixes).len(), 3);
    }

    #[test]
    fn validate_prefix_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "w"
        command = "baz"
        prefixes.allBut = ["d k"]
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("undefined: `d k`"));

        assert_eq!(report[0].range.start.line, 12)
    }

    #[test]
    fn command_expansion() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 13);
    }

    #[test]
    fn command_expansion_dynamically_validates_final_key() {
        let data = r#"
        [header]
        version = "2.0.0"

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
        [header]
        version = "2.0.0"

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
        [header]
        version = "2.0.0"

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
        assert_eq!(report[0].range.start.line, 13);
        assert_eq!(report[1].range.start.line, 4);
    }

    #[test]
    fn output_bindings_expand_prefixes() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a b"
        command = "foo"
        prefixes.anyOf = ["x y", "h k"]
        "#;

        let mut scope = Scope::new();
        let result =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap();
        assert_eq!(result.key_bind.len(), 8)
    }

    #[test]
    fn raises_legacy_warnings() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[path]]
        id = "modes"
        description = "foo bar"

        [[bind]]
        path = "modes"
        name = "normal"
        description = "All the legacy features!"
        kind = "foo"
        foreach.key = ["escape", "ctrl+[", "{key: [0-9]}"]
        combinedKey = "a/b"
        combinedName = "all"
        combinedDescription = "all the things"
        key = "{key}"
        mode = []
        hideInPalette = true
        hideInDocs = false
        command = "master-key.enterNormal"
        computedArgs = "a+1"
        when = "!findWidgetVisible"
        "#;

        let warnings = identify_legacy_warnings_helper(data.as_bytes()).unwrap_err();
        assert_eq!(warnings.errors.len(), 12);
    }

    #[test]
    fn validate_kind() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[kind]]
        name = "foo"
        description = "biz baz buz"

        [[bind]]
        key = "a"
        command = "bar"
        doc.kind = "foo"

        [[bind]]
        key = "b"
        command = "boop"
        doc.kind = "bleep"
        "#;

        let mut scope = Scope::new();
        let err =
            KeyFile::new(toml::from_str::<KeyFileInput>(data).unwrap(), &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("`bleep`"));
        assert_eq!(report[0].range.start.line, 16);
    }

    // TODO: write a test for required field `key` and ensure the span
    // is narrowed to the appropriate `[[bind]]` element; also should only error once
    // (right now we're erroring on the expanded value)
}
