use crate::error::{Result, ResultVec};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Expression, TypedValue, Value};
use crate::util::{LeafValue, Merging, Plural, Resolving};

use serde::{Deserialize, Serialize};
use toml::Spanned;

// see the documentation for the `prefix` field in `BindingInput`

// DESIGN NOTE: the rust code follows a pattern across several TOML-defined top level
// fields. There is a `[Type]Input` and `[Type]` object where `[Type]Input` contains useful
// information for generating error messages and may have partially defined fields. These
// are then merged/resolved with information from other sections of the parsed file and the
// final data is passed to a constructor for `[Type]`. This constructor will return `Err`
// objects if required fields are missing and the final result is in a format that is
// relatively ergonomic for accessing field values, because the values have already been
// validated

// TODO: we could improve error messages here by implementing Deserialize ourselves
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum PrefixInput {
    AnyOf(Spanned<TypedValue<Plural<String>>>),
    AllBut(Spanned<TypedValue<Plural<String>>>),
    Any(TypedValue<bool>),
}

#[derive(Serialize, Clone, Debug)]
pub enum Prefix {
    AnyOf(Vec<String>),
    AllBut(Vec<String>),
    Any(bool),
}

impl Default for Prefix {
    fn default() -> Self {
        return Prefix::Any(false);
    }
}

impl LeafValue for Prefix {}

impl Resolving<Prefix> for PrefixInput {
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<Prefix> {
        return match self {
            PrefixInput::AnyOf(pl) => Ok(Prefix::AnyOf(pl.resolve(name, scope)?)),
            PrefixInput::AllBut(pl) => Ok(Prefix::AllBut(pl.resolve(name, scope)?)),
            PrefixInput::Any(f) => Ok(Prefix::Any(f.resolve(name, scope)?)),
        };
    }
}

impl Expanding for PrefixInput {
    fn is_constant(&self) -> bool {
        return match self {
            PrefixInput::AnyOf(x) => x.is_constant(),
            PrefixInput::AllBut(x) => x.is_constant(),
            PrefixInput::Any(x) => x.is_constant(),
        };
    }

    fn map_expressions<F>(self, f: &mut F) -> ResultVec<Self>
    where
        Self: Sized,
        F: FnMut(Expression) -> Result<Value>,
    {
        return match self {
            PrefixInput::AnyOf(x) => Ok(PrefixInput::AnyOf(x.map_expressions(f)?)),
            PrefixInput::AllBut(x) => Ok(PrefixInput::AllBut(x.map_expressions(f)?)),
            PrefixInput::Any(x) => Ok(PrefixInput::Any(x.map_expressions(f)?)),
        };
    }
}

impl Merging for PrefixInput {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, new: Self) -> Self {
        return new;
    }
}
