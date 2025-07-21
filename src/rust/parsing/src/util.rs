use crate::error::{Error, Result};

use log::info;
use serde::{Deserialize, Serialize};
use toml::Value;

pub trait Merging {
    fn merge(self, new: Self) -> Self;
}
pub trait Requiring<R> {
    fn require(self, name: &'static str) -> Result<R>;
}

// TODO: is there any way to avoid so much copying here
impl Merging for toml::Table {
    fn merge(self, new: Self) -> Self {
        let mut result = new.clone();
        for (k, v) in self {
            if new.contains_key(&k) {
                result[&k] = v.merge(result[&k].clone());
            } else {
                result.insert(k, v);
            }
        }
        return result;
    }
}

impl<T> Requiring<Option<T>> for Option<T> {
    fn require(self, _: &str) -> Result<Self> {
        return Ok(self);
    }
}

// required values are only required at the very end of parsing, once all known defaults
// have been resolved
#[derive(Default, Deserialize, Serialize, PartialEq, Debug, Clone)]
#[serde(untagged)]
pub enum Required<T> {
    #[default]
    DefaultValue,
    Value(T),
}

impl<T> Requiring<T> for Required<T> {
    fn require(self, name: &'static str) -> Result<T> {
        return match self {
            Required::DefaultValue => Err(Error::RequiredField(name).into()),
            Required::Value(val) => Ok(val),
        };
    }
}

impl<T> Required<T> {
    pub fn unwrap(self) -> T {
        return match self {
            Required::Value(x) => x,
            Required::DefaultValue => panic!("Required value missing"),
        };
    }

    pub fn or(self, new: Self) -> Self {
        return match new {
            Required::Value(new_val) => match self {
                Required::DefaultValue => Required::Value(new_val),
                _ => self,
            },
            Required::DefaultValue => self,
        };
    }
}

#[derive(Default, Deserialize, PartialEq, Debug, Clone)]
#[serde(untagged)]
pub enum Plural<T> {
    #[default]
    Zero,
    One(T),
    Many(Vec<T>),
}

impl Plural<String> {
    pub fn to_array(self) -> Vec<String> {
        return match self {
            Plural::Zero => Vec::new(),
            Plural::One(val) => vec![val],
            Plural::Many(vals) => vals,
        };
    }
}

impl<T: Clone> Plural<T> {
    pub fn or(self, default: Plural<T>) -> Plural<T> {
        return match self {
            Plural::Zero => default,
            _ => self,
        };
    }
}

impl<T: Merging> Merging for Option<T> {
    fn merge(self, new: Self) -> Self {
        info!("Merging `Option`");
        return match new {
            Some(x) => match self {
                Some(y) => Some(y.merge(x)),
                None => Some(x),
            },
            None => self,
        };
    }
}

impl Merging for String {
    fn merge(self, _: Self) -> Self {
        return self;
    }
}

impl Merging for toml::Value {
    fn merge(self, new: Self) -> Self {
        match new {
            Value::Array(new_values) => match self {
                Value::Array(old_values) => {
                    let mut result = Vec::with_capacity(new_values.len().max(old_values.len()));
                    let mut new_iter = new_values.iter();
                    let mut old_iter = old_values.iter();
                    loop {
                        let new_item = new_iter.next();
                        let old_item = old_iter.next();
                        if let Some(new_val) = new_item {
                            if let Some(old_val) = old_item {
                                result.push(old_val.clone().merge(new_val.clone()));
                            } else {
                                result.push(new_val.clone());
                            }
                        } else if let Some(old_val) = old_item {
                            result.push(old_val.clone());
                        } else {
                            break;
                        }
                    }
                    Value::Array(result)
                }
                _ => Value::Array(new_values),
            },
            Value::Table(new_kv) => match self {
                Value::Table(old_kv) => Value::Table(old_kv.merge(new_kv)),
                _ => Value::Table(new_kv),
            },
            _ => new,
        }
    }
}
