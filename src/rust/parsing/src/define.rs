use std::collections::HashMap;

use crate::bind::{Binding, BindingInput, Command, CommandInput};
use crate::error::{Context, ErrorContext, ErrorWithContext, Result};

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

pub struct Define {
    pub bind: Option<HashMap<String, Binding>>,
    pub command: Option<HashMap<String, Command>>,
    pub var: Option<toml::Table>,
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

// TODO: tests
