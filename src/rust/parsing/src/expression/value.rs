#[allow(unused_imports)]
use log::info;

use lazy_static::lazy_static;
use regex::Regex;
use rhai::Dynamic;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::io::Write;
use toml::Spanned;

use crate::err;
use crate::error::{ErrorContext, ErrorSet, Result, ResultVec, flatten_errors};
use crate::util::{LeafValue, Merging, Plural, Required, Resolving};

//
// ---------------- `Value` ----------------
//

/// `Value` is an expressive type that can be used to represent any TOML / JSON object with
/// one more expressions in them. Crucially, it implements the `Expanding` trait, which
/// allows those expressions to be expanded into `Value`'s themselves. Values are used
/// to represent parsed TOML data, expand the expressions in them, and translate
/// those values to JSON and/or Rhai `Dynaamic` objects.

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(try_from = "toml::Value")]
pub enum Value {
    Integer(i32),
    Float(f64),
    String(String),
    Boolean(bool),
    Array(Vec<Value>),
    Table(BTreeMap<String, Value>),
    Interp(Vec<Value>),
    // TODO: could optimize further by using an internned string (simplifying AST lookup)
    // TODO: include a span so that we can improve error messages
    Expression(String),
}

impl Default for Value {
    fn default() -> Self {
        return Value::Table(BTreeMap::new());
    }
}

impl From<Value> for Dynamic {
    fn from(value: Value) -> Self {
        return match value {
            Value::Float(x) => Dynamic::from(x),
            Value::Integer(x) => Dynamic::from(x),
            Value::Boolean(x) => Dynamic::from(x),
            Value::String(x) => Dynamic::from(x),
            Value::Array(x) => {
                let elements: Vec<Dynamic> = x.into_iter().map(|x| Dynamic::from(x)).collect();
                elements.into()
            }
            Value::Table(x) => {
                let map: std::collections::HashMap<String, Dynamic> =
                    x.into_iter().map(|(k, v)| (k, v.into())).collect();
                map.into()
            }
            // the from here results in an opaque custom type
            Value::Expression(x) => Dynamic::from(x),
            Value::Interp(x) => Dynamic::from(x),
        };
    }
}

impl TryFrom<Dynamic> for Value {
    type Error = crate::error::Error;
    // TODO: this is currently almost certainly quite inefficient (we clone arrays and
    // maps), but we can worry about optimizing this later
    fn try_from(value: Dynamic) -> Result<Self> {
        if value.is_array() {
            let elements = value.as_array_ref().expect("array value");
            let values = elements
                .clone()
                .into_iter()
                .map(|x| Value::try_from(x.to_owned()))
                .collect::<Result<Vec<_>>>()?;
            return Ok(Value::Array(values));
        } else if value.is_map() {
            let pairs = value.as_map_ref().expect("map value");
            let values = pairs
                .clone()
                .into_iter()
                .map(|(k, v)| Ok((k.as_str().to_string(), Value::try_from(v.to_owned())?)))
                .collect::<Result<BTreeMap<_, _>>>()?;
            return Ok(Value::Table(values));
        } else if value.is_bool() {
            return Ok(Value::Boolean(value.as_bool().expect("boolean")));
        } else if value.is_float() {
            return Ok(Value::Float(value.as_float().expect("float")));
        } else if value.is_int() {
            return Ok(Value::Integer(value.as_int().expect("integer") as i32));
        } else if value.is_string() {
            return Ok(Value::String(
                value
                    .as_immutable_string_ref()
                    .expect("string")
                    .as_str()
                    .to_string(),
            ));
        } else {
            return Err(err!("{value} cannot be interpreted as a valid TOML value"))?;
        }
    }
}

lazy_static! {
    pub static ref EXPRESSION: Regex = Regex::new(r"\{\{(.*?)\}\}").unwrap();
}

