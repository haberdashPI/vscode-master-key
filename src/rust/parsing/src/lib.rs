#![cfg_attr(coverage_nightly, feature(coverage_attribute))]

// assorted utilities
mod error;
mod expression;
mod util;

// define file sections
mod bind;
mod define;
mod kind;
mod mode;

// top level parsing
pub mod file;
