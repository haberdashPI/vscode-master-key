use crate::error::{Error, Result};
use crate::util::{Plural, Required};

use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use toml::Spanned;
use validator::{Validate, ValidationError};

pub trait VariableExpanding {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()>;
}

impl<T: VariableExpanding> VariableExpanding for Spanned<T> {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        self.get_mut().expand_value(var, value)?;
        Ok(())
    }
}

impl<T: VariableExpanding> VariableExpanding for Plural<T> {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        match self {
            Plural::Zero => (),
            Plural::One(x) => x.expand_value(var, value)?,
            Plural::Many(items) => items
                .iter_mut()
                .map(|v| v.expand_value(var, value))
                .collect::<Result<_>>()?,
        }
        return Ok(());
    }
}

impl<T: VariableExpanding> VariableExpanding for Required<T> {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        return match self {
            Required::DefaultValue => Ok(()),
            Required::Value(x) => x.expand_value(var, value),
        };
    }
}

impl VariableExpanding for toml::map::Map<String, toml::Value> {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        return self
            .iter_mut()
            .map(|(_, v)| v.expand_value(var, value))
            .collect::<Result<()>>();
    }
}

impl VariableExpanding for toml::Value {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        match self {
            toml::Value::String(str) => str.expand_value(var, value)?,
            toml::Value::Array(items) => items
                .iter_mut()
                .map(|i| i.expand_value(var, value))
                .collect::<Result<_>>()?,
            toml::Value::Table(kv) => kv.expand_value(var, value)?,
            _ => (),
        }

        return Ok(());
    }
}

impl<T: VariableExpanding> VariableExpanding for Option<T> {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        match self {
            Some(v) => v.expand_value(var, value)?,
            None => (),
        };
        return Ok(());
    }
}

trait As<T> {
    fn astype(&self) -> Option<T>;
}

impl As<String> for toml::Value {
    fn astype(&self) -> Option<String> {
        self.as_str().map(|s| s.into())
    }
}

impl As<bool> for toml::Value {
    fn astype(&self) -> Option<bool> {
        self.as_bool()
    }
}

impl As<i64> for toml::Value {
    fn astype(&self) -> Option<i64> {
        self.as_integer()
    }
}

impl As<f64> for toml::Value {
    fn astype(&self) -> Option<f64> {
        self.as_float()
    }
}

impl<T> As<T> for T
where
    T: Clone,
{
    fn astype(&self) -> Option<Self> {
        Some(self.clone())
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(transparent)]
struct Value<T>(ValueEnum<T>)
where
    toml::Value: As<T>;

#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
enum ValueEnum<T>
where
    toml::Value: As<T>,
{
    Literal(T),
    Variable(String),
}

lazy_static! {
    static ref VAR_STRING: Regex = Regex::new(r"^\{\{(.*)\}\}$").unwrap();
}

fn variable_name(x: &str) -> Result<&str> {
    let captures = VAR_STRING
        .captures(x)
        .ok_or_else(|| Error::Constraint(r"string surrounded by `{{` and `}}`".into()))?;
    return Ok(captures
        .get(1)
        .ok_or_else(|| Error::Constraint("variable to be at least one character long".into()))?
        .as_str());
}

impl<T> VariableExpanding for Value<T>
where
    toml::Value: As<T>,
    T: Clone,
{
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        match &self.0 {
            ValueEnum::Literal(_) => (),
            ValueEnum::Variable(str) => {
                let name = variable_name(&str)?;
                if name == var {
                    self.0 = ValueEnum::Literal(As::<T>::astype(value).ok_or_else(|| {
                        Error::Constraint(format!(
                            "variable of type `{}`, found {}",
                            std::any::type_name::<T>(),
                            value
                        ))
                    })?);
                }
            }
        };
        return Ok(());
    }
}

impl VariableExpanding for String {
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> Result<()> {
        let output = match value {
            toml::Value::String(x) => x.clone(),
            _ => toml::to_string(value)?,
        };
        let new_value = self.replace(&format!("{}{var}{}", "{{", "}}"), &output);
        self.clear();
        self.push_str(&new_value);
        Ok(())
    }
}
