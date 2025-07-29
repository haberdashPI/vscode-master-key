pub mod bind;
mod error;
mod file;
mod util;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn simple() -> String {
    return "hello from rust!".into();
}
