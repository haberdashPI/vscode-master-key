#[allow(unused_imports)]
use log::info;

use core::ops::Range;
use indexmap::IndexMap;
use lazy_static::lazy_static;
use regex::Regex;
use rhai::Dynamic;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use smallvec::smallvec;
use std::collections::HashMap;
use std::io::Write;
use toml::Spanned;

use crate::bind::UNKNOWN_RANGE;
use crate::err;
use crate::error::{ErrorContext, ErrorSet, ParseError, Result, ResultVec, err, flatten_errors};
use crate::expression::Scope;
use crate::util::{LeafValue, Merging, Plural, Required, Resolving};

//
// ================ Value ================
//

/// `Value` is an expressive type that can be used to represent any TOML / JSON object with
/// one or more expressions in them. Crucially, it implements the `Expanding` trait, which
/// allows those expressions to be expanded into `Value`'s themselves. Values are used
/// to represent parsed TOML data, expand the expressions in them, and translate
/// those values to JSON and/or Rhai `Dynaamic` objects.

#[derive(Serialize, Debug, Clone)]
pub enum Value {
    Integer(i32),
    Float(f64),
    String(String),
    Boolean(bool),
    Array(Vec<Value>),
    Table(
        HashMap<String, Value>,
        Option<HashMap<String, Range<usize>>>,
    ),
    Interp(Vec<Value>),
    Exp(Expression),
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        return match (self, other) {
            (Value::Integer(x), Value::Integer(y)) => x == y,
            (Value::Float(x), Value::Float(y)) => x == y,
            (Value::String(x), Value::String(y)) => x == y,
            (Value::Boolean(x), Value::Boolean(y)) => x == y,
            (Value::Array(x), Value::Array(y)) => x == y,
            (Value::Table(x, _), Value::Table(y, _)) => x == y,
            (Value::Interp(x), Value::Interp(y)) => x == y,
            (Value::Exp(x), Value::Exp(y)) => x == y,
            _ => false,
        };
    }
}

//
// ---------------- Value: Expressions ----------------
//

/// Expression's within a value are composed of both the expression code but also a span
/// (usually) indicating where the expression is located in a source file and a scope, which
/// describes any locally resolved values, such as from the `foreach` field of `[[bind]]`
#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct Expression {
    // we just hold the string content of the expression. `parse_asts` is used to generate
    // and store the abstract syntax tree of each expression
    pub content: String,
    // parsing-time error that we want to report after deserializing
    #[serde(skip)]
    pub error: Option<ParseError>,
    // where was the expression defined in the file?
    pub span: Range<usize>,
    // any local scope that should be applied to the expression when it's evaluated (used by
    // `foreach`)
    pub scope: SmallVec<[(String, BareValue); 8]>,
}

impl std::fmt::Display for Expression {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::result::Result<(), std::fmt::Error> {
        write!(fmt, "{}", "{{")?;
        self.content.fmt(fmt)?;
        write!(fmt, "{}", "}}")?;
        return Ok(());
    }
}

impl PartialEq for Expression {
    fn eq(&self, other: &Self) -> bool {
        if self.content != other.content {
            return false;
        }
        // TODO: make this more efficient?
        let self_scope: HashMap<_, _> = self.scope.clone().into_iter().collect();
        let other_scope: HashMap<_, _> = other.scope.clone().into_iter().collect();
        return self_scope == other_scope;
    }
}

//
// ---------------- Value: Deserialization ----------------
//

// deserialization is a bit involved for `Value` because we want to be able to capture the
// `span` where each expression was defined. This is passed to `deserialize` methods when
// inside a `Table` object, and so we need to capture this information from there.

impl<'de> Deserialize<'de> for Value {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let bare_value = BareValue::deserialize(deserializer)?;
        match Value::new(bare_value, None) {
            // TODO: could improve error handling here once we have a proper
            // error type for the kinds of errors we expect to show here
            Err(e) => Err(serde::de::Error::custom(e.to_string())),
            Ok(x) => Ok(x),
        }
    }
}

