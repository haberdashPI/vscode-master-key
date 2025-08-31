use crate::error::{Error, ErrorContext, ErrorWithContext, Result, ResultVec, flatten_errors};

use indexmap::IndexMap;
use log::info;
use serde::{Deserialize, Serialize};
use toml::{Spanned, Value};

pub trait Merging {
    fn merge(self, new: Self) -> Self;
    fn coalesce(self, new: Self) -> Self;
}

// TODO: is there any way to avoid so much copying here
impl Merging for toml::Table {
    fn merge(self, mut new: Self) -> Self {
        for (k, v) in self {
            if new.contains_key(&k) {
                new[&k] = v.merge(new[&k].clone());
            } else {
                new.insert(k, v);
            }
        }
        return new;
    }
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
}

impl<T: Merging + Clone> Merging for IndexMap<String, T> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, mut new: Self) -> Self {
        for (k, v) in self {
            if new.contains_key(&k) {
                new[&k] = v.merge(new[&k].clone());
            } else {
                new.insert(k, v);
            }
        }
        return new;
    }
}

impl<T: Merging> Merging for Spanned<T> {
    fn merge(self, new: Self) -> Self {
        return Spanned::new(self.span(), self.into_inner().merge(new.into_inner()));
    }
    fn coalesce(self, new: Self) -> Self {
        return Spanned::new(self.span(), self.into_inner().coalesce(new.into_inner()));
    }
}

impl<T: Merging> Merging for Required<T> {
    fn merge(self, new: Self) -> Self {
        return match new {
            Required::Value(newval) => match self {
                Required::Value(oldval) => Required::Value(oldval.merge(newval)),
                Required::DefaultValue => Required::Value(newval),
            },
            Required::DefaultValue => self,
        };
    }

    fn coalesce(self, new: Self) -> Self {
        return match new {
            Required::Value(_) => new,
            Required::DefaultValue => self,
        };
    }
}

impl<T: Merging> Merging for Plural<T> {
    fn merge(self, _: Self) -> Self {
        panic!("Not yet implemented (we don't yet need this function)")
    }

    fn coalesce(self, new: Self) -> Self {
        return match new {
            Plural::Zero => self,
            _ => new,
        };
    }
}

impl Merging for i64 {
    fn merge(self, new: Self) -> Self {
        return new;
    }

    fn coalesce(self, new: Self) -> Self {
        return new;
    }
}

impl Merging for bool {
    fn merge(self, new: Self) -> Self {
        return new;
    }

    fn coalesce(self, new: Self) -> Self {
        return new;
    }
}

pub trait Resolving<R> {
    fn resolve(self, name: impl Into<String>) -> ResultVec<R>;
}

pub trait Requiring<R> {
    fn require(self, name: impl Into<String>) -> Result<R>;
}

impl<T, U> Resolving<U> for Spanned<T>
where
    T: Resolving<U>,
{
    fn resolve(self, name: impl Into<String>) -> ResultVec<U> {
        let span = self.span();
        Ok(self.into_inner().resolve(name).context_range(&span)?)
    }
}

impl<T, U> Resolving<Option<U>> for Option<T>
where
    T: Resolving<U>,
{
    fn resolve(self, name: impl Into<String>) -> ResultVec<Option<U>> {
        match self {
            Some(x) => Ok(Some(x.resolve(name)?)),
            None => Ok(None),
        }
    }
}

// required values are only required at the very end of parsing, once all known defaults
// have been resolved
#[derive(Serialize, Default, Deserialize, PartialEq, Debug, Clone)]
#[serde(untagged, try_from = "Option<toml::Value>")]
pub enum Required<T> {
    #[default]
    DefaultValue,
    Value(T),
}

impl<'de, T> TryFrom<Option<toml::Value>> for Required<T>
where
    T: Deserialize<'de>,
{
    type Error = ErrorWithContext;
    fn try_from(value: Option<toml::Value>) -> Result<Self> {
        match value {
            None => Ok(Required::DefaultValue),
            Some(x) => Ok(Required::Value(toml::Value::try_into(x)?)),
        }
    }
}

impl<T, U> Resolving<U> for Required<T>
where
    T: Resolving<U>,
{
    fn resolve(self, name: impl Into<String>) -> ResultVec<U> {
        match self {
            Required::DefaultValue => Err(Error::RequiredField(name.into()))?,
            Required::Value(x) => x.resolve(name),
        }
    }
}

impl<T> Required<T> {
    pub fn unwrap(self) -> T {
        return match self {
            Required::Value(x) => x,
            Required::DefaultValue => panic!("Required value missing"),
        };
    }

    pub fn as_ref(&self) -> Required<&T> {
        match *self {
            Required::Value(ref x) => Required::Value(x),
            Required::DefaultValue => Required::DefaultValue,
        }
    }

    pub fn map<F, R>(self, f: F) -> Required<R>
    where
        F: Fn(T) -> R,
    {
        match self {
            Required::DefaultValue => Required::DefaultValue,
            Required::Value(x) => Required::Value(f(x)),
        }
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

// TODO: use `try_from` to improve error messages
#[derive(Serialize, Default, Deserialize, PartialEq, Debug, Clone)]
#[serde(untagged)]
pub enum Plural<T> {
    #[default]
    Zero,
    One(T),
    Many(Vec<T>),
}

impl<T> Plural<Spanned<T>> {
    pub fn into_inner(self) -> Plural<T> {
        return match self {
            Plural::Zero => Plural::Zero,
            Plural::One(x) => Plural::One(x.into_inner()),
            Plural::Many(xs) => Plural::Many(xs.into_iter().map(|x| x.into_inner()).collect()),
        };
    }
}

impl<T> Plural<T> {
    pub fn to_array(self) -> Vec<T> {
        return match self {
            Plural::Zero => Vec::new(),
            Plural::One(val) => vec![val],
            Plural::Many(vals) => vals,
        };
    }

    pub fn map<F, R>(self, f: F) -> Plural<R>
    where
        F: Fn(&T) -> R,
    {
        return match self {
            Plural::Zero => Plural::Zero,
            Plural::One(x) => Plural::One(f(&x)),
            Plural::Many(xs) => Plural::Many(xs.iter().map(f).collect()),
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

impl<T, U> Resolving<Vec<U>> for Plural<T>
where
    T: Resolving<U> + std::fmt::Debug,
    U: std::fmt::Debug,
{
    fn resolve(self, name: impl Into<String>) -> ResultVec<Vec<U>> {
        let vals = self.to_array();
        let name = name.into();
        Ok(flatten_errors(
            vals.into_iter().map(|x| x.resolve(name.clone())),
        )?)
    }
}

impl<T: Merging> Merging for Option<T> {
    fn merge(self, new: Self) -> Self {
        return match new {
            Some(newval) => match self {
                Some(oldval) => Some(oldval.merge(newval)),
                None => Some(newval),
            },
            None => self,
        };
    }

    fn coalesce(self, new: Self) -> Self {
        return new.or(self);
    }
}

impl Merging for String {
    fn merge(self, new: Self) -> Self {
        return new;
    }
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
}

impl Merging for toml::Value {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
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
