use crate::error::Result;
use crate::util::{Plural, Required};

use lazy_static::lazy_static;
#[allow(unused_imports)]
use log::info;
use regex::Regex;
use toml::{Spanned, Value};

pub trait ForeachExpanding {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self;
}

impl<T: ForeachExpanding> ForeachExpanding for Spanned<T> {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        return Spanned::new(self.span(), self.get_ref().expand_foreach_value(var, value));
    }
}

impl<T: ForeachExpanding> ForeachExpanding for Plural<T> {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        match self {
            Plural::Zero => Plural::Zero,
            Plural::One(x) => Plural::One(x.expand_foreach_value(var, value)),
            Plural::Many(items) => Plural::Many(
                items
                    .iter()
                    .map(|v| v.expand_foreach_value(var, value))
                    .collect(),
            ),
        }
    }
}

impl<T: ForeachExpanding> ForeachExpanding for Required<T> {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        return match self {
            Required::DefaultValue => Required::DefaultValue,
            Required::Value(x) => Required::Value(x.expand_foreach_value(var, value)),
        };
    }
}

impl ForeachExpanding for toml::map::Map<String, toml::Value> {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        let mut result = toml::map::Map::new();
        for (k, v) in self {
            result.insert(k.clone(), v.expand_foreach_value(var, value));
        }
        return result;
    }
}

impl ForeachExpanding for toml::Value {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        match self {
            Value::String(str) => Value::String(str.expand_foreach_value(var, value)),
            Value::Array(items) => Value::Array(
                items
                    .iter()
                    .map(|i| i.expand_foreach_value(var, value))
                    .collect(),
            ),
            Value::Table(kv) => Value::Table(kv.expand_foreach_value(var, value)),
            other => other.clone(),
        }
    }
}

impl<T: ForeachExpanding> ForeachExpanding for Option<T> {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        return match self {
            Some(v) => Some(v.expand_foreach_value(var, value)),
            None => None,
        };
    }
}

impl ForeachExpanding for String {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        return self.replace(&format!("{}{var}{}", "{{", "}}"), value);
    }
}

pub trait ForeachInterpolated {
    fn foreach_interpolation(&self) -> String;
}

impl ForeachInterpolated for Value {
    fn foreach_interpolation(&self) -> String {
        match self {
            Value::String(str) => str.clone(),
            _ => format!("{}", self),
        }
    }
}

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
    static ref KEY_PATTERN_REGEX: Regex = Regex::new(r"\{\{key:\s*(.*)\}\}").unwrap();
}

pub fn expand_keys(items: &Vec<toml::Value>) -> Result<Vec<toml::Value>> {
    let mut result = Vec::new();

    for item in items {
        if let Value::String(str_item) = item {
            if let Some(caps) = KEY_PATTERN_REGEX.captures(&str_item) {
                let key_regex = Regex::new(&caps[1])?;
                for key in ALL_KEYS {
                    if key_regex.find(key).is_some_and(|m| m.len() == key.len()) {
                        result.push(Value::String(key.into()));
                    }
                }
                continue;
            }
        }
        result.push(item.clone());
    }
    return Ok(result);
}
