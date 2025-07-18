#[allow(unused_imports)]
use log::info;

use crate::util::{Plural, Required};
use toml::Value;

pub trait ForeachExpanding {
    fn expand_foreach_value(&self, var: &str, value: &str) -> Self;
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
