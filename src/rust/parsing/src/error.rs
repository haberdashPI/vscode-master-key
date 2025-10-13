#[allow(unused_imports)]
use log::info;

use core::ops::Range;
use lazy_static::lazy_static;
use regex::Regex;
use rhai::{self, EvalAltResult};
use serde::Serialize;
use smallvec::SmallVec;
use std::fmt;
use string_offsets::{Pos, StringOffsets};
use thiserror::Error;
use toml::Spanned;
use wasm_bindgen::prelude::*;

use crate::bind::UNKNOWN_RANGE;

//
// ---------------- Error Generation ----------------
//

// Functionality related to producing the basic `Error` objects used throughout this crate.

#[derive(Debug, Error, Clone)]
pub enum RawError {
    #[error("conversion error: {0}")]
    IntError(#[from] std::num::TryFromIntError),
    #[error("while parsing toml: {0}")]
    TomlParsing(#[from] toml::de::Error),
    #[error("while parsing expression: {0}")]
    ExpressionParsing(#[from] rhai::ParseError),
    #[error("while writing toml: {0}")]
    Serialization(#[from] toml::ser::Error),
    #[error("while parsing regex: {0}")]
    Regex(#[from] regex::Error),
    #[error("{0}")]
    Dynamic(String),
    #[error("{0}")]
    Static(&'static str),
}

#[macro_export]
macro_rules! err {
    ( $($x:tt)* ) => {
        crate::error::RawError::Dynamic(format!($($x)*))
    };
}

#[macro_export]
macro_rules! wrn {
    ( $($x:tt)* ) => {
        crate::error::ParseError {
            error: crate::error::RawError::Dynamic(format!($($x)*)),
            contexts: smallvec::SmallVec::new(),
            level: crate::error::ErrorLevel::Warn,
        }
    };
}

#[macro_export]
macro_rules! note {
    ( $($x:tt)* ) => {
        crate::error::ParseError {
            error: crate::error::RawError::Dynamic(format!($($x)*))
            contexts: smallvec::SmallVec::new(),
            level: crate::error::ErrorLevel::Note
        }
    };
}

pub fn err(msg: &'static str) -> RawError {
    return RawError::Static(msg);
}

pub fn wrn(msg: &'static str) -> ParseError {
    return ParseError {
        error: RawError::Static(msg),
        contexts: SmallVec::new(),
        level: ErrorLevel::Warn,
    };
}

pub fn note(msg: &'static str) -> ParseError {
    return ParseError {
        error: RawError::Static(msg),
        contexts: SmallVec::new(),
        level: ErrorLevel::Info,
    };
}

#[wasm_bindgen]
#[derive(Debug, Error, Clone)]
pub struct ParseError {
    #[source]
    pub(crate) error: RawError,
    pub(crate) contexts: SmallVec<[Context; 8]>,
    pub(crate) level: ErrorLevel,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize)]
pub enum ErrorLevel {
    #[default]
    Error,
    Warn,
    Info,
}

#[derive(Debug, Clone)]
pub enum Context {
    Message(String),        // additional message content to include
    Range(Range<usize>),    // the location of an error in a file
    ExpRange(Range<usize>), // location of expression being evaluated (can be merged with a rhai::Position)
    RefRange(Range<usize>), // another location mentioned in the error message
}

/// A `Spannable` can be interpreted as a range of byte offsets
/// as stored by `toml::Spanned`.
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

impl Spannable for Option<Range<usize>> {
    fn range(&self) -> Option<Range<usize>> {
        return self.clone();
    }
}

impl Spannable for &Range<usize> {
    fn range(&self) -> Option<Range<usize>> {
        return Some(self.to_owned().clone());
    }
}

/// An object implementing `ErrorContext` can store additional context
/// about the error being returned.
pub trait ErrorContext<T>
where
    Self: Sized,
{
    type Error;
    /// `with_context` accepts a `Context` which the object should store
    fn with_context(self, context: Context) -> std::result::Result<T, Self::Error>;
    fn with_message(self, context: impl ToString) -> std::result::Result<T, Self::Error> {
        return self.with_context(Context::Message(context.to_string()));
    }
    // NOTE: we return UNKNOWN_RANGE here because we have to transform the value using
    // `.with_context` to keep the return type uniform
    fn with_range(self, context: &impl Spannable) -> std::result::Result<T, Self::Error> {
        if let Some(range) = context.range() {
            return self.with_context(Context::Range(range));
        } else {
            return self.with_context(Context::Range(UNKNOWN_RANGE));
        }
    }
    fn with_exp_range(self, context: &impl Spannable) -> std::result::Result<T, Self::Error> {
        if let Some(range) = context.range() {
            return self.with_context(Context::ExpRange(range));
        } else {
            return self.with_context(Context::Range(UNKNOWN_RANGE));
        }
    }
    fn with_ref_range(self, context: &impl Spannable) -> std::result::Result<T, Self::Error> {
        if let Some(range) = context.range() {
            return self.with_context(Context::RefRange(range));
        } else {
            return self.with_context(Context::RefRange(UNKNOWN_RANGE));
        }
    }
}

impl<T> ErrorContext<T> for Result<T> {
    type Error = ParseError;
    fn with_context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(mut e) => {
                e.contexts.push(context);
                Err(ParseError {
                    error: e.error,
                    contexts: e.contexts,
                    level: e.level,
                })
            }
        };
    }
}

pub type Result<T> = std::result::Result<T, ParseError>;

impl<E: Into<RawError>> From<E> for ParseError {
    fn from(error: E) -> Self {
        return ParseError {
            error: error.into(),
            contexts: SmallVec::new(),
            level: ErrorLevel::default(),
        };
    }
}

impl From<Box<EvalAltResult>> for RawError {
    fn from(value: Box<EvalAltResult>) -> RawError {
        return RawError::Dynamic(value.to_string());
    }
}

//
// ---------------- ErrorSet Generation ----------------
//

// Functionality related to the generation of ErrorSets; these track multiple errors
// produced across different locations in a parsed master keybinding file

pub type ResultVec<T> = std::result::Result<T, ErrorSet>;

#[wasm_bindgen]
#[derive(Debug, Clone, Error)]
#[error("first error: {}", .errors[0])]
pub struct ErrorSet {
    pub(crate) errors: Vec<ParseError>,
}

impl From<ParseError> for ErrorSet {
    fn from(value: ParseError) -> Self {
        return ErrorSet {
            errors: vec![value],
        };
    }
}

/// Compile an iterable of `ResultVec<T>` to a single `ResultVec<Vec<T>>`
pub fn flatten_errors<T>(errs: impl Iterator<Item = ResultVec<T>>) -> ResultVec<Vec<T>>
where
    T: std::fmt::Debug,
{
    let (results, errors): (Vec<_>, Vec<_>) = errs.partition(|e| e.is_ok());
    let flat_errs = errors
        .into_iter()
        .flat_map(|x| x.unwrap_err().errors.into_iter())
        .collect::<Vec<ParseError>>();

    if flat_errs.len() > 0 {
        return Err(flat_errs.into());
    } else {
        return Ok(results.into_iter().map(|x| x.unwrap()).collect());
    }
}

impl<E: Into<RawError>> From<E> for ErrorSet {
    fn from(error: E) -> Self {
        let error: RawError = error.into();
        let error: ParseError = error.into();
        return error.into();
    }
}

impl From<Vec<ParseError>> for ErrorSet {
    fn from(value: Vec<ParseError>) -> Self {
        return ErrorSet { errors: value };
    }
}

impl<T, E: Into<RawError>> ErrorContext<T> for std::result::Result<T, E> {
    type Error = ParseError;
    fn with_context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(e) => {
                let mut contexts = SmallVec::new();
                contexts.push(context);
                Err(ParseError {
                    error: e.into(),
                    contexts,
                    level: ErrorLevel::default(),
                })
            }
        };
    }
}

impl<T> ErrorContext<T> for ResultVec<T> {
    type Error = ErrorSet;
    fn with_context(self, context: Context) -> ResultVec<T> {
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

//
// ---------------- Error Reporting ----------------
//

// While this trait might be useful for debugging it is not the main API through which
// errors are reported. It has to be implemented for `derive(Error)` to work
impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::result::Result<(), fmt::Error> {
        for context in &self.contexts {
            match context {
                Context::Message(str) => {
                    write!(f, "{}\n", str)?;
                }
                Context::Range(range) => {
                    write!(f, "byte range {:?}\n", range)?;
                }
                Context::ExpRange(range) => {
                    write!(f, "byte range {:?}\n", range)?;
                }
                Context::RefRange(range) => {
                    write!(f, "and byte range {:?}\n", range)?;
                }
            }
        }
        self.error.fmt(f)?;
        return Ok(());
    }
}

fn range_to_pos(range: &Range<usize>, offsets: &StringOffsets) -> CharRange {
    let start;
    let end;
    if range == &UNKNOWN_RANGE {
        start = offsets.utf8_to_char_pos(0);
        end = offsets.utf8_to_char_pos(offsets.len());
    } else {
        start = offsets.utf8_to_char_pos(range.start);
        end = offsets.utf8_to_char_pos(range.end);
    }
    CharRange { start, end }
}

fn resolve_rhai_pos_from_expression_range(
    rhai_pos: rhai::Position,
    char_line_range: CharRange,
) -> CharRange {
    if let Some(line) = rhai_pos.line() {
        if line >= 1 {
            let char_line_start = Pos {
                line: char_line_range.start.line + line - 1,
                col: char_line_range.start.col + rhai_pos.position().unwrap_or_default(),
            };
            return CharRange {
                start: char_line_start,
                end: char_line_start,
            };
        }
    }
    return char_line_range;
}

lazy_static! {
    static ref LINE_MESSAGE: Regex = Regex::new(r"\(line [0-9]+, position [0-9]+\)").unwrap();
}

#[wasm_bindgen]
impl ParseError {
    /// `report` is how we generate legible annotations
    /// of *.mk.toml file errors in typescript
    pub fn report(&self, content: &[u8]) -> ErrorReport {
        let offsets: StringOffsets = StringOffsets::from_bytes(content);
        let mut message_buf = String::new();
        let mut range = UNKNOWN_RANGE;
        let mut ref_range = UNKNOWN_RANGE;
        let mut char_line_range = None;
        let mut rhai_pos = None;
        match &self.error {
            RawError::TomlParsing(toml) => {
                message_buf.push_str(toml.message());
                char_line_range = toml.span().map(|r| range_to_pos(&r, &offsets));
            }
            RawError::ExpressionParsing(rhai) => {
                rhai_pos = Some(rhai.position());
                let raw_msg = self.error.to_string();
                let msg = LINE_MESSAGE.replace_all(&raw_msg, "");
                message_buf.push_str(&msg);
            }
            _ => message_buf.push_str(&self.error.to_string()),
        };
        for context in &self.contexts {
            match context {
                Context::Message(str) => message_buf.push_str(str),
                Context::Range(new_range) => {
                    // usually the old range is the one we want to use *but* if the new
                    // range is strictly more specific than the new one, we use the new
                    // range
                    if range.contains(&new_range.start) && range.contains(&new_range.end) {
                        range = new_range.clone();
                        char_line_range = Some(range_to_pos(&new_range, &offsets));
                    }
                }
                Context::ExpRange(new_range) => {
                    // a range reported via ExpRange is one that specifically matches the
                    // span of an expression, and so we know its safe to merge it with the
                    // position reported by a rhai position
                    range = new_range.clone();
                    let new_char_line_range = range_to_pos(&new_range, &offsets);
                    if let Some(pos) = rhai_pos {
                        char_line_range = Some(resolve_rhai_pos_from_expression_range(
                            pos,
                            new_char_line_range,
                        ));
                        rhai_pos = None;
                    } else {
                        char_line_range = Some(new_char_line_range);
                    }
                }
                Context::RefRange(new_range) => {
                    if new_range != &UNKNOWN_RANGE {
                        ref_range = new_range.clone();
                    }
                }
            };
        }
        if let Some(cl_range) = char_line_range {
            if ref_range != UNKNOWN_RANGE {
                let pos = range_to_pos(&ref_range, &offsets);
                message_buf.push_str(&format!("{pos}"));
            };
            return ErrorReport {
                message: message_buf,
                range: cl_range,
                level: self.level.clone(),
            };
        } else {
            return ErrorReport {
                message: format!(
                    "Failed to find range location for the message {}",
                    message_buf
                ),
                range: CharRange::default(),
                level: ErrorLevel::Error,
            };
        }
    }
}

#[wasm_bindgen]
impl ErrorSet {
    pub fn report(&self, content: &[u8]) -> Vec<ErrorReport> {
        return self.errors.iter().map(|e| e.report(content)).collect();
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct CharRange {
    pub start: Pos,
    pub end: Pos,
}

impl std::fmt::Display for CharRange {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::result::Result<(), std::fmt::Error> {
        if self.start.line == self.end.line {
            if self.start.col == self.end.col {
                write!(fmt, "line {}, column {}", self.start.line, self.start.col)?;
            } else {
                write!(
                    fmt,
                    "line {}, columns {} - {}",
                    self.start.line, self.start.col, self.end.col
                )?;
            }
        } else {
            write!(fmt, "lines {} - {}", self.start.line, self.end.line)?;
        }
        return Ok(());
    }
}

impl Default for CharRange {
    fn default() -> Self {
        return CharRange {
            start: Pos { line: 0, col: 0 },
            end: Pos { line: 0, col: 0 },
        };
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct ErrorReport {
    pub message: String,
    pub range: CharRange,
    pub level: ErrorLevel,
}

#[wasm_bindgen]
impl ErrorReport {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        return ErrorReport {
            message: String::from(""),
            range: CharRange::default(),
            level: ErrorLevel::default(),
        };
    }
}
