use crate::error::{Error, ErrorContexts, ErrorWithContext, Result, ResultVec};
use crate::util::{Merging, Plural, Required, Resolving};

#[allow(unused_imports)]
use log::info;

use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use toml::Spanned;

pub trait VariableExpanding {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone;
    fn expand_value(&mut self, var: &str, value: &toml::Value) -> ResultVec<()> {
        self.expand_with_getter(|e_var| {
            if e_var == var {
                Ok(Some(value.clone()))
            } else {
                Ok(None)
            }
        })
    }
}

impl<T: VariableExpanding> VariableExpanding for Spanned<T> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        return self
            .get_mut()
            .expand_with_getter(getter)
            .context_range(&self.span());
    }
}

impl<T: VariableExpanding> VariableExpanding for Vec<T> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        return flatten_errors(
            self.iter_mut()
                .map(|x| x.expand_with_getter(getter.clone())),
        );
    }
}

fn flatten_errors(errs: impl Iterator<Item = ResultVec<()>>) -> ResultVec<()> {
    let errors = errs.filter(|x| x.is_err());
    let flat_errs = errors
        .into_iter()
        .flat_map(|x| x.unwrap_err().into_iter())
        .collect::<Vec<ErrorWithContext>>();

    if flat_errs.len() > 0 {
        return Err(flat_errs);
    } else {
        return Ok(());
    }
}

impl<T: VariableExpanding> VariableExpanding for Plural<T> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        match self {
            Plural::Zero => return Ok(()),
            Plural::One(x) => return x.expand_with_getter(getter),
            Plural::Many(items) => {
                return flatten_errors(
                    items
                        .iter_mut()
                        .map(|v| v.expand_with_getter(getter.clone())),
                );
            }
        }
    }
}

impl<T: VariableExpanding> VariableExpanding for Required<T> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        Ok(match self {
            Required::DefaultValue => (),
            Required::Value(x) => x.expand_with_getter(getter)?,
        })
    }
}

impl VariableExpanding for toml::map::Map<String, toml::Value> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        let mut errors = Vec::new();
        let keys: Vec<String> = self.keys().map(String::clone).collect();
        for k in keys {
            match expand_to_value(&mut self[&k], getter.clone()) {
                Err(ref mut err) => {
                    errors.append(err);
                }
                Ok(value) => {
                    self.insert(k.clone(), value);
                }
            }
        }
        if errors.len() > 0 {
            return Err(errors);
        } else {
            return Ok(());
        }
    }
}

fn expand_to_value<F>(value: &mut toml::Value, getter: F) -> ResultVec<toml::Value>
where
    F: Fn(&str) -> Result<Option<toml::Value>>,
    F: Clone,
{
    match value {
        toml::Value::String(str) => {
            let captures = VAR_STRING.captures(str);
            if let Some(c) = captures {
                if c.get(0).unwrap().len() == str.len() {
                    let var = c.get(1).expect("variable capture group").as_str();
                    let expanded = getter(var)?.unwrap_or_else(|| value.clone());
                    return Ok(expanded);
                }
            }

            str.expand_with_getter(getter)?;
            return Ok(value.clone());
        }
        _ => {
            value.expand_with_getter(getter)?;
            return Ok(value.clone());
        }
    }
}

impl VariableExpanding for toml::Value {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        match self {
            toml::Value::String(x) => {
                x.expand_with_getter(getter)?;
                return Ok(());
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
                return kv.expand_with_getter(getter);
            }
            toml::Value::Boolean(_) | toml::Value::Datetime(_) => return Ok(()),
            toml::Value::Float(_) | toml::Value::Integer(_) => return Ok(()),
        }
    }
}

impl<T: VariableExpanding> VariableExpanding for Option<T> {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
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
pub struct Value<T>(ValueEnum<T>)
where
    toml::Value: As<T>;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ValueEnum<T>
where
    toml::Value: As<T>,
{
    Literal(T),
    Variable(String),
}

impl<T> Value<T>
where
    toml::Value: As<T>,
{
    pub fn var(x: String) -> Self {
        return Value(ValueEnum::Variable(x));
    }
}

lazy_static! {
    pub static ref VAR_STRING: Regex = Regex::new(r"\{\{([\w--\d][\.\w]*)\}\}").unwrap();
}

fn variable_name(x: &str) -> Result<&str> {
    if VAR_STRING.captures(x).is_some_and(|c| c.len() == x.len()) {
        return Ok(VAR_STRING
            .captures(x)
            .ok_or_else(|| Error::Constraint(r"string starts and ends with `{{` and `}}`".into()))?
            .get(1)
            .ok_or_else(|| Error::Unexpected("empty variable"))?
            .as_str());
    } else {
        return Err(Error::Constraint(
            r"string starts and ends with `{{` and `}}`".into(),
        ))?;
    }
}

impl<T> VariableExpanding for Value<T>
where
    toml::Value: As<T>,
{
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        match &self.0 {
            ValueEnum::Literal(_) => return Ok(()),
            ValueEnum::Variable(str) => {
                // TODO: use `try_from` to extract name during parse time
                // rather than expansion time
                let name = variable_name(&str)?;
                let value = match getter(name)? {
                    Some(x) => x,
                    None => return Ok(()),
                };
                self.0 = ValueEnum::Literal(As::<T>::astype(&value)?);
                return Ok(());
            }
        };
    }
}

impl<T> Merging for Value<T>
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

impl<T> Value<T>
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

impl<T> Resolving<T> for Value<T>
where
    toml::Value: As<T>,
{
    fn resolve(self, name: impl Into<String>) -> Result<T> {
        return match self.0 {
            ValueEnum::Literal(x) => Ok(x),
            ValueEnum::Variable(str) => {
                Err(Error::Unresolved(format!("{str} for {}", name.into())))?
            }
        };
    }
}

impl VariableExpanding for String {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
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
