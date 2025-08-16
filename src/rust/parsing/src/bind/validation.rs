use crate::error::{Error, ErrorWithContext, Result, ResultVec};
use crate::util::Merging;
use crate::variable;
use crate::variable::{As, VAR_STRING, Value, ValueEnum, VariableExpanding};

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
pub struct KeyBinding(ValueEnum<String>);

impl TryFrom<String> for KeyBinding {
    type Error = crate::error::ErrorWithContext;
    fn try_from(value: String) -> Result<Self> {
        if VAR_STRING.is_match(&value) {
            return Ok(KeyBinding(ValueEnum::Variable(value)));
        } else {
            valid_key_binding_str(&value)?;
            return Ok(KeyBinding(ValueEnum::Literal(value)));
        }
    }
}

impl From<KeyBinding> for String {
    fn from(value: KeyBinding) -> Self {
        match value.0 {
            ValueEnum::Literal(x) => x,
            ValueEnum::Variable(x) => x,
        }
    }
}

impl As<KeyBinding> for toml::Value {
    fn astype(&self) -> crate::error::Result<KeyBinding> {
        match self {
            toml::Value::String(str) => Ok(KeyBinding::try_from(str.clone())?),
            _ => Err(Error::Constraint("a string describing a keybinding".into()))?,
        }
    }
}

impl VariableExpanding for KeyBinding {
    fn expand_with_getter<F>(&mut self, getter: F) -> crate::error::ResultVec<()>
    where
        F: Fn(&str) -> crate::error::Result<Option<toml::Value>>,
        F: Clone,
    {
        match &mut self.0 {
            ValueEnum::Literal(_) => (),
            ValueEnum::Variable(str) => {
                let mut new_str = str.clone();
                new_str.expand_with_getter(getter)?;
                let new = KeyBinding::try_from(new_str)?;
                self.0 = new.0;
            }
        }
        return Ok(());
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
        match self.0 {
            ValueEnum::Literal(x) => x,
            ValueEnum::Variable(_) => panic!("unresolved variable"),
        }
    }
}

lazy_static! {
    static ref BIND_STRING: Regex = Regex::new(r"\{\{(bind\.[\w--\d]\w*)\}\}").unwrap();
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(try_from = "String")]
pub struct BindingReference(variable::Value<toml::Value>);

impl TryFrom<String> for BindingReference {
    type Error = ErrorWithContext;
    fn try_from(value: String) -> Result<Self> {
        let captures = BIND_STRING.captures(&value).ok_or_else(|| {
            crate::error::Error::Validation(
                "binding reference; must be of the form `{{bind.[identifier]}})".into(),
            )
        })?;
        let name = captures.get(1).expect("`bind.` identifier capture");
        return Ok(BindingReference(variable::Value::var(name.as_str().into())));
    }
}

impl VariableExpanding for BindingReference {
    fn expand_with_getter<F>(&mut self, getter: F) -> crate::error::ResultVec<()>
    where
        F: Fn(&str) -> crate::error::Result<Option<toml::Value>>,
        F: Clone,
    {
        return self.0.expand_with_getter(getter);
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

impl BindingReference {
    pub fn unwrap(self) -> toml::Value {
        return self.0.unwrap();
    }
}
