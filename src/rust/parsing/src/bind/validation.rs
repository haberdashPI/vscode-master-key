use crate::util::Required;
use lazy_static::lazy_static;
use regex::Regex;
use toml::{Spanned, Value};
use validator::ValidationError;

pub fn valid_json_array(values: &Vec<toml::Value>) -> std::result::Result<(), ValidationError> {
    return values.iter().try_for_each(valid_json_value);
}

pub trait JsonObjectShape {
    fn valid_json_object(kv: &Self) -> std::result::Result<(), ValidationError>;
}

impl JsonObjectShape for toml::Table {
    fn valid_json_object(kv: &Self) -> std::result::Result<(), ValidationError> {
        return kv.iter().try_for_each(|(_, v)| valid_json_value(v));
    }
}

impl JsonObjectShape for &Spanned<toml::Table> {
    fn valid_json_object(kv: &Self) -> std::result::Result<(), ValidationError> {
        return kv
            .get_ref()
            .iter()
            .try_for_each(|(_, v)| valid_json_value(v));
    }
}

// we read in TOML values, but only want to accept JSON-valid values in some contexts
// (since that is what we'll be serializing out to)
pub fn valid_json_value(x: &Value) -> std::result::Result<(), ValidationError> {
    match x {
        Value::Integer(_) | Value::Float(_) | Value::Boolean(_) | Value::String(_) => {
            return Ok(());
        }
        Value::Datetime(_) => {
            return Err(ValidationError::new("DateTime values are not supported"));
        }
        Value::Array(values) => return valid_json_array(values),
        Value::Table(kv) => return toml::Table::valid_json_object(kv),
    };
}

pub fn valid_json_array_object(
    kv: &Spanned<toml::Table>,
) -> std::result::Result<(), ValidationError> {
    return kv
        .as_ref()
        .iter()
        .try_for_each(|(_, v)| valid_json_value(v));
}

trait MapLike {
    fn no_reserved_fields(kv: &Self) -> std::result::Result<(), ValidationError>;
}

