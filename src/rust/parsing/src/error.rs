use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Parsing Error: {0}")]
    Parsing(#[from] toml::de::Error),
    #[error("Validation Error: {0}")]
    Validation(#[from] validator::ValidationError),
    #[error("Unexpected error binding rust values to javascript: {0}")]
    JavaScriptError(#[from] serde_wasm_bindgen::Error),
    #[error("Missing required field `{0}`")]
    RequiredField(&'static str),
    #[error("Unexpected error: {0}")]
    Unexpected(&'static str),
}

pub type Result<T> = std::result::Result<T, Error>;
