use std::collections::HashMap;

use crate::bind::{Binding, BindingInput, Command, CommandInput};
use crate::error::{Context, ErrorContext};

#[allow(unused_imports)]
use log::info;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::{Spanned, Value};
use validator::Validate;
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Clone, Debug, Validate)]
struct DefineInput {
    pub bind: Option<HashMap<String, Spanned<BindingInput>>>,
    pub command: Option<HashMap<String, Spanned<CommandInput>>>,
    pub var: Option<toml::Table>,
}

struct Define {
    pub bind: Option<HashMap<String, Binding>>,
    pub command: Option<HashMap<String, Command>>,
    pub var: Option<toml::Table>,
}

// TODO: tests
