// top-level parsing of an entire file
use crate::bind::{Binding, BindingInput};
use crate::define::{Define, DefineInput};
use crate::error::{ErrorContext, ErrorReport, ResultVec, flatten_errors};

use log::info;
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

        let bind_input = match flatten_errors(
            input
                .bind
                .into_iter()
                .flatten()
                .map(|x| define.expand(x.into_inner())),
        ) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Vec::new()
            }
            Ok(x) => x,
        };

        let bind = match flatten_errors(bind_input.into_iter().map(|x| Binding::new(x))) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Vec::new()
            }
            Ok(x) => x,
        };

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
pub fn parse_string(file_content: &str) -> KeyFileResult {
    return match parse_string_helper(file_content) {
        Ok(result) => KeyFileResult {
            file: Some(result),
            errors: None,
        },
        Err(err) => KeyFileResult {
            file: None,
            errors: Some(err.errors.iter().map(|e| e.report(file_content)).collect()),
        },
    };
}

fn parse_string_helper(file_content: &str) -> ResultVec<KeyFile> {
    let parsed = toml::from_str::<KeyFileInput>(file_content)?;
    return KeyFile::new(parsed);
}

#[cfg(test)]
mod tests {
    use super::*;
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

    // #[test]
    // fn parsing_resolved_bind_and_command() {
    //     let data = r#"

    //     [[define.var]]
    //     foo_string = "bizbaz"

    //     [[define.command]]
    //     id = "run_shebang"
    //     command = "shebang"
    //     args.a = 1
    //     args.b = "{{var.foo_string}}"

    //     [[define.bind]]
    //     id = "whole_shebang"
    //     name = "the whole shebang"
    //     command = "runCommands"
    //     args.commands = ["{{command.run_shebang}}", "bar"]

    //     [[bind]]
    //     default = "{{whole_shebang}}"
    //     key = "a"
    //     "#;

    //     // TODO
    // }
}
