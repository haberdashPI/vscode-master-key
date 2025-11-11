use crate::error::{Result, ResultVec};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Expression, TypedValue, Value};
use crate::util::{LeafValue, Merging, Plural, Resolving};

use serde::{Deserialize, Serialize};

// TODO: we could improve error messages here by implementing Deserialize ourselves
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum PrefixInput {
    AnyOf(Plural<TypedValue<String>>),
    AllBut(Plural<TypedValue<String>>),
    Any(TypedValue<bool>),
}

// impl Default for PrefixInput {
//     fn default() -> Self {
//         return PrefixInput::Any(TypedValue::Constant(false));
//     }
// }

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
