use crate::bind::UNKNOWN_RANGE;

use core::ops::Range;
use rhai;
use std::fmt;
use string_offsets::{Pos, StringOffsets};
use thiserror::Error;
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: properly handle `WhileTrying` (e.g. by having an outer type to prevent nesting)

#[derive(Debug, Error, Clone)]
pub enum Error {
    #[error("toml parsing {0}")]
    TomlParsing(#[from] toml::de::Error),
    #[error("expression parsing {0}")]
    ExpressionParsing(#[from] rhai::ParseError),
    #[error("expression eval {0}")]
    ExpressionEval(String),
    #[error("serializing {0}")]
    Serialization(#[from] toml::ser::Error),
    #[error("deserializing {0}")]
    JsSerialization(String),
    #[error("expression failed with {0}")]
    Rhai(String),
    #[error("invalid {0}")]
    Validation(String),
    #[error("expected {0}")]
    Constraint(String),
    #[error("requires {0}")]
    RequiredField(String),
    #[error("unexpected {0}")]
    Unexpected(&'static str),
    #[error("unresolved {0}")]
    Unresolved(String),
    #[error("undefined variable {0}")]
    UndefinedVariable(String),
    #[error("reserved field name {0}")]
    ReservedField(&'static str),
    #[error("parsing regex failed with {0}")]
    Regex(#[from] regex::Error),
}

// TODO: figure out how to expose errors in wasm
// (maybe we output some regular formatting structure rather than individual error types)
#[wasm_bindgen]
#[derive(Debug, Error, Clone)]
pub struct ErrorWithContext {
    #[source]
    #[wasm_bindgen(skip)]
    pub error: Error,
    #[wasm_bindgen(skip)]
    pub contexts: Vec<Context>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Error)]
#[error("first error: {}", .errors[0])]
pub struct ErrorsWithContext {
    pub(crate) errors: Vec<ErrorWithContext>,
}

fn range_to_pos(range: Range<usize>, offsets: &StringOffsets) -> CharRange {
    let start = offsets.utf8_to_char_pos(range.start);
    let end = offsets.utf8_to_char_pos(range.end);
    CharRange { start, end }
}

impl From<ErrorWithContext> for ErrorsWithContext {
    fn from(value: ErrorWithContext) -> Self {
        return ErrorsWithContext {
            errors: vec![value],
        };
    }
}

#[wasm_bindgen]
impl ErrorWithContext {
    pub fn report(&self, content: &str) -> ErrorReport {
        let mut items = Vec::with_capacity(self.contexts.len() + 1);
        let offsets: StringOffsets = StringOffsets::new(content);
        items.push(match &self.error {
            Error::TomlParsing(toml) => ErrorReportItem {
                message: Some(toml.message().into()),
                range: toml.span().map(|r| range_to_pos(r, &offsets)),
            },
            _ => ErrorReportItem {
                message: Some(self.error.to_string()),
                range: None,
            },
        });
        for context in &self.contexts {
            let item = match context {
                Context::String(str) => ErrorReportItem {
                    message: Some(str.clone()),
                    range: None,
                },
                Context::Range(range) => {
                    if *range == UNKNOWN_RANGE {
                        continue;
                    }
                    ErrorReportItem {
                        message: None,
                        range: Some(range_to_pos(range.clone(), &offsets)),
                    }
                }
            };
            items.push(item);
        }
        return ErrorReport { items };
    }
}

#[wasm_bindgen]
impl ErrorsWithContext {
    pub fn report(&self, content: &str) -> Vec<ErrorReport> {
        return self.errors.iter().map(|e| e.report(content)).collect();
    }
}

#[derive(Debug, Clone)]
#[wasm_bindgen(getter_with_clone)]
pub struct ErrorReport {
    pub items: Vec<ErrorReportItem>,
}

pub fn flatten_errors<T>(errs: impl Iterator<Item = ResultVec<T>>) -> ResultVec<Vec<T>>
where
    T: std::fmt::Debug,
{
    let (results, errors): (Vec<_>, Vec<_>) = errs.partition(|e| e.is_ok());
    let flat_errs = errors
        .into_iter()
        .flat_map(|x| x.unwrap_err().errors.into_iter())
        .collect::<Vec<ErrorWithContext>>();

    if flat_errs.len() > 0 {
        return Err(flat_errs.into());
    } else {
        return Ok(results.into_iter().map(|x| x.unwrap()).collect());
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct CharRange {
    pub start: Pos,
    pub end: Pos,
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct ErrorReportItem {
    pub message: Option<String>,
    pub range: Option<CharRange>,
}

#[derive(Debug, Clone)]
pub enum Context {
    String(String),
    Range(Range<usize>),
}

impl fmt::Display for ErrorWithContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::result::Result<(), fmt::Error> {
        for context in &self.contexts {
            match context {
                Context::String(str) => {
                    write!(f, "{}\n", str)?;
                }
                Context::Range(range) => {
                    write!(f, "byte range {:?}\n", range)?;
                }
            }
        }
        self.error.fmt(f)?;
        return Ok(());
    }
}

impl<E: Into<Error>> From<E> for ErrorWithContext {
    fn from(error: E) -> Self {
        return ErrorWithContext {
            error: error.into(),
            contexts: vec![],
        };
    }
}

impl<E: Into<Error>> From<E> for ErrorsWithContext {
    fn from(error: E) -> Self {
        let error: Error = error.into();
        let error: ErrorWithContext = error.into();
        return error.into();
    }
}

impl From<Vec<ErrorWithContext>> for ErrorsWithContext {
    fn from(value: Vec<ErrorWithContext>) -> Self {
        return ErrorsWithContext { errors: value };
    }
}

pub fn constrain<T>(msg: &str) -> Result<T> {
    return Err(Error::Constraint(msg.into()))?;
}

pub fn unexpected<T>(msg: &'static str) -> Result<T> {
    return Err(Error::Unexpected(msg))?;
}

pub fn reserved<T>(msg: &'static str) -> Result<T> {
    return Err(Error::ReservedField(msg))?;
}

pub trait ErrorContext<T>
where
    Self: Sized,
{
    type Error;
    fn context(self, context: Context) -> std::result::Result<T, Self::Error>;
    fn context_str(self, context: impl Into<String>) -> std::result::Result<T, Self::Error> {
        self.context(Context::String(context.into()))
    }
    fn context_range(self, context: &impl Spannable) -> std::result::Result<T, Self::Error> {
        if let Some(range) = context.range() {
            return self.context(Context::Range(range));
        } else {
            return self.context(Context::Range(UNKNOWN_RANGE));
        }
    }
}

pub trait Spannable {
    fn range(&self) -> Option<Range<usize>>;
}

impl<T> Spannable for Spanned<T> {
    fn range(&self) -> Option<Range<usize>> {
        Some(self.span())
    }
}

impl<T> Spannable for Option<Spanned<T>> {
    fn range(&self) -> Option<Range<usize>> {
        self.as_ref().map(|x| x.span())
    }
}

impl Spannable for Range<usize> {
    fn range(&self) -> Option<Range<usize>> {
        return Some(self.clone());
    }
}

impl<T, E: Into<Error>> ErrorContext<T> for std::result::Result<T, E> {
    type Error = ErrorWithContext;
    fn context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(e) => Err(ErrorWithContext {
                error: e.into(),
                contexts: vec![context],
            }),
        };
    }
}

impl<T> ErrorContext<T> for Result<T> {
    type Error = ErrorWithContext;
    fn context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(mut e) => {
                e.contexts.push(context);
                Err(ErrorWithContext {
                    error: e.error,
                    contexts: e.contexts,
                })
            }
        };
    }
}

impl<T> ErrorContext<T> for ResultVec<T> {
    type Error = ErrorsWithContext;
    fn context(self, context: Context) -> ResultVec<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(mut errs) => {
                errs.errors
                    .iter_mut()
                    .for_each(|e| e.contexts.push(context.clone()));
                Err(errs)
            }
        };
    }
}

pub type Result<T> = std::result::Result<T, ErrorWithContext>;
pub type ResultVec<T> = std::result::Result<T, ErrorsWithContext>;