// BareValue simple captures everything a normal TOML value does + the span of
// each value in a `Table`
#[derive(Serialize, Debug, Clone, PartialEq)]
pub enum BareValue {
    Integer(i32),
    Float(f64),
    String(String),
    Datetime(toml::value::Datetime),
    Boolean(bool),
    Array(Vec<BareValue>),
    Table(HashMap<String, Spanned<BareValue>>),
}

// Manual implementation of `Deserialize` is required here to capture `Spanned` within
// `Table` values. Note: `toml` has a limitation that it cannot have `Spanned` `Array`
// values in a dynamic type like `BareValue`. To work around this limitation we would
// probably need to use a different deserialization approach that did not use `serde`
// directly. Instead we simply accept that error messages for expressions will be less
// precise when they occur as a direct child of an array (this is somewhat rare anyways)
impl<'de> serde::de::Deserialize<'de> for BareValue {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::de::Deserializer<'de>,
    {
        struct ValueVisitor;

        impl<'de> serde::de::Visitor<'de> for ValueVisitor {
            type Value = BareValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("any valid TOML value")
            }

            fn visit_bool<E>(self, value: bool) -> std::result::Result<BareValue, E> {
                Ok(BareValue::Boolean(value))
            }

            fn visit_i64<E: serde::de::Error>(
                self,
                value: i64,
            ) -> std::result::Result<BareValue, E> {
                if i32::try_from(value).is_ok() {
                    Ok(BareValue::Integer(value as i32))
                } else {
                    Err(serde::de::Error::custom(
                        "i64 value was too large (must fit in i32)",
                    ))
                }
            }

            fn visit_u64<E: serde::de::Error>(
                self,
                value: u64,
            ) -> std::result::Result<BareValue, E> {
                if i32::try_from(value).is_ok() {
                    Ok(BareValue::Integer(value as i32))
                } else {
                    Err(serde::de::Error::custom(
                        "u64 value was too large (must fit in i32",
                    ))
                }
            }

            fn visit_u32<E: serde::de::Error>(
                self,
                value: u32,
            ) -> std::result::Result<BareValue, E> {
                if i32::try_from(value).is_ok() {
                    Ok(BareValue::Integer(value as i32))
                } else {
                    Err(serde::de::Error::custom(
                        "u32 value was too large (must fit in i32)",
                    ))
                }
            }

            fn visit_i32<E>(self, value: i32) -> std::result::Result<BareValue, E> {
                Ok(BareValue::Integer(value.into()))
            }

            fn visit_f64<E>(self, value: f64) -> std::result::Result<BareValue, E> {
                Ok(BareValue::Float(value))
            }

            fn visit_str<E>(self, value: &str) -> std::result::Result<BareValue, E> {
                Ok(BareValue::String(value.into()))
            }

            fn visit_string<E>(self, value: String) -> std::result::Result<BareValue, E> {
                Ok(BareValue::String(value))
            }

            fn visit_some<D>(self, deserializer: D) -> std::result::Result<BareValue, D::Error>
            where
                D: serde::de::Deserializer<'de>,
            {
                serde::de::Deserialize::deserialize(deserializer)
            }

            fn visit_seq<V>(self, mut visitor: V) -> std::result::Result<BareValue, V::Error>
            where
                V: serde::de::SeqAccess<'de>,
            {
                let mut vec = Vec::new();
                while let Some(elem) = visitor.next_element()? {
                    vec.push(elem);
                }
                Ok(BareValue::Array(vec))
            }

            fn visit_map<V>(self, mut visitor: V) -> std::result::Result<BareValue, V::Error>
            where
                V: serde::de::MapAccess<'de>,
            {
                let key = match toml_datetime::de::VisitMap::next_key_seed(&mut visitor)? {
                    Some(toml_datetime::de::VisitMap::Datetime(datetime)) => {
                        return Ok(BareValue::Datetime(datetime));
                    }
                    Option::None => return Ok(BareValue::Table(HashMap::new())),
                    Some(toml_datetime::de::VisitMap::Key(key)) => key,
                };
                let mut map = HashMap::new();
                map.insert(key.into_owned(), visitor.next_value()?);
                while let Some(key) = visitor.next_key::<String>()? {
                    match map.entry(key) {
                        std::collections::hash_map::Entry::Vacant(vacant) => {
                            vacant.insert(visitor.next_value()?);
                        }
                        std::collections::hash_map::Entry::Occupied(occupied) => {
                            let msg = format!("duplicate key: `{}`", occupied.key());
                            return Err(serde::de::Error::custom(msg));
                        }
                    }
                }
                Ok(BareValue::Table(map))
            }
        }

