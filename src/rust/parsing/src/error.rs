use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("parsing failed with {0}")]
    Parsing(#[from] toml::de::Error),
    #[error("validation failed with {0}")]
    Validation(#[from] validator::ValidationError),
    #[error("expected {0}")]
    ConstraintError(&'static str),
    #[error("expected error binding rust values to javascript - {0}")]
    JavaScriptError(#[from] serde_wasm_bindgen::Error),
    #[error("required field `{0}`")]
    RequiredField(&'static str),
    #[error("unexpected {0}")]
    Unexpected(&'static str),
}

pub trait Constrainable<T> {
    fn constrain(self, context: &'static str) -> Result<T>;
}

impl<T> Constrainable<T> for Option<T> {
    fn constrain(self, context: &'static str) -> Result<T> {
        return match self {
            None => Err(Error::ConstraintError(context)),
            Some(result) => Ok(result),
        };
    }
}

pub trait ConstrainArray<R> {
    fn constrain_array(self, context: &'static str) -> Result<R>;
}

impl ConstrainArray<Vec<toml::Value>> for toml::Value {
    fn constrain_array(self, context: &'static str) -> Result<Vec<toml::Value>> {
        return match self {
            toml::Value::Array(items) => Ok(items),
            _ => Err(Error::ConstraintError(context)),
        };
    }
}

pub trait ConstraintString<R> {
    fn constrain_string(self, context: &'static str) -> Result<R>;
}

impl ConstraintString<String> for toml::Value {
    fn constrain_string(self, context: &'static str) -> Result<String> {
        return match self {
            toml::Value::String(x) => Ok(x),
            _ => Err(Error::ConstraintError(context)),
        };
    }
}

pub type Result<T> = std::result::Result<T, Error>;
