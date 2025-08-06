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
        return flatten_errors(
            self.iter_mut()
                .map(|(_, v)| v.expand_with_getter(getter.clone())),
        );
    }
}

impl VariableExpanding for toml::Value {
    fn expand_with_getter<F>(&mut self, getter: F) -> ResultVec<()>
    where
        F: Fn(&str) -> Result<Option<toml::Value>>,
        F: Clone,
    {
        // TODO: this is one place where we would want to implement pruning
        // when computing multiple passes of variable expansion
        // we'd need some structure to keep track of where we are in the
        // tree and mark certain branches as dead if they return `Ok(false)`
        // or any `Err`.
        // we could do this with a mutable hash map that maps given
        // items to their last return state
        match self {
            toml::Value::String(str) => return str.expand_with_getter(getter),
            toml::Value::Array(items) => {
                return flatten_errors(
                    items
                        .iter_mut()
                        .map(|i| i.expand_with_getter(getter.clone())),
                );
            }
            toml::Value::Table(kv) => return kv.expand_with_getter(getter.clone()),
            _ => return Ok(()),
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(transparent)]
pub struct Value<T>(ValueEnum<T>)
where
    toml::Value: As<T>;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
enum ValueEnum<T>
where
    toml::Value: As<T>,
{
    Literal(T),
    Variable(String),
}

lazy_static! {
    static ref VAR_STRING: Regex = Regex::new(r"^\{\{(.+)\}\}$").unwrap();
}

fn variable_name(x: &str) -> Result<&str> {
    return Ok(VAR_STRING
        .captures(x)
        .ok_or_else(|| Error::Constraint(r"string surrounded by `{{` and `}}`".into()))?
        .get(1)
        .ok_or_else(|| Error::Unexpected("empty variable"))?
        .as_str());
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
                let name = variable_name(&str)?;
                let value = match getter(name)? {
                    Some(x) => x,
                    None => return Ok(()),
                };
                self.0 = ValueEnum::Literal(As::<T>::astype(&value).ok_or_else(|| {
                    Error::Constraint(format!(
                        "variable of type `{}`, found {}",
                        std::any::type_name::<T>(),
                        value
                    ))
                })?);
                return Ok(());
            }
        };
    }
}

impl<T> Merging for Value<T>
where
    toml::Value: As<T>,
    T: Copy,
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
    T: Copy,
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
    T: Copy,
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

        if last_match.end < self.len() {
            result.push_str(&self[last_match.end..])
        }
        self.clear();
        self.push_str(&result);

        return Ok(());
    }
}
