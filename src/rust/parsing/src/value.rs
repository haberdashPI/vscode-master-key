use std::any::TypeId;
use std::collections::VecDeque;
use std::error;
use std::io;
use std::io::Write;

use js_sys::Boolean;
#[allow(unused_imports)]
use log::info;

use indexmap::IndexMap;
use lazy_static::lazy_static;
use regex::Regex;
use rhai::{AST, CustomType, Engine};
use serde::{Deserialize, Serialize};
use toml::Spanned;
use toml::ser::Buffer;

use crate::error::{
    Error, ErrorContext, ErrorWithContext, ErrorsWithContext, Result, ResultVec, flatten_errors,
};
use crate::util::{Merging, Plural, Required, Resolving};

// TODO: implement Expanding type

pub enum ExpandResult {
    Expanded(Value),
    Deferred,
}

// TODO: implement Float / Integer, and deal with regularizing that
// to float64 only when we serialize to JSON (but still enforce the
// boundary on integers in the same place we do now)
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(try_from = "toml::Value")]
pub enum Value {
    Integer(i32),
    Float(f64),
    String(String),
    Boolean(bool),
    Array(Vec<Value>),
    Table(IndexMap<String, Value>),
    Interp(Vec<Value>),
    Expression(String),
}

lazy_static! {
    pub static ref EXPRESSION: Regex = Regex::new(r"\{\{(.*?)\}\}").unwrap();
}

impl TryFrom<toml::Value> for Value {
    type Error = ErrorsWithContext;
    fn try_from(value: toml::Value) -> ResultVec<Self> {
        return Ok(match value {
            toml::Value::Boolean(x) => Value::Boolean(x),
            toml::Value::Float(x) => Value::Float(x),
            toml::Value::Integer(x) => Value::Integer({
                if x > (std::f64::MAX as i64) || x < (std::f64::MIN as i64) {
                    return Err(Error::Constraint(format!(
                        "{x} cannot be expressed as a 64-bit floating point number."
                    ))
                    .into());
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

pub trait Expanding {
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        Self: Sized,
        F: Fn(String) -> Result<Value>;

    fn is_constant(&self) -> bool;
    fn require_constant(&self) -> ResultVec<()>
    where
        Self: Sized + Clone,
    {
        self.clone().map_expressions(&|e| {
            Err(Error::Unresolved(format!("Unresolved expression {e}")).into())
        })?;
        return Ok(());
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for IndexMap<String, T> {
    fn is_constant(&self) -> bool {
        self.values().all(|v| v.is_constant())
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
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
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(try_from = "toml::Value")]
pub enum TypedValue<T>
where
    T: Serialize + std::fmt::Debug,
{
    Variable(Value),
    Constant(T),
}

impl<'e, T> TryFrom<toml::Value> for TypedValue<T>
where
    T: Deserialize<'e> + Serialize + std::fmt::Debug,
{
    type Error = ErrorsWithContext;
    fn try_from(value: toml::Value) -> ResultVec<TypedValue<T>> {
        io::stdout().flush().unwrap();

        let val: Value = value.try_into()?;
        io::stdout().flush().unwrap();
        return match val.require_constant() {
            Err(_) => Ok(TypedValue::Variable(val)),
            Ok(_) => {
                let toml: toml::Value = val.into();
                let typed_value = toml.try_into();
                Ok(TypedValue::Constant(typed_value?))
            }
        };
    }
}

impl<T: Serialize + std::fmt::Debug> Expanding for TypedValue<T>
where
    T: From<TypedValue<T>>,
    T: TryFrom<toml::Value>,
{
    fn is_constant(&self) -> bool {
        match self {
            TypedValue::Constant(_) => true,
            TypedValue::Variable(_) => false,
        }
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
    {
        return Ok(match self {
            TypedValue::Variable(v) => {
                let result = v.map_expressions(f)?;
                info!("result {result:?} {}", result.is_constant());
                if result.is_constant() {
                    // TODO: WIP debugging
                    let x = TypedValue::Constant(result.try_into()?);
                    info!("to constant: {x:?}");
                    x
                } else {
                    TypedValue::Variable(result)
                }
            }
            TypedValue::Constant(x) => TypedValue::Constant(x),
        });
    }
}

impl From<TypedValue<i64>> for i64 {
    fn from(value: TypedValue<i64>) -> Self {
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

impl<T> Resolving<T> for TypedValue<T>
where
    T: Serialize + std::fmt::Debug,
    TypedValue<T>: Expanding + Clone + Into<T>,
{
    fn resolve(self, name: impl Into<String>) -> ResultVec<T> {
        self.require_constant()
            .context_str(format!("for {}", name.into()))?;
        return Ok(self.into());
    }
}

impl<T> Resolving<TypedValue<T>> for TypedValue<T>
where
    T: Serialize + std::fmt::Debug,
{
    fn resolve(self, _name: impl Into<String>) -> ResultVec<TypedValue<T>> {
        return Ok(self);
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

// expansion for other kinds of types
impl<T: Expanding> Expanding for Spanned<T> {
    fn is_constant(&self) -> bool {
        self.as_ref().is_constant()
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
    {
        let span = self.span();
        Ok(Spanned::new(
            span.clone(),
            self.into_inner().map_expressions(f).context_range(&span)?,
        ))
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for Vec<T> {
    fn is_constant(&self) -> bool {
        self.iter().all(|x| x.is_constant())
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
    {
        Ok(flatten_errors(
            self.into_iter().map(|x| x.map_expressions(f)),
        )?)
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for Plural<T> {
    fn is_constant(&self) -> bool {
        match self {
            Plural::Zero => true,
            Plural::One(x) => x.is_constant(),
            Plural::Many(xs) => xs.iter().all(|x| x.is_constant()),
        }
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
    {
        Ok(match self {
            Plural::Zero => self,
            Plural::One(x) => Plural::One(x.map_expressions(f)?),
            Plural::Many(items) => Plural::Many(items.map_expressions(f)?),
        })
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for Required<T> {
    fn is_constant(&self) -> bool {
        match self {
            Required::DefaultValue => true,
            Required::Value(x) => x.is_constant(),
        }
    }
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
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
    fn map_expressions<F>(self, f: &F) -> ResultVec<Self>
    where
        F: Fn(String) -> Result<Value>,
    {
        return Ok(match self {
            None => self,
            Some(x) => Some(x.map_expressions(f)?),
        });
    }
}
