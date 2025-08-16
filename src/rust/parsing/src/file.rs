// top-level parsing of an entire file
use crate::bind::{Binding, BindingInput};
use crate::define::{Define, DefineInput, VariableResolver};
use crate::error::{ErrorContext, ErrorReport, ResultVec};
use crate::variable::VariableExpanding;

use log::info;
use serde::{Deserialize, Serialize};
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: copy over docs from typescript
#[derive(Deserialize, Serialize, Clone, Debug)]
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
    fn new(mut input: KeyFileInput) -> ResultVec<KeyFile> {
        let mut errors = Vec::new();

        let define = input
            .define
            .map(|define| {
                Define::new(define)
                    .map_err(|es| {
                        for e in es.into_iter() {
                            errors.push(e);
                        }
                    })
                    .ok()
            })
            .flatten()
            .unwrap_or_default();

        // TODO: expand each define using the other known definitions
        // (with some limit on the number of iterations to resolved)
        define.resolve_variables(&mut input.bind)?;

        let bind = input
            .bind
            .map(|bindings| {
                return bindings
                    .into_iter()
                    .filter_map(|b| {
                        let span = b.span();
                        let result = Binding::new(b.into_inner()).context_range(&span);
                        result.map_err(|e| errors.push(e)).ok()
                    })
                    .collect();
            })
            .unwrap_or_default();

        if errors.len() == 0 {
            return Ok(KeyFile { bind, define });
        } else {
            return Err(errors);
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct KeyFileResult {
    pub file: Option<KeyFile>,
    pub errors: Option<Vec<ErrorReport>>,
}

#[wasm_bindgen]
pub fn parse_string(file_content: &str) -> KeyFileResult {
    return match parse_string_helper(file_content) {
        Ok(result) => KeyFileResult {
            file: Some(result),
            errors: None,
        },
        Err(err) => KeyFileResult {
            file: None,
            errors: Some(err.iter().map(|e| e.report(file_content)).collect()),
        },
    };
}

fn parse_string_helper(file_content: &str) -> ResultVec<KeyFile> {
    let parsed = toml::from_str::<KeyFileInput>(file_content);
    return match parsed {
        Ok(input) => KeyFile::new(input),
        Err(err) => Err(vec![err.into()]),
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_log::test;

    #[test]
    fn parse_example() {
        let data = r#"
        [define.var]
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
        let items = result.file.as_ref().unwrap();

        assert_eq!(items.bind[0].key, "l");
        assert_eq!(items.bind[0].commands[0].command, "cursorRight");
        assert_eq!(items.bind[1].key, "h");
        assert_eq!(items.bind[1].commands[0].command, "cursorLeft");

        // assert_eq!(
        //     items
        //         .define
        //         .var
        //         .as_ref()
        //         .unwrap()
        //         .get("foo")
        //         .unwrap()
        //         .as_str()
        //         .unwrap(),
        //     "bar"
        // )
    }
}
