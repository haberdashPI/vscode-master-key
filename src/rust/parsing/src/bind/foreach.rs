use std::collections::VecDeque;

use indexmap::IndexMap;
use lazy_static::lazy_static;
#[allow(unused_imports)]
use log::info;
use regex::Regex;
use toml::Spanned;

use crate::error::{ErrorContext, Result, ResultVec};
use crate::value::{Expanding, Value};

const ALL_KEYS: [&'static str; 192] = [
    "f0",
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "f10",
    "f11",
    "f12",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "`",
    "-",
    "=",
    "[",
    "]",
    "\\",
    ";",
    "\"",
    ",",
    ".",
    "/",
    "left",
    "up",
    "right",
    "down",
    "pageup",
    "pagedown",
    "end",
    "home",
    "tab",
    "enter",
    "escape",
    "space",
    "backspace",
    "delete",
    "pausebreak",
    "capslock",
    "insert",
    "numpad0",
    "numpad1",
    "numpad2",
    "numpad3",
    "numpad4",
    "numpad5",
    "numpad6",
    "numpad7",
    "numpad8",
    "numpad9",
    "numpad_multiply",
    "numpad_add",
    "numpad_separator",
    "numpad_subtract",
    "numpad_decimal",
    "numpad_divide",
    "[F1]",
    "[F2]",
    "[F3]",
    "[F4]",
    "[F5]",
    "[F6]",
    "[F7]",
    "[F8]",
    "[F9]",
    "[F10]",
    "[F11]",
    "[F12]",
    "[F13]",
    "[F14]",
    "[F15]",
    "[F16]",
    "[F17]",
    "[F18]",
    "[F19]",
    "[KeyA]",
    "[KeyB]",
    "[KeyC]",
    "[KeyD]",
    "[KeyE]",
    "[KeyF]",
    "[KeyG]",
    "[KeyH]",
    "[KeyI]",
    "[KeyJ]",
    "[KeyK]",
    "[KeyL]",
    "[KeyM]",
    "[KeyN]",
    "[KeyO]",
    "[KeyP]",
    "[KeyQ]",
    "[KeyR]",
    "[KeyS]",
    "[KeyT]",
    "[KeyU]",
    "[KeyV]",
    "[KeyW]",
    "[KeyX]",
    "[KeyY]",
    "[KeyZ]",
    "[Digit0]",
    "[Digit1]",
    "[Digit2]",
    "[Digit3]",
    "[Digit4]",
    "[Digit5]",
    "[Digit6]",
    "[Digit7]",
    "[Digit8]",
    "[Digit9]",
    "[Backquote]",
    "[Minus]",
    "[Equal]",
    "[BracketLeft]",
    "[BracketRight]",
    "[Backslash]",
    "[Semicolon]",
    "[Quote]",
    "[Comma]",
    "[Period]",
    "[Slash]",
    "[ArrowLeft]",
    "[ArrowUp]",
    "[ArrowRight]",
    "[ArrowDown]",
    "[PageUp]",
    "[PageDown]",
    "[End]",
    "[Home]",
    "[Tab]",
    "[Enter]",
    "[Escape]",
    "[Space]",
    "[Backspace]",
    "[Delete]",
    "[Pause]",
    "[CapsLock]",
    "[Insert]",
    "[Numpad0]",
    "[Numpad1]",
    "[Numpad2]",
    "[Numpad3]",
    "[Numpad4]",
    "[Numpad5]",
    "[Numpad6]",
    "[Numpad7]",
    "[Numpad8]",
    "[Numpad9]",
    "[NumpadMultiply]",
    "[NumpadAdd]",
    "[NumpadComma]",
    "[NumpadSubtract]",
    "[NumpadDecimal]",
    "[NumpadDivide]",
];

lazy_static! {
    static ref KEY_PATTERN_REGEX: Regex =
        Regex::new(r"^\{\{\s*keys\(\s*`(.*)`\s*\)\s*\}\}\s").unwrap();
}

fn expand_keys_str(val: String) -> Result<Value> {
    if let Some(caps) = KEY_PATTERN_REGEX.captures(&val) {
        let key_regex = Regex::new(&caps[1])?;
        let mut result = Vec::new();
        for key in ALL_KEYS {
            if key_regex.find(key).is_some_and(|m| m.len() == key.len()) {
                result.push(Value::String(key.into()));
            }
        }
        return Ok(Value::Array(result));
    } else {
        return Ok(Value::Expression(val));
    }
}

pub fn expand_keys(
    items: IndexMap<String, Vec<Spanned<Value>>>,
) -> ResultVec<IndexMap<String, Vec<Value>>> {
    // expand any `{{key(`regex`)}}` expressions (these are arrays of possible keys)
    let items = items.map_expressions(&expand_keys_str)?;

    // flatten any arrays
    return Ok(items
        .into_iter()
        .map(|(k, v)| {
            let vals = v
                .into_iter()
                .flat_map(|i| match i.into_inner() {
                    Value::Array(x) => x,
                    x @ _ => vec![x],
                })
                .collect();
            return (k.clone(), vals);
        })
        .collect());
}