impl TryFrom<toml::Value> for Value {
    type Error = ErrorSet;
    fn try_from(value: toml::Value) -> ResultVec<Self> {
        return Ok(match value {
            toml::Value::Boolean(x) => Value::Boolean(x),
            toml::Value::Float(x) => Value::Float(x),
            toml::Value::Integer(x) => Value::Integer({
                if x > (std::f64::MAX as i64) || x < (std::f64::MIN as i64) {
                    return Err(err!(
                        "{x} cannot be expressed as a 64-bit floating point number.",
                    ))?;
                } else {
                    x.clone() as i32
                }
            }),
            toml::Value::Datetime(x) => Value::String(x.to_string()),
            toml::Value::String(x) => string_to_expression(x),
            toml::Value::Array(toml_values) => {
                let values = flatten_errors(toml_values.into_iter().map(|x| {
                    return Ok(x.try_into::<Value>()?);
                }))?;
                Value::Array(values)
            }
            toml::Value::Table(toml_kv) => {
                let kv = flatten_errors(
                    toml_kv
                        .into_iter()
                        .map(|(k, v)| Ok((k, v.try_into::<Value>()?))),
                )?;
                Value::Table(kv.into_iter().collect())
            }
        });
    }
}

fn string_to_expression(x: String) -> Value {
    let exprs = EXPRESSION.captures_iter(&x);
    // there are multiple expressions interpolated into the string
    let mut interps = Vec::new();
    let mut last_match = 0..0;
    // push rest
    for expr in exprs {
        let r = expr.get(0).expect("full match").range();
        if r.len() == x.len() {
            return Value::Expression(expr.get(1).expect("variable name").as_str().into());
        }
        if last_match.end < r.start {
            interps.push(Value::String(x[last_match.end..r.start].into()));
        }
        last_match = r;

        let var_str = expr.get(1).expect("variable name").as_str();
        interps.push(Value::Expression(var_str.into()));
    }
    if last_match.start == 0 && last_match.end == 0 {
        return Value::String(x);
    }
    if last_match.end < x.len() {
        interps.push(Value::String(x[last_match.end..].into()));
    }
    return Value::Interp(interps);
}

impl From<Value> for toml::Value {
    fn from(value: Value) -> toml::Value {
        return match value {
            Value::Expression(x) => panic!("Unresolved expression {x}"),
            Value::Interp(interps) => panic!("Unresolved interpolation {interps:?}"),
            Value::Array(items) => {
                let new_items = items.into_iter().map(|it| it.into()).collect();
                toml::Value::Array(new_items)
            }
            Value::Table(kv) => {
                let new_kv = kv.into_iter().map(|(k, v)| (k, v.into())).collect();
                toml::Value::Table(new_kv)
            }
            Value::Boolean(x) => toml::Value::Boolean(x),
            Value::Float(x) => toml::Value::Float(x),
            Value::Integer(x) => toml::Value::Integer(x as i64),
            Value::String(x) => toml::Value::String(x),
        };
    }
}

