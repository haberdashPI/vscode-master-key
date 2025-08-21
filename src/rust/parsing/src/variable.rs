use std::error;

use crate::error::{Error, ErrorContexts, ErrorWithContext, Result, ResultVec};
use crate::util::{Merging, Plural, Required, Resolving};

use js_sys::Boolean;
#[allow(unused_imports)]
use log::info;

use lazy_static::lazy_static;
use regex::Regex;
use rhai::{CustomType, Engine, AST};
use serde::{Deserialize, Serialize};
use toml::Spanned;

// TODO: implement Expanding type

pub enum ExpandResult {
    Expanded(Value),
    Deferred,
}

pub enum Interp {
    Constant(String),
    Expression(Expression),
}

pub enum Value {
    Number(f64),
    String(String),
    Boolean(bool),
    Array(Vec<Value>),
    Table(IndexMap<String, Value>),
    Interp(Vec<Interp>),
    Expression(Expression),
}

pub enum Expression {
    Variable(String),
    Statement(String),
}

lazy_static! {
    pub static ref IDENTIFIER_CHAIN: Regex = Regex::new(r"((\s*[\w--\d]\w*\.)*[\w--\d]\w*)\s*\}\}").unwrap();
    pub static ref EXPRESSION: Regex = Regex::new(r"\{\{(.*)\}\}").unwrap();
}

impl TryFrom<toml::Value> for Value {
    type Error = Vec<ErrorWithContext>;
    fn try_from(value: toml::Value) -> ResultVec<Self> {
        return Ok(match value {
            toml::Value::Boolean(x) => Value::Boolean(x),
            toml::Value::Float(x) => Value::Number(x),
            toml::Value::Integer(x) => Value::Number(x.try_into().context("{x} cannot be expressed as a 64-bit floating-point number.")?),
            toml::Value::Datetime(x) => Value::String(x.into()),
            toml::Value::String(x) => string_to_expression(x)?,
            toml::Value::Array(toml_values) => {
                let values = flatten_errors(toml_values.iter().map(|x| Value::new(x, engine, expressions)))?;
                is_constant = values.all(|x| x.is_constant);
                Value::Array(values)
            }
            toml::Value::Table(toml_kv) => {
                let kv = flatten_errors(toml_kv.iter().map(|(k, v)| Ok((k, Value::new(v, engine, expressions)?))))?;
                is_constant = kv.all(|(k,v)| v.is_constant);
                Value::Table(IndexMap::new(kv))
            }
        });
    }
}

impl Value {
    fn expressions(self: Value, expressions: &mut Vec<Expression>) {
        match self {
            Value::Expression(x) => expressions.push(x),
            Value::Interp(interps) => iterps.for_each(|iterp| {
                match inter {
                    Interp::Expression(x) => expressions.push(x),
                    _ => (),
                }
            }),
            Value::Array(items) => items.iter().for_each(|item| item.expressions(expressions)),
            Value::Table(kv) => kv.values().for_each(|val| val.expressions(expressions)),
            _ => (),
        }
    }
}

// TODO: function to extract expressions into a vector
// TODO: functions
//   - by replacing all observations of a given expression
//   - by checking names and resolving or erroring (e.g. for `bind.` and `command.`)
//   - by running an expression engine for each expression
// TODO: function to translate resolved expressions into toml::Value and JSON

struct TypedValue<T> {
    value: Value
}

impl TryInto<bool> for TypedValue<T> {
    type Error = Error;
    fn try_into(self) -> Result<bool> {
        return match self.value {
            Value::Boolean(x) => Ok(x),
            Expression(str, i) => Err(Error::Unresolved("expression")),
            _ => Err(Error::Constraint("boolean value"))
        }
    }
}

impl TryInto<f64> for TypedValue<T> {
    type Error = Error;
    fn try_into(self) -> Result<f64> {
        return match self.value {
            Value::Number(x) => Ok(x),
            Expression(str, i) => Err(Error::Unresolved("expression")),
            _ => Err(Error::Constraint("number"))
        }
    }
}

impl TryInto<String> for TypedValue<T> {
    type Error = Error;
    fn try_into(self) -> Result<String> {
        return match self.value {
            Value::String(x) => Ok(x),
            Expression(str, i) => Err(Error::Unresolved("expression")),
            _ => Err(Error::Constraint("string"))
        }
    }
}

// impl TryInto<T> for TypedValue<T>
// where T: Deserialize,
// {
//     type Error = Error;
//     fn try_into(self) -> Result<T> {
//         let toml = toml::Value::try_from(self)?;
//         let val = Value::new()
//     }
// }

