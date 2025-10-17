/// @forBindingField bind
/// @order 20
///
/// ## `foreach` Clauses
///
/// The `bind.foreach` field of a keybinding can be used to generate many bindings from one
/// entry. Each field under `foreach` is looped through exhaustively. On each iteration, any
/// [expressions](/expressions/index) with `foreach` defined variables are replaced with those variables' values
/// for the given iteration. Any expression containing a `foreach` defined variable is
/// resolved at parse-time. For example, the following defines 9 bindings:
///
/// ```toml
/// [[bind]]
/// foreach.a = [1,2,3]
/// foreach.b = [1,2,3]
/// key = "ctrl+; {{a}} {{b}}"
/// command = "type"
/// args.text = "{{a-b}}"
/// ```
///
/// Furthermore, if the expression <code v-pre>{{keys([quoted-regex])}}</code> is included
/// in a `foreach` value, it is expanded to all keybindings that match the given regular
/// expression and spliced into the array of values. For example, the following definition
/// is used in `Larkin` to allow the numeric keys to be used as a count prefix for motions.
///
/// ```toml
/// [[bind]]
/// foreach.num = ['{{keys(`[0-9]`)}}'] # matches all numeric keybindings
/// name = "count {{num}}"
/// key = "{{num}}"
/// command = "master-key.updateCount"
/// description = "Add digit {{num}} to the count argument of a command"
/// args.value = "{{num}}"
/// # etc...
/// ```
use crate::bind::BindingInput;

use indexmap::IndexMap;
#[allow(unused_imports)]
use log::info;
use regex::Regex;
use rhai::{EvalAltResult, ImmutableString};
use toml::Spanned;

use crate::error::{ErrorContext, ResultVec, flatten_errors};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Value};

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

#[allow(non_snake_case)]
pub fn expression_fn__keys(
    val: ImmutableString,
) -> std::result::Result<rhai::Array, Box<EvalAltResult>> {
    let key_regex = match Regex::new(&val) {
        Err(e) => {
            return Err(e.to_string().into());
        }
        Ok(x) => x,
    };
    let mut result = rhai::Array::new();
    for key in ALL_KEYS {
        if key_regex.find(key).is_some_and(|m| m.len() == key.len()) {
            result.push(ImmutableString::from(key).into())
        }
    }
    return Ok(result);
}

pub fn expand_keys(
    items: IndexMap<String, Vec<Spanned<Value>>>,
    scope: &mut Scope,
) -> ResultVec<IndexMap<String, Vec<Value>>> {
    // expand any `{{key(`regex`)}}` expressions (these are arrays of possible keys)
    let items = scope.expand(&items)?;

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

impl BindingInput {
    fn has_foreach(&self) -> bool {
        if let Some(foreach) = &self.foreach {
            return foreach.len() > 0;
        }
        return false;
    }

    pub fn expand_foreach(self, scope: &mut Scope) -> ResultVec<Vec<BindingInput>> {
        if self.has_foreach() {
            let foreach = expand_keys(self.foreach.clone().unwrap(), scope)?;
            foreach.require_constant()?;

            let values = expand_foreach_values(foreach).into_iter().map(|values| {
                let mut result = self.clone();
                result.foreach = None;
                result.map_expressions(&mut |mut expr| {
                    if let Some(e) = expr.error {
                        return Err(e.into());
                    }
                    for (k, v) in values.clone() {
                        expr.scope.push((k, v.into()));
                    }
                    Ok(Value::Exp(expr))
                })
            });
            return Ok(flatten_errors(values)?);
        }
        return Ok(vec![self]);
    }
}

fn expand_foreach_values(foreach: IndexMap<String, Vec<Value>>) -> Vec<IndexMap<String, Value>> {
    let mut result = vec![IndexMap::new()];

    for (k, vals) in foreach {
        result = result
            .iter()
            .flat_map(|seed| {
                vals.iter().map(|v| {
                    let mut with_k = seed.clone();
                    with_k.insert(k.clone(), v.clone());
                    return with_k;
                })
            })
            .collect();
    }

    return result;
}