impl Merging for Value {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        match new {
            Value::Array(new_values) => match self {
                Value::Array(old_values) => {
                    let mut result = Vec::with_capacity(new_values.len().max(old_values.len()));
                    let mut new_iter = new_values.into_iter();
                    let mut old_iter = old_values.into_iter();
                    loop {
                        let new_item = new_iter.next();
                        let old_item = old_iter.next();
                        if new_item.is_none() && old_item.is_none() {
                            break;
                        }
                        result.push(old_item.merge(new_item).unwrap());
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

impl Resolving<Value> for Value {
    fn resolve(self, _name: &'static str) -> ResultVec<Value> {
        Ok(self)
    }
}

impl Resolving<toml::Value> for Value {
    fn resolve(self, name: &'static str) -> ResultVec<toml::Value> {
        self.require_constant()
            .with_message("for ")
            .with_message(name)?;
        return Ok(self.into());
    }
}

//
// ---------------- `Expanding` trait ----------------
//

/// The `Expanding` trait is used to expand expressions contained within an object
/// into `Value`s. Any type that contains one or more `Value`'s should implement `Expanding`
/// so that the `Value` can be expanded.

pub trait Expanding {
    /// `map_expressions` is used to expand expressions. On each call to the function `f`
    /// the string inside the curly braces of an expression is passed, and `f` should return
    /// a `Value`. If `f` doesn't know how to translate the given expression, it can bypass
    /// evaluation by returning a `Value::Expression` containing the passed expression.
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        Self: Sized,
        F: FnMut(String) -> Result<Value>;

    /// returns true if there are no `Value::Expression` enum variants in any contained
    /// `Value`
    fn is_constant(&self) -> bool;
    /// returns an `Err` if there are any `Value::Expression` enum variants in any
    /// contained `Value`.
    fn require_constant(&self) -> ResultVec<()>
    where
        Self: Sized + Clone,
    {
        self.clone()
            .map_expressions(&mut |e| Err(err!("Unresolved expression {e}"))?)?;
        return Ok(());
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for BTreeMap<String, T> {
    fn is_constant(&self) -> bool {
        self.values().all(|v| v.is_constant())
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        return Ok(flatten_errors(
            self.into_iter()
                .map(|(k, v)| Ok((k, v.map_expressions(f)?))),
        )?
        .into_iter()
        .collect());
    }
}

impl Expanding for Value {
    fn is_constant(&self) -> bool {
        match self {
            Value::Expression(_) => false,
            Value::Interp(_) => false,
            Value::Array(items) => items.iter().all(|it| it.is_constant()),
            Value::Table(kv) => kv.values().all(|it| it.is_constant()),
            Value::Boolean(_) | Value::Float(_) | Value::Integer(_) | Value::String(_) => true,
        }
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        // XXX: we could optimize by pruning constant branches
        return Ok(match self {
            Value::Expression(x) => f(x)?,
            Value::Interp(interps) => {
                let value: Vec<Value> = interps.map_expressions(f)?.into();
                if value.is_constant() {
                    let strs = flatten_errors(value.into_iter().map(|v| match v {
                        Value::String(x) => Ok(x),
                        obj @ _ => {
                            let toml: toml::Value = obj.into();
                            let mut result = String::new();
                            toml.serialize(toml::ser::ValueSerializer::new(&mut result))?;
                            Ok(result)
                        }
                    }))?;
                    Value::String(strs.join(""))
                } else {
                    Value::Interp(value)
                }
            }
            Value::Array(items) => Value::Array(items.map_expressions(f)?),
            Value::Table(kv) => Value::Table(kv.map_expressions(f)?),
            literal @ (Value::Boolean(_)
            | Value::Float(_)
            | Value::Integer(_)
            | Value::String(_)) => literal,
        });
    }
}

// expansion for other kinds of types
impl<T: Expanding> Expanding for Spanned<T> {
    fn is_constant(&self) -> bool {
        self.as_ref().is_constant()
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        let span = self.span();
        Ok(Spanned::new(
            span.clone(),
            self.into_inner().map_expressions(f).with_range(&span)?,
        ))
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for Vec<T> {
    fn is_constant(&self) -> bool {
        self.iter().all(|x| x.is_constant())
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        Ok(flatten_errors(
            self.into_iter().map(|x| x.map_expressions(f)),
        )?)
    }
}

impl<T: Expanding + std::fmt::Debug + Clone> Expanding for Plural<T> {
    fn is_constant(&self) -> bool {
        return self.0.is_constant();
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        return Ok(Plural(self.0.map_expressions(f)?));
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for Required<T> {
    fn is_constant(&self) -> bool {
        match self {
            Required::DefaultValue => true,
            Required::Value(x) => x.is_constant(),
        }
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        return Ok(match self {
            Required::DefaultValue => self,
            Required::Value(x) => Required::Value(x.map_expressions(f)?),
        });
    }
}

impl<T: Expanding> Expanding for Option<T> {
    fn is_constant(&self) -> bool {
        match self {
            None => true,
            Some(x) => x.is_constant(),
        }
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        return Ok(match self {
            None => self,
            Some(x) => Some(x.map_expressions(f)?),
        });
    }
}

//
// ---------------- `TypedValue` objects ----------------
//

/// A `TypedValue` wraps `Value`, requiring it to evaluate to an object that can be
/// converted into the given type `T`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(try_from = "toml::Value")]
pub enum TypedValue<T>
where
    T: Serialize + std::fmt::Debug,
{
    Variable(Value),
    Constant(T),
}

impl<T> Default for TypedValue<T>
where
    T: Default + Serialize + std::fmt::Debug,
{
    fn default() -> Self {
        return TypedValue::Constant(T::default());
    }
}

impl<'e, T> TryFrom<toml::Value> for TypedValue<T>
where
    T: Deserialize<'e> + Serialize + std::fmt::Debug,
{
    type Error = ErrorSet;
    fn try_from(value: toml::Value) -> ResultVec<TypedValue<T>> {
        io::stdout().flush().unwrap();

        let val: Value = value.try_into()?;
        return Ok(val.try_into()?);
    }
}

impl<'e, T> TryFrom<Value> for TypedValue<T>
where
    T: Deserialize<'e> + Serialize + std::fmt::Debug,
{
    type Error = ErrorSet;
    fn try_from(value: Value) -> ResultVec<TypedValue<T>> {
        io::stdout().flush().unwrap();
        return match value.require_constant() {
            Err(_) => Ok(TypedValue::Variable(value)),
            Ok(_) => {
                let toml: toml::Value = value.into();
                let typed_value = toml.try_into();
                Ok(TypedValue::Constant(typed_value?))
            }
        };
    }
}

impl<'de, T> Expanding for TypedValue<T>
where
    T: std::fmt::Debug + Deserialize<'de> + Serialize,
{
    fn is_constant(&self) -> bool {
        match self {
            TypedValue::Constant(_) => true,
            TypedValue::Variable(_) => false,
        }
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(String) -> Result<Value>,
    {
        return Ok(match self {
            TypedValue::Variable(v) => {
                let result = v.map_expressions(f)?;
                if result.is_constant() {
                    // TODO: WIP debugging
                    let toml: toml::Value = result.into();
                    let x = TypedValue::Constant(toml.try_into()?);
                    x
                } else {
                    TypedValue::Variable(result)
                }
            }
            TypedValue::Constant(x) => TypedValue::Constant(x),
        });
    }
}

impl From<TypedValue<i32>> for i32 {
    fn from(value: TypedValue<i32>) -> Self {
        return match value {
            TypedValue::Constant(x) => x,
            TypedValue::Variable(value) => panic!("Unresolved variable value: {value:?}"),
        };
    }
}

impl From<TypedValue<f64>> for f64 {
    fn from(value: TypedValue<f64>) -> Self {
        return match value {
            TypedValue::Constant(x) => x,
            TypedValue::Variable(value) => panic!("Unresolved variable value: {value:?}"),
        };
    }
}

impl From<TypedValue<String>> for String {
    fn from(value: TypedValue<String>) -> Self {
        return match value {
            TypedValue::Constant(x) => x,
            TypedValue::Variable(value) => panic!("Unresolved variable value: {value:?}"),
        };
    }
}

impl From<TypedValue<bool>> for bool {
    fn from(value: TypedValue<bool>) -> Self {
        return match value {
            TypedValue::Constant(x) => x,
            TypedValue::Variable(value) => panic!("Unresolved variable value: {value:?}"),
        };
    }
}

impl<T> From<TypedValue<Plural<T>>> for Plural<T>
where
    T: Serialize + std::fmt::Debug + Clone,
{
    fn from(value: TypedValue<Plural<T>>) -> Self {
        return match value {
            TypedValue::Constant(x) => x,
            TypedValue::Variable(value) => panic!("Unresolved variable value: {value:?}"),
        };
    }
}

impl<T> From<TypedValue<T>> for Value
where
    T: Into<toml::Value> + Serialize + std::fmt::Debug,
{
    fn from(value: TypedValue<T>) -> Self {
        return match value {
            TypedValue::Constant(x) => {
                let toml: toml::Value = x.into();
                // the reasons for failing this `try_into` should not be true of the types
                // we can use TypedValue<T> with. (We only want to be able to use
                // TypedValues for objects that can round trip serialize): this is any value
                // that can't be stored directly in JSON (e.g. a large 64-bit number).
                toml.try_into().expect("serializable value")
            }
            TypedValue::Variable(x) => x,
        };
    }
}

impl<T, U> Resolving<U> for TypedValue<T>
where
    U: LeafValue,
    T: Serialize + std::fmt::Debug + Resolving<U>,
    TypedValue<T>: Expanding + Clone + Into<T>,
{
    fn resolve(self, name: &'static str) -> ResultVec<U> {
        self.require_constant()
            .with_message("for ")
            .with_message(name)?;
        let constant = self.into();
        return constant.resolve(name);
    }
}

impl<T> Resolving<TypedValue<T>> for TypedValue<T>
where
    T: LeafValue + Serialize + std::fmt::Debug,
{
    fn resolve(self, name: &'static str) -> ResultVec<TypedValue<T>> {
        return Ok(self);
    }
}

impl<T> Resolving<TypedValue<T>> for Option<Spanned<TypedValue<T>>>
where
    T: Default + Serialize + std::fmt::Debug,
{
    fn resolve(self, _name: &'static str) -> ResultVec<TypedValue<T>> {
        return match self {
            Some(x) => Ok(x.into_inner()),
            None => Ok(TypedValue::default()),
        };
    }
}

impl<T: Serialize + std::fmt::Debug> Merging for TypedValue<T> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }

    fn merge(self, new: Self) -> Self {
        return new;
    }
}