fn expand_variables(expander: F, expressions: &mut Vec<Expression>) -> ResultVec<()>
    where F: FnMut(&str) -> Result<ExpandResult> {
    let errors = Vec::new();
    for i in 0..expressions.len() {
        match expressions[i] {
            Expression::Variable(str) => {
                match expander(str) {
                    Err(e) => errors.push(e),
                    Ok(result) => if ExpandResult::Expanded(val) = result {
                        expressions[i] = Expression::Literal(val)
                    }
                }
            }
            _ => ()
        }

        if errors.len() > 0 {
            return Err(errors);
        } else {
            return Ok(());
        }
    }
}

impl Expression {
    fn new(expr: &str) -> Result<Value> {
        // XXX: array indices are more fragile to mutation; for now this seems okay
        // but I could also see using a hash of the expression string to index
        if IDENTIFIER_CHAIN.is_match(expr) {
            return Expression::Variable(expr_str);
        } else {
            return Expression::Statement(expr_str);
        }
    }
}

fn string_to_expression(
    x: String,
) -> Value {
    let exprs = EXPRESSION.captures_iter(x);
    if exprs.first().get(0).expect("full_match").len() == x.len() {
        return Value::Expression(Expression::new(exprs.first().get(1).expect("expression body").as_str()));
    } else { // there are multiple expressions interpolated into the string
        let mut interps = Vec::new();
        let mut last_match = 0..0;
        for expr in exprs {
            let r = expr.get(0).expect("full match").range();
            interps.push(InterpItem::Constant(&self[last_match.end..r.start]));
            last_match = r;

            let var_str = expr.get(1).expect("variable name").as_str();
            interps.push(InterpItem::Expression(Expression::new(var_str)));
        }
        if last_match.start == 0 && last_match.end == 0 {
            return (true, Value::String(x));
        }
        if last_match.end < self.len() {
            interps.push(InterpItem::Constant(&self[last_match.end..]));
        }
        return Value::Interp(interps);
    }
}

// TODO: implement methods to serialize to the values to json objects / toml values

// TODO: `expand_with_getter` API isn't going to work
// since Rhai expects a scope object with all defined objects

pub trait Expanding {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool>;
    fn expand_value(&mut self, var: &str, value: &Value) -> ResultVec<()> {
        self.expand([(var, value)]);
    }
}

impl<T: Expanding> Expanding for Spanned<T> {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        return self .get_mut().expand(context).context_range(&self.span());
    }
}

impl<T: Expanding> Expanding for Vec<T> {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        return flatten_errors(self.iter_mut().map(|x| x.expand(context)));
    }
}

impl<T: Expanding> Expanding for Plural<T> {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        match self {
            Plural::Zero => return Ok(true),
            Plural::One(x) => return x.expand(context),
            Plural::Many(items) => {
                return flatten_errors(
                    items
                        .iter_mut()
                        .map(|v| v.expand(context)),
                );
            }
        }
    }
}

impl<T: Expanding> Expanding for Required<T> {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        Ok(match self {
            Required::DefaultValue => true,
            Required::Value(x) => x.expand(context)?,
        })
    }
}

impl Expanding for IndexMap<String, Value> {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        return flatten_errors(
            self.values_mut()
                .map(|x| x.expand(context)),
        );
    }
}

impl Expanding for Value {
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        if self.is_constant {
            return Ok(());
        }
        let (expansion, is_now_constant) = match self.data {
            Value::Number(_) | Value::String(_) | Value::Boolean(_) => (self.data, true),
            Value::Array(ref mut items) => (self.data, items.expand(context)),
            Value::Table(ref mut kv) => (self.data, kv.expand(context)),
            // TODO: we need to think on this more since we want to error
            // or differ expansion depending on the name, so the context
            // API doesn't quite work
            Value::Variable(name) => match context[&name] {
                ExpandResult::Deferred => (self.data, false),
                ExpandResult::Expanded(val) => (val, false),
            },
            Value::StringInterp(vals) => (self.data, vals.expand(context)),
            Value::Expression(ast) => match expand_expression(ast, context) {
                ExpandResult::Deferred => (self.data, false),
                ExpandResult::Expanded()
            }
            toml::Value::Array(items) => {
                let mut errors = Vec::<ErrorWithContext>::new();
                for i in 0..items.len() {
                    match expand_to_value(&mut items[i], getter.clone()) {
                        Err(ref mut err) => {
                            errors.append(err);
                        }
                        Ok(value) => {
                            items[i] = value;
                        }
                    }
                }
                if errors.len() > 0 {
                    return Err(errors);
                } else {
                    return Ok(());
                }
            }
            toml::Value::Table(kv) => {
                return kv.expand(context);
            }
            toml::Value::Boolean(_) | toml::Value::Datetime(_) => return Ok(()),
            toml::Value::Float(_) | toml::Value::Integer(_) => return Ok(()),
        }
    }
}

