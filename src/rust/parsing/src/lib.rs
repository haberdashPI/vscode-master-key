pub mod command;
mod error;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn simple() -> String {
    return "hello from rust!".into();
}