lazy_static! {
    static ref MODIFIER_REGEX: Regex = Regex::new(r"(?i)Ctrl|Shift|Alt|Cmd|Win|Meta").unwrap();
    static ref KEY_REGEXS: Vec<Regex> = vec![
        Regex::new(r"(?i)f[1-9]").unwrap(),
        Regex::new(r"(?i)f1[0-9]").unwrap(),
        Regex::new(r"[a-z]").unwrap(),
        Regex::new(r"[0-9]").unwrap(),
        Regex::new(r"`").unwrap(),
        Regex::new(r"-").unwrap(),
        Regex::new(r"=").unwrap(),
        Regex::new(r"\[").unwrap(),
        Regex::new(r"\]").unwrap(),
        Regex::new(r"\\").unwrap(),
        Regex::new(r";").unwrap(),
        Regex::new(r"'").unwrap(),
        Regex::new(r",").unwrap(),
        Regex::new(r"\.").unwrap(),
        Regex::new(r"\/").unwrap(),
        Regex::new(r"(?i)left").unwrap(),
        Regex::new(r"(?i)up").unwrap(),
        Regex::new(r"(?i)right").unwrap(),
        Regex::new(r"(?i)down").unwrap(),
        Regex::new(r"(?i)pageup").unwrap(),
        Regex::new(r"(?i)pagedown").unwrap(),
        Regex::new(r"(?i)end").unwrap(),
        Regex::new(r"(?i)home").unwrap(),
        Regex::new(r"(?i)tab").unwrap(),
        Regex::new(r"(?i)enter").unwrap(),
        Regex::new(r"(?i)escape").unwrap(),
        Regex::new(r"(?i)space").unwrap(),
        Regex::new(r"(?i)backspace").unwrap(),
        Regex::new(r"(?i)delete").unwrap(),
        Regex::new(r"(?i)pausebreak").unwrap(),
        Regex::new(r"(?i)capslock").unwrap(),
        Regex::new(r"(?i)insert").unwrap(),
        Regex::new(r"(?i)numpad[0-9]").unwrap(),
        Regex::new(r"(?i)numpad_multiply").unwrap(),
        Regex::new(r"(?i)numpad_add").unwrap(),
        Regex::new(r"(?i)numpad_separator").unwrap(),
        Regex::new(r"(?i)numpad_subtract").unwrap(),
        Regex::new(r"(?i)numpad_decimal").unwrap(),
        Regex::new(r"(?i)numpad_divide").unwrap(),
        // layout independent versions
        Regex::new(r"(?i)\[f[1-9]\]").unwrap(),
        Regex::new(r"(?i)\[f1[0-9]\]").unwrap(),
        Regex::new(r"(?i)\[Key[A-Z]\]").unwrap(),
        Regex::new(r"(?i)\[Digit[0-9]\]").unwrap(),
        Regex::new(r"(?i)\[Numpad[0-9]\]").unwrap(),
        Regex::new(r"\[Backquote\]").unwrap(),
        Regex::new(r"\[Minus\]").unwrap(),
        Regex::new(r"\[Equal\]").unwrap(),
        Regex::new(r"\[BracketLeft\]").unwrap(),
        Regex::new(r"\[BracketRight\]").unwrap(),
        Regex::new(r"\[Backslash\]").unwrap(),
        Regex::new(r"\[Semicolon\]").unwrap(),
        Regex::new(r"\[Quote\]").unwrap(),
        Regex::new(r"\[Comma\]").unwrap(),
        Regex::new(r"\[Period\]").unwrap(),
        Regex::new(r"\[Slash\]").unwrap(),
        Regex::new(r"\[ArrowLeft\]").unwrap(),
        Regex::new(r"\[ArrowUp\]").unwrap(),
        Regex::new(r"\[ArrowRight\]").unwrap(),
        Regex::new(r"\[ArrowDown\]").unwrap(),
        Regex::new(r"\[PageUp\]").unwrap(),
        Regex::new(r"\[PageDown\]").unwrap(),
        Regex::new(r"\[End\]").unwrap(),
        Regex::new(r"\[Home\]").unwrap(),
        Regex::new(r"\[Tab\]").unwrap(),
        Regex::new(r"\[Enter\]").unwrap(),
        Regex::new(r"\[Escape\]").unwrap(),
        Regex::new(r"\[Space\]").unwrap(),
        Regex::new(r"\[Backspace\]").unwrap(),
        Regex::new(r"\[Delete\]").unwrap(),
        Regex::new(r"\[Pause\]").unwrap(),
        Regex::new(r"\[CapsLock\]").unwrap(),
        Regex::new(r"\[Insert\]").unwrap(),
        Regex::new(r"\[NumpadMultiply\]").unwrap(),
        Regex::new(r"\[NumpadAdd\]").unwrap(),
        Regex::new(r"\[NumpadComma\]").unwrap(),
        Regex::new(r"\[NumpadSubtract\]").unwrap(),
        Regex::new(r"\[NumpadDecimal\]").unwrap(),
        Regex::new(r"\[NumpadDivide\]").unwrap(),
    ];
}

pub fn valid_key_binding(
    val: &Spanned<Required<String>>,
) -> std::result::Result<(), ValidationError> {
    match val.get_ref() {
        Required::DefaultValue => return Ok(()),
        Required::Value(x) => {
            if valid_key_binding_str(x) {
                return Err(ValidationError::new("Invalid key binding"));
            } else {
                return Ok(());
            }
        }
    };
}

fn valid_key_binding_str(str: &str) -> bool {
    for press in Regex::new(r"\s+").unwrap().split(str) {
        let mut first = true;
        for part in press.split('+') {
            if first {
                first = false;
                if !KEY_REGEXS.iter().any(|r| r.is_match(part)) {
                    return false;
                }
            } else {
                if !MODIFIER_REGEX.is_match(part) {
                    return false;
                }
            }
        }
    }
    return false;
}
