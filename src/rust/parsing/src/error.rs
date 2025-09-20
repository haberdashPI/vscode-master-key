use crate::bind::UNKNOWN_RANGE;

use core::ops::Range;
use rhai::{self, EvalAltResult};
use smallvec::SmallVec;
use std::fmt;
use string_offsets::{Pos, StringOffsets};
use thiserror::Error;
use toml::Spanned;
use wasm_bindgen::prelude::*;

//
// ---------------- Error Generation ----------------
//

// Functionality related to producing the basic `Error` objects used throughout this crate.

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

pub fn err(msg: &'static str) -> RawError {
    return RawError::Static(msg);
}

#[wasm_bindgen]
#[derive(Debug, Error, Clone)]
pub struct Error {
    #[source]
    pub(crate) error: RawError,
    pub(crate) contexts: SmallVec<[Context; 8]>,
}

#[derive(Debug, Clone)]
pub enum Context {
    Dynamic(&'static str),        // additional message content to include
    Range(Range<usize>),          // the location of an error in a file
    RhaiPosition(rhai::Position), // the location of an error within an expression

    // TODO: use this context once when/if expressions have a known span
    #[allow(dead_code)]
    ExpressionRange(Range<usize>), // the location of an expression in a file
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

/// An object implementing `ErrorContext` can store additional context
/// about the error being returned.
pub trait ErrorContext<T>
where
    Self: Sized,
{
    type Error;
    /// `with_context` accepts a `Context` which the object should store
    fn with_context(self, context: Context) -> std::result::Result<T, Self::Error>;
    fn with_message(self, context: &'static str) -> std::result::Result<T, Self::Error> {
        return self.with_context(Context::Dynamic(context));
    }
    fn with_range(self, context: &impl Spannable) -> std::result::Result<T, Self::Error> {
        if let Some(range) = context.range() {
            return self.with_context(Context::Range(range));
        } else {
            return self.with_context(Context::Range(UNKNOWN_RANGE));
        }
    }
    fn with_expression_range(
        self,
        context: &impl Spannable,
    ) -> std::result::Result<T, Self::Error> {
        if let Some(range) = context.range() {
            return self.with_context(Context::ExpressionRange(range));
        } else {
            return self.with_context(Context::ExpressionRange(UNKNOWN_RANGE));
        }
    }
    fn with_pos(self, context: rhai::Position) -> std::result::Result<T, Self::Error> {
        return self.with_context(Context::RhaiPosition(context));
    }
}

impl<T> ErrorContext<T> for Result<T> {
    type Error = Error;
    fn with_context(self, context: Context) -> Result<T> {
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

pub type Result<T> = std::result::Result<T, Error>;

impl<E: Into<RawError>> From<E> for Error {
    fn from(error: E) -> Self {
        return Error {
            error: error.into(),
            contexts: SmallVec::new(),
        };
    }
}

impl From<Box<EvalAltResult>> for Error {
    fn from(value: Box<EvalAltResult>) -> Error {
        let error = RawError::Dynamic(value.to_string()).into();
        let mut contexts = SmallVec::new();
        contexts.push(Context::RhaiPosition(value.position()));
        return Error { error, contexts };
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
    pub(crate) errors: Vec<Error>,
}

impl From<Error> for ErrorSet {
    fn from(value: Error) -> Self {
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
        .collect::<Vec<Error>>();

    if flat_errs.len() > 0 {
        return Err(flat_errs.into());
    } else {
        return Ok(results.into_iter().map(|x| x.unwrap()).collect());
    }
}

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

impl<T, E: Into<RawError>> ErrorContext<T> for std::result::Result<T, E> {
    type Error = Error;
    fn with_context(self, context: Context) -> Result<T> {
        return match self {
            Ok(x) => Ok(x),
            Err(e) => {
                let mut contexts = SmallVec::new();
                contexts.push(context);
                Err(Error {
                    error: e.into(),
                    contexts,
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
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::result::Result<(), fmt::Error> {
        for context in &self.contexts {
            match context {
                Context::Dynamic(str) => {
                    write!(f, "{}\n", str)?;
                }
                Context::Range(range) => {
                    write!(f, "byte range {:?}\n", range)?;
                }
                Context::ExpressionRange(range) => {
                    write!(f, "byte range of expression {:?}\n", range)?;
                }
                Context::RhaiPosition(pos) => {
                    write!(f, "expression pos: {:?}\n", pos)?;
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
    rhai_pos: Option<rhai::Position>,
    char_line_range: Option<CharRange>,
) -> Option<CharRange> {
    if let (Some(rpos), Some(cl_range)) = (rhai_pos, &char_line_range) {
        if let Some(line) = rpos.line() {
            if line > 1 {
                let char_line_start = Pos {
                    line: cl_range.start.line + line - 1,
                    col: cl_range.start.col + rpos.position().unwrap_or_default(),
                };
                return Some(CharRange {
                    start: char_line_start,
                    end: char_line_start,
                });
            }
        }
    }
    return char_line_range;
}

#[wasm_bindgen]
impl Error {
    pub fn report(&self, content: &[u8]) -> ErrorReport {
        let offsets: StringOffsets = StringOffsets::from_bytes(content);
        let mut message_buf = String::new();
        let mut range = UNKNOWN_RANGE;
        let mut char_line_range = None;
        let mut rhai_pos = None;
        match &self.error {
            RawError::TomlParsing(toml) => {
                message_buf.push_str(toml.message());
                char_line_range = toml.span().map(|r| range_to_pos(&r, &offsets));
            }
            _ => message_buf.push_str(&self.error.to_string()),
        };
        for context in &self.contexts {
            match context {
                Context::Dynamic(str) => message_buf.push_str(str),
                Context::Range(new_range) => {
                    // usually the new range is the one we want to use *but* the old range
                    // is strictly more specific than the new one, we keep the old range
                    if !(range.len() < new_range.len()
                        && (new_range.contains(&range.start) || new_range.contains(&range.end)))
                    {
                        range = new_range.clone();
                        let range_pos = range_to_pos(&range, &offsets);
                        char_line_range = Some(CharRange {
                            start: range_pos.start,
                            end: range_pos.end,
                        });
                    }
                }
                Context::ExpressionRange(new_range) => {
                    // we can now resolve the `Context::RhaiPosition`, which is relative to
                    // the start of an expression, to a specific file location, because we
                    // have the range of the full expression.
                    char_line_range = Some(range_to_pos(&new_range, &offsets));
                    char_line_range =
                        resolve_rhai_pos_from_expression_range(rhai_pos, char_line_range);
                }
                Context::RhaiPosition(pos) => {
                    // when we see a rhai range all we know is where, relative to the start
                    // of the expression the error was raised. We have to wait until a
                    // future iteration of this `for` loop when we find a specific file
                    // location where the expression begins.
                    rhai_pos = Some(pos.clone());
                }
            };
        }
        if let Some(cl_range) = char_line_range {
            return ErrorReport {
                message: message_buf,
                range: cl_range,
            };
        } else {
            return ErrorReport {
                message: format!(
                    "Failed to find range location for the message {}",
                    message_buf
                ),
                range: CharRange::default(),
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
}
