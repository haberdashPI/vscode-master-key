use std::fmt;
use string_offsets::{Pos, StringOffsets};
use thiserror::Error;
use wasm_bindgen::prelude::*;

use crate::bind::UNKNOWN_RANGE;
use core::ops::Range;

// TODO: properly handle `WhileTrying` (e.g. by having an outer type to prevent nesting)

#[derive(Debug, Error, Clone)]
pub enum Error {
    #[error("parsing {0}")]
    Parsing(#[from] toml::de::Error),
    #[error("validating {0}")]
    Validation(#[from] validator::ValidationError),
    #[error("expected {0}")]
    ConstraintError(&'static str),
    #[error("requires {0}")]
    RequiredField(&'static str),
    #[error("unexpected {0}")]
    Unexpected(&'static str),
    #[error("parsing regex failed with {0}")]
    Regex(#[from] regex::Error),
}

// TODO: figure out how to expose errors in wasm
// (maybe we output some regular formatting structure rather than individual error types)
#[wasm_bindgen]
#[derive(Debug, Error, Clone)]
pub struct ErrorWithContext {
    #[source]
    error: Error,
    contexts: Vec<Context>,
}

fn range_to_pos(range: Range<usize>, offsets: &StringOffsets) -> CharRange {
    let start = offsets.utf8_to_char_pos(range.start);
    let end = offsets.utf8_to_char_pos(range.end);
    CharRange { start, end }
}

#[wasm_bindgen]
impl ErrorWithContext {
    pub fn report(&self, content: &str) -> ErrorReport {
        let mut items = Vec::with_capacity(self.contexts.len() + 1);
        let offsets: StringOffsets = StringOffsets::new(content);
        items.push(match &self.error {
            Error::Parsing(toml) => ErrorReportItem {
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
                Context::Range(range) => ErrorReportItem {
                    message: None,
                    range: Some(range_to_pos(range.clone(), &offsets)),
                },
            };
            items.push(item);
        }
        return ErrorReport { items };
    }
}

#[derive(Debug, Clone)]
#[wasm_bindgen(getter_with_clone)]
pub struct ErrorReport {
    pub items: Vec<ErrorReportItem>,
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
                    write!(f, "{}\n", str);
                }
                Context::Range(range) => {
                    // TODO: we may evenutally wan to support showing the text
                    // here. *HOWEVER* this is something we can also do downstream
                    // with the document class in vscode so probably not necessary
                    write!(f, "byte range {:?}\n", range);
                }
            }
        }
        self.error.fmt(f);
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

pub fn constrain<T>(msg: &'static str) -> Result<T> {
    return Err(Error::ConstraintError(msg))?;
}

pub fn unexpected<T>(msg: &'static str) -> Result<T> {
    return Err(Error::Unexpected(msg))?;
}

pub trait ErrorContext<T> {
    fn context(self, context: Context) -> Result<T>;
}

impl<T, E: Into<Error>> ErrorContext<T> for std::result::Result<T, E> {
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

pub type Result<T> = std::result::Result<T, ErrorWithContext>;