        deserializer.deserialize_any(ValueVisitor)
    }
}

lazy_static! {
    pub static ref EXPRESSION: Regex = Regex::new(r"\{\{((.|\r|\n)*?)\}\}").unwrap();
}

// construct the actual value (which contains expressions) from a `BareValue`; this is where
// each string is parsed to find expressions
impl Value {
    // `range` is passed on to a child `Value` when the range is known
    // (directly inside a `Table`)
    pub fn new(value: BareValue, range: Option<Range<usize>>) -> Result<Self> {
        return Ok(match value {
            BareValue::Boolean(x) => Value::Boolean(x),
            BareValue::Float(x) => Value::Float(x),
            BareValue::Integer(x) => Value::Integer(x),
            BareValue::Datetime(x) => Value::String(x.to_string()),
            BareValue::String(x) => string_to_expression(x, range)?,
            BareValue::Array(toml_values) => {
                let values = toml_values.into_iter().map(|x| {
                    return Ok(Value::new(x, None)?);
                });
                Value::Array(values.collect::<Result<_>>()?)
            }
            BareValue::Table(toml_kv) => {
                let k_span = toml_kv
                    .iter()
                    .map(|(k, v)| (k.clone(), v.span().clone()))
                    .collect();
                let kv = toml_kv.into_iter().map(|(k, v)| {
                    let span = v.span();
                    return Ok((k, Value::new(v.into_inner(), Some(span))?));
                });
                Value::Table(kv.collect::<Result<_>>()?, Some(k_span))
            }
        });
    }
}

// given a match of an expression regex (`{{.*}}` in simplified form), convert the current
// match to a `Value::Expression` or flag an error. This is one place where we check that
// there aren't unexpected `{{` or `}}` character sequences in a string
fn match_to_expression(maybe_parent_span: &Option<Range<usize>>, m: regex::Match) -> Result<Value> {
    if let Some(parent_span) = maybe_parent_span {
        let r = m.range();
        let exp_span = (parent_span.start + r.start)..(parent_span.start + r.end + 1);
        let content: String = m.as_str().into();
        let mut error = None;
        if content.contains("{{") {
            error = Some(ParseError {
                error: err("unexpected `{{`"),
                contexts: smallvec![crate::error::Context::Range(exp_span.clone())],
                level: crate::error::ErrorLevel::Error,
            });
        }
        return Ok(Value::Exp(Expression {
            content,
            span: exp_span,
            error,
            scope: SmallVec::new(),
        }));
    } else {
        let content: String = m.as_str().into();
        let mut error = None;
        if content.contains("{{") {
            error = Some(ParseError {
                error: err("unexpected `{{`"),
                contexts: smallvec![],
                level: crate::error::ErrorLevel::Error,
            });
        }
        return Ok(Value::Exp(Expression {
            content,
            span: UNKNOWN_RANGE,
            error,
            scope: SmallVec::new(),
        }));
    }
}

// check the rust of a string for unmatched `{{` and `}}` sequences
fn check_unmatched_braces(x: String, span: Option<Range<usize>>) -> Value {
    if x.contains("{{") {
        let mut error: ParseError = err("unexpected `{{`").into();
        if let Some(r) = span.clone() {
            error.contexts.push(crate::error::Context::Range(r));
        };
        return Value::Exp(Expression {
            content: x,
            error: Some(error),
            span: span.unwrap_or_else(|| UNKNOWN_RANGE),
            scope: SmallVec::new(),
        });
    } else if x.contains("}}") {
        let mut error: ParseError = err("unexpected `}}`").into();
        if let Some(r) = span.clone() {
            error.contexts.push(crate::error::Context::Range(r.clone()));
        };
        return Value::Exp(Expression {
            content: x,
            span: span.unwrap_or_else(|| UNKNOWN_RANGE),
            error: Some(error),
            scope: SmallVec::new(),
        });
    }
    return Value::String(x);
}

