#[allow(unused_imports)]
use log::info;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use toml::{Spanned, Value};

use crate::err;
use crate::error::{Error, ErrorContext, Result, ResultVec, flatten_errors};
use crate::expression::Scope;

//
// ---------------- Merging ----------------
//

/// The `Merging` trait allows us to combine two versions of an object according to
/// two different approaches (`coalesce` or `merge`).
pub trait Merging {
    /// `coalesce` returns `new`, unless it is a `null`-like value, such as `None`
    /// or `Required::DefaultValue`
    fn coalesce(self, new: Self) -> Self;
    /// `merge` combines values, coalescing at the leaf values of containers, and
    /// recursively calling `merge` for any items that share a key. The returned container
    /// has all keys from self and all keys from new.
    fn merge(self, new: Self) -> Self;
}

impl Merging for toml::Table {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    // BUG!!!: we need to add the new keys that aren't in self to `pairs`
    fn merge(self, new: Self) -> Self {
        let (mut to_merge, to_append): (toml::Table, toml::Table) =
            new.into_iter().partition(|(k, _)| self.get(k).is_some());
        let pairs = self.into_iter().map(|(k, v)| match to_merge.remove(&k) {
            Some(new_v) => (k, v.merge(new_v)),
            Option::None => (k, v),
        });
        return pairs.chain(to_append.into_iter()).collect();
    }
}

impl<T: Merging + Clone> Merging for HashMap<String, T> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        let (mut to_merge, to_append): (HashMap<_, _>, HashMap<_, _>) =
            new.into_iter().partition(|(k, _)| self.get(k).is_some());
        let pairs = self.into_iter().map(|(k, v)| match to_merge.remove(&k) {
            Some(new_v) => (k, v.merge(new_v)),
            Option::None => (k, v),
        });
        return pairs.chain(to_append.into_iter()).collect();
    }
}

impl<T: Merging + Clone> Merging for IndexMap<String, T> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        let (mut to_merge, to_append): (IndexMap<_, _>, IndexMap<_, _>) =
            new.into_iter().partition(|(k, _)| self.get(k).is_some());
        let pairs = self
            .into_iter()
            .map(|(k, v)| match to_merge.shift_remove(&k) {
                Some(new_v) => (k, v.merge(new_v)),
                Option::None => (k, v),
            });
        return pairs.chain(to_append.into_iter()).collect();
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

impl<T: Merging> Merging for Plural<T>
where
    T: Clone,
{
    fn merge(self, _: Self) -> Self {
        panic!("Not yet implemented (we don't yet need this function)")
    }

    fn coalesce(self, new: Self) -> Self {
        if new.0.is_empty() {
            return self;
        } else {
            return new;
        }
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

impl<T: Merging> Merging for Option<T> {
    fn merge(self, new: Self) -> Self {
        return match new {
            Some(newval) => match self {
                Some(oldval) => Some(oldval.merge(newval)),
                Option::None => Some(newval),
            },
            Option::None => self,
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

//
// ---------------- Resolving ----------------
//

#[macro_export]
macro_rules! resolve {
    ($x:expr, $field:ident, $scope:expr) => {
        crate::util::Resolving::resolve(($x).$field, stringify!($field), $scope)
    };
}

/// `Resolving` objects implement `resolve` which removes book-keeping objects related to
/// the parsing an object (e.g. toml::Span), and returns a more ergonomic object
/// representation useful for downstream operations that don't care about these
/// book-keeping objects.
pub trait Resolving<R> {
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<R>;
}

pub(crate) trait LeafValue {}

impl LeafValue for String {}
impl LeafValue for f64 {}
impl LeafValue for i32 {}
impl LeafValue for bool {}
impl<T> LeafValue for Plural<T> where T: LeafValue + Clone {}
impl<T> LeafValue for Vec<T> where T: LeafValue + Clone {}

impl<T, U> Resolving<U> for Spanned<T>
where
    T: Resolving<U>,
{
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<U> {
        let span = self.span();
        Ok(self.into_inner().resolve(name, scope).with_range(&span)?)
    }
}

impl<T> Resolving<T> for T
where
    T: LeafValue,
{
    fn resolve(self, _name: &'static str, _scope: &mut Scope) -> ResultVec<T> {
        return Ok(self);
    }
}

impl<T, U> Resolving<U> for Option<T>
where
    T: Resolving<U>,
    U: Default + LeafValue,
{
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<U> {
        match self {
            Some(x) => x.resolve(name, scope),
            Option::None => Ok(U::default()),
        }
    }
}

impl<T, U> Resolving<Option<U>> for Option<T>
where
    T: Resolving<U>,
{
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<Option<U>> {
        match self {
            Some(x) => Ok(Some(x.resolve(name, scope)?)),
            Option::None => Ok(None),
        }
    }
}

//
// ---------------- Required values ----------------
//

/// required values represent a value that cannot be missing in a keybinding object after
/// resolving all user defined defaults.
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
    type Error = Error;
    fn try_from(value: Option<toml::Value>) -> Result<Self> {
        match value {
            Option::None => Ok(Required::DefaultValue),
            Some(x) => Ok(Required::Value(toml::Value::try_into(x)?)),
        }
    }
}

impl<T, U> Resolving<U> for Required<T>
where
    T: Resolving<U>,
{
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<U> {
        match self {
            Required::DefaultValue => Err(err!("`{name}` field is required"))?,
            Required::Value(x) => x.resolve(name, scope),
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

//
// ---------------- Plural values ----------------
//

#[derive(Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum RawPlural<T> {
    Zero,
    One(T),
    Many(Vec<T>),
}

// TODO: use `try_from` to improve error messages
#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[serde(from = "RawPlural<T>", into = "Vec<T>")]
pub struct Plural<T>(pub(crate) Vec<T>)
where
    T: Clone;

impl<T> From<RawPlural<T>> for Plural<T>
where
    T: Clone,
{
    fn from(values: RawPlural<T>) -> Self {
        return match values {
            RawPlural::Zero => Plural(vec![]),
            RawPlural::One(x) => Plural(vec![x]),
            RawPlural::Many(xs) => Plural(xs),
        };
    }
}

impl<T> From<Plural<T>> for Vec<T>
where
    T: Clone,
{
    fn from(value: Plural<T>) -> Self {
        return value.0;
    }
}

impl<T> Default for Plural<T>
where
    T: Clone,
{
    fn default() -> Self {
        return Plural(vec![]);
    }
}

impl<T, U> Resolving<Vec<U>> for Plural<T>
where
    T: Clone + Resolving<U> + std::fmt::Debug,
    U: std::fmt::Debug,
{
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<Vec<U>> {
        Ok(flatten_errors(
            self.0.into_iter().map(|x| x.resolve(name, scope)),
        )?)
    }
}