impl<T: Expanding> Expanding for Option<T> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<bool>
    where
        F: Fn(&str) -> Result<ExpandResult>,
        F: Clone,
    {
        Ok(match self {
            Some(v) => v.expand_with_getter(getter)?,
            None => (),
        })
    }
}

pub(crate) trait As<T> {
    fn astype(&self) -> Result<T>;
}

impl As<String> for toml::Value {
    fn astype(&self) -> Result<String> {
        Ok(self
            .as_str()
            .map(|s| s.into())
            .ok_or_else(|| Error::Constraint(format!("type String, found {}", self)))?)
    }
}

impl As<bool> for toml::Value {
    fn astype(&self) -> Result<bool> {
        Ok(self
            .as_bool()
            .ok_or_else(|| Error::Constraint(format!("type bool, found {}", self)))?)
    }
}

impl As<i64> for toml::Value {
    fn astype(&self) -> Result<i64> {
        Ok(self
            .as_integer()
            .ok_or_else(|| Error::Constraint(format!("type i64, found {}", self)))?)
    }
}

impl As<f64> for toml::Value {
    fn astype(&self) -> Result<f64> {
        Ok(self
            .as_float()
            .ok_or_else(|| Error::Constraint(format!("type f64, found {}", self)))?)
    }
}

impl<T> As<T> for T
where
    T: Clone,
{
    fn astype(&self) -> Result<Self> {
        Ok(self.clone())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(transparent)]
pub struct TypedValue<T>(TypedValueEnum<T>)
where
    toml::Value: As<T>;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum TypedValueEnum<T>
where
    toml::Value: As<T>,
{
    Literal(T),
    Variable(String),
}

impl<T> TypedValue<T>
where
    toml::TypedValue: As<T>,
{
    pub fn var(x: String) -> Self {
        return TypedValue(TypedValueEnum::Variable(x));
    }
}

impl<T> Expanding for TypedValue<T>
where
    toml::Value: As<T>,
{
    fn expand(&mut self, context: &impl Index<String, Output=Value>) -> ResultVec<bool> {
        match &self.0 {
            TypedValueEnum::Literal(_) => return Ok(()),
            TypedValueEnum::Variable(name) => {
                // TODO: use `try_from` to extract name during parse time
                // rather than expansion time
                let value = match getter(name)? {
                    Some(x) => x,
                    None => return Ok(()),
                };
                self.0 = TypedValueEnum::Literal(As::<T>::astype(&value)?);
                return Ok(());
            }
        };
    }
}

impl<T> Merging for TypeValue<T>
where
    toml::Value: As<T>,
{
    fn coalesce(self, new: Self) -> Self {
        return new;
    }

    fn merge(self, new: Self) -> Self {
        return new;
    }
}

impl<T> TypedValue<T>
where
    toml::Value: As<T>,
{
    pub fn unwrap(self) -> T {
        return match self.0 {
            ValueEnum::Literal(x) => x,
            ValueEnum::Variable(_) => panic!("Expected literal value"),
        };
    }
}

impl<T> Resolving<T> for TypedValue<T>
where
    toml::Value: As<T>,
{
    fn resolve(self, name: impl Into<String>) -> Result<T> {
        return match self.0 {
            TypedValueEnum::Literal(x) => Ok(x),
            TypedValueEnum::Variable(str) => {
                Err(Error::Unresolved(format!("{str} for {}", name.into())))?
            }
        };
    }
}

impl Expanding for String {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<bool>
    where
        F: Fn(&str) -> Result<ExpandResult>,
        F: Clone,
    {
        let mut result = String::new();
        let mut last_match = 0..0;
        for m in VAR_STRING.find_iter(self) {
            let r = m.range();

            result.push_str(&self[last_match.end..r.start]);
            let var = &self[(r.start + 2)..(r.end - 2)];
            let value = match getter(&var)? {
                Some(x) => x,
                None => {
                    result.push_str(&self[r.start..r.end]);
                    last_match = r;
                    continue;
                }
            };
            let output = match value {
                toml::Value::String(x) => x.clone(),
                _ => value.to_string(),
            };
            result.push_str(&output);
            last_match = r;
        }
        if last_match.start == 0 && last_match.end == 0 {
            return Ok(());
        }

        if last_match.end < self.len() {
            result.push_str(&self[last_match.end..])
        }
        self.clear();
        self.push_str(&result);

        return Ok(());
    }
}