// scan through a string and find all expressions; converting to either an interpolated
// value (array of string and expression `Value`s) or a single expression
fn string_to_expression(x: String, span: Option<Range<usize>>) -> Result<Value> {
    let exprs = EXPRESSION.captures_iter(&x);
    // there can be multiple expressions interpolated into the string
    let mut interps = Vec::new();
    // NOTE: rust-analyzer sometimes raises some spurious errors here because it infers the
    // wrong type even though its explicitly set ???
    let mut last_match: std::ops::Range<usize> = 0..0;
    // push rest
    for expr in exprs {
        let r: std::ops::Range<usize> = expr.get(0).expect("full match").range();
        if r.len() == x.len() {
            return match_to_expression(&span, expr.get(1).expect("variable name"));
        }
        if last_match.end < r.start {
            interps.push(Value::String(x[last_match.end..r.start].into()));
        }
        last_match = r;

        interps.push(match_to_expression(
            &span,
            expr.get(1).expect("variable name"),
        )?);
    }
    if last_match.start == 0 && last_match.end == 0 {
        return Ok(check_unmatched_braces(x, span));
    }
    if last_match.end < x.len() {
        interps.push(check_unmatched_braces(x[last_match.end..].into(), span));
    }
    return Ok(Value::Interp(interps));
}

// convert a sequence of `Value::String` and `Value::Expression` to the original string that
// it this interpolation would have been parsed from; used for generating error messages
fn interp_to_string(interps: Vec<Value>) -> String {
    let mut result = String::new();
    for v in interps {
        match v {
            Value::String(x) => result.push_str(&x),
            Value::Exp(Expression { content: x, .. }) => {
                result.push_str(&format!("{}{x}{}", "{{", "}}"));
            }
            other @ _ => {
                let toml: toml::Value = other.into();
                let mut other_str = String::new();
                match toml.serialize(toml::ser::ValueSerializer::new(&mut other_str)) {
                    Err(_) => result.push_str("<!err!>"),
                    Ok(_) => (),
                };
                result.push_str(&other_str)
            }
        }
    }
    return result;
}

//
// ---------------- Value: Conversion ----------------
//

// BareValue::new(:toml::Value) - in some cases we process `toml::Value` as BareValue; in
// this case there is no known span for the expressions

// note that this code is only covered by KeyFileResult which is run during integration
// tests
#[cfg_attr(coverage_nightly, coverage(off))]
impl BareValue {
    pub(crate) fn new(value: toml::Value) -> ResultVec<Self> {
        return Ok(match value {
            toml::Value::Boolean(x) => BareValue::Boolean(x),
            toml::Value::Float(x) => BareValue::Float(x),
            toml::Value::Integer(x) => BareValue::Integer({
                if i32::try_from(x).is_ok() {
                    x as i32
                } else {
                    Err(err("i64 value was too large (must fit in i32)"))?;
                    0
                }
            }),
            toml::Value::Datetime(x) => BareValue::String(x.to_string()),
            toml::Value::String(x) => BareValue::String(x),
            toml::Value::Array(toml_values) => {
                let values = flatten_errors(toml_values.into_iter().map(|x| {
                    return Ok(BareValue::new(x)?);
                }))?;
                BareValue::Array(values)
            }
            toml::Value::Table(toml_kv) => {
                let kv = flatten_errors(
                    toml_kv
                        .into_iter()
                        .map(|(k, v)| Ok((k, Spanned::new(UNKNOWN_RANGE, BareValue::new(v)?)))),
                )?;
                BareValue::Table(kv.into_iter().collect())
            }
        });
    }
}

