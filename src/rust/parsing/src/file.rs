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
    fn new(input: KeyFileInput) -> Result<KeyFile> {
        return Ok(KeyFile {
            bind: input
                .bind
                .into_iter()
                .map(|b| {
                    let span = b.span();
                    return Binding::new(b.into_inner()).context(Context::Range(span));
                })
                .collect::<Result<Vec<_>>>()?,
        });
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct KeyFileResult {
    pub file: Option<KeyFile>,
    pub error: Option<ErrorReport>,
}

#[wasm_bindgen]
pub fn parse_string(file_content: &str) -> KeyFileResult {
    return match parse_string_helper(file_content) {
        Ok(result) => KeyFileResult {
            file: Some(result),
            error: None,
        },
        Err(err) => KeyFileResult {
            file: None,
            error: Some(err.report(file_content)),
        },
    };
}

fn parse_string_helper(file_content: &str) -> Result<KeyFile> {
    let result = toml::from_str::<KeyFileInput>(file_content)?;
    return KeyFile::new(result);
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
