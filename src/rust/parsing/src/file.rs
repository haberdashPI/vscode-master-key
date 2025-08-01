// top-level parsing of an entire file
use crate::bind::{Binding, BindingInput};
use crate::error::{Context, Error, ErrorContext, ErrorReport, ErrorWithContext, Result};
use crate::file;

use log::info;
use serde::{Deserialize, Serialize};
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: copy over docs from typescript
#[derive(Deserialize, Clone, Debug)]
struct KeyFileInput {
    bind: Vec<Spanned<BindingInput>>,
}

#[derive(Clone)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct KeyFile {
    pub bind: Vec<Binding>,
}

impl KeyFile {
    fn new(input: KeyFileInput) -> std::result::Result<KeyFile, Vec<ErrorWithContext>> {
        let mut errors = Vec::new();
        let result = input
            .bind
            .into_iter()
            .filter_map(|b| {
                let span = b.span();
                Binding::new(b.into_inner())
                    .context(Context::Range(span))
                    .map_err(|e| errors.push(e))
                    .ok()
            })
            .collect();
        if !errors.len() > 0 {
            return Err(errors);
        } else {
            return Ok(KeyFile { bind: result });
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

fn parse_string_helper(file_content: &str) -> std::result::Result<KeyFile, Vec<ErrorWithContext>> {
    let parsed = toml::from_str::<KeyFileInput>(file_content);
    return match parsed {
        Ok(input) => KeyFile::new(input),
        Err(err) => return Err(vec![err.into()]),
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_log::test;

    #[test]
    fn parse_example() {
        let data = r#"
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
        assert_eq!(result.file.as_ref().unwrap().bind[0].key, "l");
        assert_eq!(
            result.file.as_ref().unwrap().bind[0].commands[0].command,
            "cursorRight"
        );
        assert_eq!(result.file.as_ref().unwrap().bind[1].key, "h");
        assert_eq!(
            result.file.as_ref().unwrap().bind[1].commands[0].command,
            "cursorLeft"
        );
    }
}