impl From<Value> for BareValue {
    fn from(value: Value) -> BareValue {
        return match value {
            Value::Exp(Expression { content: x, .. }) => panic!("Unresolved expression {x}"),
            Value::Interp(interps) => {
                panic!("Unresolved interpolation {}", interp_to_string(interps))
            }
            Value::Array(items) => {
                let new_items = items.into_iter().map(|it| it.into()).collect();
                BareValue::Array(new_items)
            }
            Value::Table(kv, Some(k_spans)) => {
                let new_kv = kv
                    .into_iter()
                    .map(|(k, v)| {
                        let span = k_spans[&k].clone();
                        return (k, Spanned::new(span, v.into()));
                    })
                    .collect();
                BareValue::Table(new_kv)
            }
            Value::Table(kv, Option::None) => {
                let new_kv = kv
                    .into_iter()
                    .map(|(k, v)| (k, Spanned::new(UNKNOWN_RANGE, v.into())))
                    .collect();
                BareValue::Table(new_kv)
            }
            Value::Boolean(x) => BareValue::Boolean(x),
            Value::Float(x) => BareValue::Float(x),
            Value::Integer(x) => BareValue::Integer(x),
            Value::String(x) => BareValue::String(x),
        };
    }
}

impl From<Value> for toml::Value {
    fn from(value: Value) -> toml::Value {
        return match value {
            Value::Exp(Expression { content: x, .. }) => panic!("Unresolved expression {x}"),
            Value::Interp(interps) => {
                panic!("Unresolved interpolation {}", interp_to_string(interps))
            }
            Value::Array(items) => {
                let new_items = items.into_iter().map(|it| it.into()).collect();
                toml::Value::Array(new_items)
            }
            Value::Table(kv, _) => {
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

impl From<Value> for rhai::Dynamic {
    fn from(value: Value) -> Self {
        return match value {
            Value::Float(x) => Dynamic::from(x),
            Value::Integer(x) => Dynamic::from(x as i64),
            Value::Boolean(x) => Dynamic::from(x),
            Value::String(x) => Dynamic::from(x),
            Value::Array(x) => {
                let elements: Vec<Dynamic> = x.into_iter().map(|x| Dynamic::from(x)).collect();
                elements.into()
            }
            Value::Table(x, _) => {
                let map: std::collections::HashMap<String, Dynamic> =
                    x.into_iter().map(|(k, v)| (k, v.into())).collect();
                map.into()
            }
            // the from here results in an opaque custom type
            val @ Value::Exp(_) => Dynamic::from(val),
            val @ Value::Interp(..) => Dynamic::from(val),
        };
    }
}

impl TryFrom<Dynamic> for Value {
    type Error = crate::error::ParseError;
    // TODO: this is currently almost certainly quite inefficient (we clone arrays and
    // maps), but we can worry about optimizing this later
    fn try_from(value: Dynamic) -> Result<Self> {
        if value.is::<Value>() {
            return Ok(value.cast::<Value>());
        } else if value.is_array() {
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
                .collect::<Result<HashMap<_, _>>>()?;
            return Ok(Value::Table(values, None));
        } else if value.is_bool() {
            return Ok(Value::Boolean(value.as_bool().expect("boolean")));
        } else if value.is_float() {
            return Ok(Value::Float(value.as_float().expect("float")));
        } else if value.is_int() {
            return Ok(Value::Integer(i32::try_from(
                value.as_int().expect("integer"),
            )?));
        } else if value.is::<i32>() {
            return Ok(Value::Integer(value.cast::<i32>()));
        } else if value.is::<usize>() {
            let x: usize = value.cast();
            if x > i32::MAX as usize {
                return Err(err!("{x} is to large to be interpreted as an `i32`"))?;
            }
            return Ok(Value::Integer(x as i32));
        } else if value.is_string() {
            return Ok(Value::String(
                value
                    .as_immutable_string_ref()
                    .expect("string")
                    .as_str()
                    .to_string(),
            ));
        } else {
            return Err(err!(
                "`{value}` of type `{}` cannot be interpreted as a valid TOML value",
                value.type_name()
            ))?;
        }
    }
}

//
// ---------------- Value: Traits ----------------
//

impl Default for Value {
    fn default() -> Self {
        return Value::Table(HashMap::new(), None);
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
            Value::Table(new_kv, new_spans) => match self {
                Value::Table(old_kv, old_spans) => {
                    Value::Table(old_kv.merge(new_kv), old_spans.merge(new_spans))
                }
                _ => Value::Table(new_kv, new_spans),
            },
            _ => new,
        }
    }
}

impl Resolving<Value> for Value {
    fn resolve(self, _name: &'static str, _scope: &mut Scope) -> ResultVec<Value> {
        Ok(self)
    }
}

impl Resolving<toml::Value> for Value {
    fn resolve(mut self, name: &'static str, scope: &mut Scope) -> ResultVec<toml::Value> {
        self = scope.expand(&self)?;
        self.require_constant()
            .with_message(format!(" for {}", name))?;
        return Ok(self.into());
    }
}

//
// ================ `Expanding` trait ================
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
        F: FnMut(Expression) -> Result<Value>;

    /// returns true if there are no `Value::Expression` enum variants in any contained
    /// `Value`
    fn is_constant(&self) -> bool;
    /// returns an `Err` if there are any `Value::Expression` enum variants in any
    /// contained `Value`.
    fn require_constant(&self) -> ResultVec<()>
    where
        Self: Sized + Clone,
    {
        self.clone().map_expressions(&mut |e| {
            Err(err!("Unresolved expression {e}")).with_range(&e.span)?
        })?;
        return Ok(());
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for HashMap<String, T> {
    fn is_constant(&self) -> bool {
        self.values().all(|v| v.is_constant())
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(Expression) -> Result<Value>,
    {
        return Ok(flatten_errors(
            self.into_iter()
                .map(|(k, v)| Ok((k, v.map_expressions(f)?))),
        )?
        .into_iter()
        .collect());
    }
}

impl<T: Expanding + std::fmt::Debug> Expanding for IndexMap<String, T> {
    fn is_constant(&self) -> bool {
        self.values().all(|v| v.is_constant())
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(Expression) -> Result<Value>,
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
            Value::Exp(Expression { .. }) => false,
            Value::Interp(_) => false,
            Value::Array(items) => items.iter().all(|it| it.is_constant()),
            Value::Table(kv, _) => kv.values().all(|it| it.is_constant()),
            Value::Boolean(_) | Value::Float(_) | Value::Integer(_) | Value::String(_) => true,
        }
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(Expression) -> Result<Value>,
    {
        return Ok(match self {
            Value::Exp(x) => f(x)?,
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
            Value::Table(kv, Some(spans)) => {
                let kv = flatten_errors(kv.into_iter().map(|(k, v)| {
                    let span = spans[&k].clone();
                    return Ok((k, v.map_expressions(f).with_range(&span)?));
                }))?
                .into_iter()
                .collect();
                Value::Table(kv, Some(spans))
            }
            Value::Table(kv, Option::None) => Value::Table(kv.map_expressions(f)?, None),
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
        F: FnMut(Expression) -> Result<Value>,
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
        F: FnMut(Expression) -> Result<Value>,
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
        F: FnMut(Expression) -> Result<Value>,
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
        F: FnMut(Expression) -> Result<Value>,
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
            Option::None => true,
            Some(x) => x.is_constant(),
        }
    }
    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        F: FnMut(Expression) -> Result<Value>,
    {
        return Ok(match self {
            Option::None => self,
            Some(x) => Some(x.map_expressions(f)?),
        });
    }
}

//
// ================ `TypedValue` objects ================
//

/// A `TypedValue` wraps `Value`, requiring it to evaluate to an object that can be
/// converted into the given type `T`, returning an `Err` otherwise.
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
        std::io::stdout().flush().unwrap();

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
        std::io::stdout().flush().unwrap();
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
        F: FnMut(Expression) -> Result<Value>,
    {
        return Ok(match self {
            TypedValue::Variable(v) => {
                let result = v.map_expressions(f)?;
                if result.is_constant() {
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
    fn resolve(mut self, name: &'static str, scope: &mut Scope) -> ResultVec<U> {
        self = scope.expand(&self)?;
        self.require_constant()
            .with_message(format!("for `{name}`"))?;
        let constant = self.into();
        return constant.resolve(name, scope);
    }
}

impl<T> Resolving<TypedValue<T>> for TypedValue<T>
where
    T: LeafValue + Serialize + std::fmt::Debug,
{
    fn resolve(self, _name: &'static str, _scope: &mut Scope) -> ResultVec<TypedValue<T>> {
        return Ok(self);
    }
}

impl<T> Resolving<TypedValue<T>> for Option<Spanned<TypedValue<T>>>
where
    T: Default + Serialize + std::fmt::Debug,
{
    fn resolve(self, _name: &'static str, _scope: &mut Scope) -> ResultVec<TypedValue<T>> {
        return match self {
            Some(x) => Ok(x.into_inner()),
            Option::None => Ok(TypedValue::default()),
        };
    }
}

pub(crate) trait IsEmpty {
    fn is_empty(&self) -> bool;
}
impl<T: Clone> IsEmpty for Plural<T> {
    fn is_empty(&self) -> bool {
        return self.0.is_empty();
    }
}
impl<T: Clone> IsEmpty for Vec<T> {
    fn is_empty(&self) -> bool {
        return self.is_empty();
    }
}
impl IsEmpty for String {
    fn is_empty(&self) -> bool {
        return self.is_empty();
    }
}

impl<T: Serialize + std::fmt::Debug + IsEmpty> Merging for TypedValue<T> {
    fn coalesce(self, new: Self) -> Self {
        if let TypedValue::Constant(c) = &new
            && IsEmpty::is_empty(c)
        {
            return self;
        } else {
            return new;
        }
    }

    fn merge(self, new: Self) -> Self {
        return self.coalesce(new);
    }
}

// this code is only covered by KeyFileResult which is run during integration tests
#[cfg_attr(coverage_nightly, coverage(off))]
impl Merging for TypedValue<bool> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        return new;
    }
}

// this code is only covered by KeyFileResult which is run during integration tests
#[cfg_attr(coverage_nightly, coverage(off))]
impl Merging for TypedValue<i32> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        return new;
    }
}

// this code is only covered by KeyFileResult which is run during integration tests
#[cfg_attr(coverage_nightly, coverage(off))]
impl Merging for TypedValue<f64> {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        return new;
    }
}

mod tests {
    use test_log::test;

    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn parse_datetime() {
        let data = r#"
        joe = 1979-05-27T07:32:00Z
        "#;
        let value: std::result::Result<Value, _> = toml::from_str(data);
        assert!(value.is_ok());
    }

    #[test]
    fn parse_large_number() {
        let data = r#"
        number = 5_000_000_000
        "#;
        let err: std::result::Result<Value, _> = toml::from_str(data);
        assert!(
            err.unwrap_err()
                .to_string()
                .contains("i64 value was too large")
        );
    }

    #[test]
    fn parse_duplicate_key() {
        let data = r#"
        a = 1
        b = 2
        a = 3
        "#;
        let err: std::result::Result<Value, _> = toml::from_str(data);
        assert!(err.unwrap_err().to_string().contains("duplicate key"));
    }

    #[test]
    #[should_panic]
    fn unresolved_expression_panics() {
        let data = r#"
        value = '{{1+2}}'
        "#;
        let value: std::result::Result<Value, _> = toml::from_str(data);
        match value {
            Ok(x) => BareValue::from(x),
            Err(_) => return,
        };
    }

    #[test]
    #[should_panic]
    fn unresolved_interp_panics() {
        let data = r#"
        value = 'joe {{1+2}} bob'
        "#;
        let value: std::result::Result<Value, _> = toml::from_str(data);
        match value {
            Ok(x) => BareValue::from(x),
            Err(_) => return,
        };
    }

    #[test]
    #[should_panic]
    fn unresolved_expression_to_toml_panics() {
        let data = r#"
        value = '{{1+2}}'
        "#;
        let value: std::result::Result<Value, _> = toml::from_str(data);
        match value {
            Ok(x) => toml::Value::from(x),
            Err(_) => return,
        };
    }

    #[test]
    #[should_panic]
    fn unresolved_interp_to_toml_panics() {
        let data = r#"
        value = 'joe {{1+2}} bob'
        "#;
        let value: std::result::Result<Value, _> = toml::from_str(data);
        match value {
            Ok(x) => toml::Value::from(x),
            Err(_) => return,
        };
    }
}
