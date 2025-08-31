use crate::error::{Error, ErrorWithContext, ErrorsWithContext, Result, ResultVec};
use crate::util::{Merging, Resolving};
use crate::value::{EXPRESSION, Expanding, TypedValue, Value};

#[allow(unused_imports)]
use log::info;

use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};

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

fn valid_key_binding_str(str: &str) -> Result<()> {
    for press in Regex::new(r"\s+").unwrap().split(str) {
        let mut first = true;
        for part in press.split('+').rev() {
            if first {
                first = false;
                if !KEY_REGEXS.iter().any(|r| r.is_match(part)) {
                    return Err(Error::Validation(format!("key name {part}")))?;
                }
            } else {
                if !MODIFIER_REGEX.is_match(part) {
                    return Err(Error::Validation(format!("modifier name {part}")))?;
                }
            }
        }
    }
    return Ok(());
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(try_from = "String", into = "String")]
pub struct KeyBinding(TypedValue<String>);

impl TryFrom<String> for KeyBinding {
    type Error = ErrorsWithContext;
    fn try_from(value: String) -> ResultVec<Self> {
        if EXPRESSION.is_match(&value) {
            return Ok(KeyBinding(TypedValue::Variable(
                toml::Value::String(value).try_into()?,
            )));
        } else {
            valid_key_binding_str(&value)?;
            return Ok(KeyBinding(TypedValue::Constant(value)));
        }
    }
}

impl Resolving<String> for KeyBinding {
    fn resolve(self, name: impl Into<String>) -> ResultVec<String> {
        self.require_constant()?;
        Ok(self.into())
    }
}

impl Expanding for KeyBinding {
    fn is_constant(&self) -> bool {
        match self {
            KeyBinding(TypedValue::Constant(_)) => true,
            KeyBinding(TypedValue::Variable(_)) => false,
        }
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
    {
        Ok(match self {
            KeyBinding(TypedValue::Constant(ref x)) => self,
            KeyBinding(TypedValue::Variable(value)) => match value.map_expressions(f)? {
                interp @ Value::Interp(_) => KeyBinding(TypedValue::Variable(interp)),
                exp @ Value::Expression(_) => KeyBinding(TypedValue::Variable(exp)),
                Value::String(val) => {
                    valid_key_binding_str(&val)?;
                    KeyBinding(TypedValue::Constant(val))
                }
                other @ _ => return Err(Error::Unexpected("non-string value"))?,
            },
        })
    }
}

impl From<KeyBinding> for String {
    fn from(value: KeyBinding) -> Self {
        match value {
            KeyBinding(TypedValue::Constant(x)) => x,
            KeyBinding(TypedValue::Variable(value)) => panic!("Unresolved expression {value:?}"),
        }
    }
}

impl Merging for KeyBinding {
    fn merge(self, new: Self) -> Self {
        return new;
    }
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
}

impl KeyBinding {
    pub fn unwrap(self) -> String {
        match self {
            KeyBinding(TypedValue::Constant(x)) => x,
            KeyBinding(TypedValue::Variable(_)) => panic!("unresolved variable"),
        }
    }
}

lazy_static! {
    static ref BIND_VARIABLE: Regex = Regex::new(r"bind\.([\w--\d][\w]*)").unwrap();
}

#[derive(Deserialize, Clone, Debug)]
#[serde(try_from = "String", into = "String")]
pub struct BindingReference(pub(crate) String);

impl TryFrom<String> for BindingReference {
    type Error = ErrorsWithContext;
    fn try_from(value: String) -> ResultVec<Self> {
        let value: Value = toml::Value::String(value).try_into()?;
        match value {
            Value::Expression(x) => {
                if !BIND_VARIABLE.is_match(&x) {
                    Err(Error::Validation(
                        "binding reference (must be of the form `{{bind.[identifier]}}`".into(),
                    ))?;
                }
                return Ok(BindingReference(x));
            }
            _ => Err(Error::Validation(
                "binding reference (must be of the form `{{bind.[identifier]}}`".into(),
            ))?,
        }
    }
}

// This implementation of `Expanding` may seem unintuitive, but we don't actually use
// `map-expressions` to expand `BindingReference` instead we review review these values
// during a separate `BindingInput` resolution phase. During variable expansion, we simply
// want to ignore the `{{bind.}}` expression present in `BindingReference`
impl Expanding for BindingReference {
    fn is_constant(&self) -> bool {
        false
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        Self: Sized,
        F: Fn(String) -> Result<Value>,
    {
        return Ok(self);
    }
}

impl From<BindingReference> for String {
    fn from(value: BindingReference) -> Self {
        return value.0;
    }
}

impl Merging for BindingReference {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }

    fn merge(self, new: Self) -> Self {
        return new;
    }
}
