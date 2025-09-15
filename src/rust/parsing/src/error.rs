use crate::bind::UNKNOWN_RANGE;

use core::ops::Range;
use rhai::{self, EvalAltResult};
use smallvec::SmallVec;
use std::fmt;
use string_offsets::{Pos, StringOffsets};
use thiserror::Error;
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: properly handle `WhileTrying` (e.g. by having an outer type to prevent nesting)

#[derive(Debug, Error, Clone)]
pub enum RawError {
    #[error("while parsing toml: {0}")]
    TomlParsing(#[from] toml::de::Error),
    #[error("while parsing expression: {0}")]
    ExpressionParsing(#[from] rhai::ParseError),
    #[error("while writing toml: {0}")]
    Serialization(#[from] toml::ser::Error),
    #[error("while parsing regex: {0}")]
    Regex(#[from] regex::Error),
    #[error("{0}")]
    Static(&'static str),
    #[error("{0}")]
    Dynamic(String),
}

#[wasm_bindgen]
#[derive(Debug, Error, Clone)]
pub struct Error {
    #[source]
    pub(crate) error: RawError,
    pub(crate) contexts: SmallVec<[String; 8]>,
    pub(crate) ranges: SmallVec<[Position; 8]>,
}

#[derive(Debug, Clone)]
enum Position {
    Rhai(rhai::Position),
    Range(Range<usize>),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Error)]
#[error("first error: {}", .errors[0])]
pub struct ErrorSet {
    pub(crate) errors: Vec<Error>,
}

fn range_to_pos(range: Range<usize>, offsets: &StringOffsets) -> CharRange {
    let start = offsets.utf8_to_char_pos(range.start);
    let end = offsets.utf8_to_char_pos(range.end);
    CharRange { start, end }
}

// TODO: stopped working here
impl From<Box<EvalAltResult>> for Error {
    fn from(value: Box<EvalAltResult>) -> Self {
        let error: Error = RawError::Dynamic(format!("{}", value)).into();
        // how to combine with info about surrounding range
        // (if we have a range after this one use it; or should it be before?)
        error.context_range(Position::Rhai(value.position()));
    }
}

impl From<Error> for ErrorSet {
    fn from(value: Error) -> Self {
        return ErrorSet {
            errors: vec![value],
        };
    }
}

#[wasm_bindgen]
impl Error {
    pub fn report(&self, content: &[u8]) -> ErrorReport {
        let mut items = Vec::with_capacity(self.contexts.len() + 1);
        let offsets: StringOffsets = StringOffsets::from_bytes(content);
        items.push(match &self.error {
            RawError::TomlParsing(toml) => ErrorReportItem {
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
impl ErrorSet {
    pub fn report(&self, content: &[u8]) -> Vec<ErrorReport> {
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
        .collect::<Vec<Error>>();

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

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::result::Result<(), fmt::RawError> {
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

impl<E: Into<RawError>> From<E> for Error {
    fn from(error: E) -> Self {
        return Error {
            error: error.into(),
            contexts: SmallVec::new(),
        };
    }
}

impl From<Box<EvalAltResult>> for Error {}

impl<E: Into<RawError>> From<E> for ErrorSet {
    fn from(error: E) -> Self {
        let error: RawError = error.into();
        let error: Error = error.into();
        return error.into();
    }
}

impl From<Vec<Error>> for ErrorSet {
    fn from(value: Vec<Error>) -> Self {
        return ErrorSet { errors: value };
    }
}

pub fn constrain<T>(msg: &str) -> Result<T> {
    return Err(RawError::Constraint(msg.into()))?;
}

pub fn unexpected<T>(msg: &'static str) -> Result<T> {
    return Err(RawError::Unexpected(msg))?;
}

pub fn reserved<T>(msg: &'static str) -> Result<T> {
    return Err(RawError::ReservedField(msg))?;
}

// TODO: range - we select the most narrowest error, or the first
// such error if some don't overlap
// TODO: keep context string
// when reporting we don't split single Error into
// multiple diagnostics

pub trait ErrorContext<T>
where
    Self: Sized,
{
    type RawError;
    fn context(self, context: Context) -> std::result::Result<T, Self::RawError>;
    fn context_str(self, context: impl Into<String>) -> std::result::Result<T, Self::RawError> {
        self.context(Context::String(context.into()))
    }
    fn context_range(self, context: &impl Spannable) -> std::result::Result<T, Self::RawError> {
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

impl<T, E: Into<RawError>> ErrorContext<T> for std::result::Result<T, E> {
    type RawError = Error;
    fn context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(e) => Err(Error {
                error: e.into(),
                contexts: vec![context],
            }),
        };
    }
}

impl<T> ErrorContext<T> for Result<T> {
    type RawError = Error;
    fn context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(mut e) => {
                e.contexts.push(context);
                Err(Error {
                    error: e.error,
                    contexts: e.contexts,
                })
            }
        };
    }
}

impl<T> ErrorContext<T> for ResultVec<T> {
    type RawError = ErrorSet;
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

pub type Result<T> = std::result::Result<T, Error>;
pub type ResultVec<T> = std::result::Result<T, ErrorSet>;
