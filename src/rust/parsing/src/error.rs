use std::fmt;
use thiserror::Error;

// TODO: properly handle `WhileTrying` (e.g. by having an outer type to prevent nesting)

#[derive(Debug, Error)]
pub enum Error {
    #[error("parsing {0}")]
    Parsing(#[from] toml::de::Error),
    #[error("validating {0}")]
    Validation(#[from] validator::ValidationError),
    #[error("expected {0}")]
    ConstraintError(&'static str),
    #[error("unexpected error binding rust values to javascript - {0}")]
    JavaScriptError(#[from] serde_wasm_bindgen::Error),
    #[error("required field `{0}`")]
    RequiredField(&'static str),
    #[error("unexpected {0}")]
    Unexpected(&'static str),
    #[error("parsing regex failed with {0}")]
    Regex(#[from] regex::Error),
}

#[derive(Debug, Error)]
pub struct ErrorWithContext {
    #[source]
    error: Error,
    contexts: Vec<&'static str>,
}

impl fmt::Display for ErrorWithContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> std::result::Result<(), fmt::Error> {
        for context in &self.contexts {
            write!(f, "{}\n", context);
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
    fn context(self, context: &'static str) -> Result<T>;
}

impl<T, E: Into<Error>> ErrorContext<T> for std::result::Result<T, E> {
    fn context(self, context: &'static str) -> Result<T> {
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
    fn context(self, context: &'static str) -> Result<T> {
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
