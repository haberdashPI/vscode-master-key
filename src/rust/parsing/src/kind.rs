#[allow(unused_imports)]
use log::info;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use toml::Spanned;
use wasm_bindgen::prelude::*;

use crate::error::{ErrorContext, ParseError, Result, ResultVec};
use crate::expression::Scope;
use crate::{err, wrn};

/// @forBindingField kind
///
/// Kind is a broad category for keybindings that is displayed as part of the visual
/// documentation for key bindings. There should be no more than 5 or so kinds, since they are
/// differentiated via colors. Furthermore, *not* knowing the kind of a keybinding
/// should never cause the meaning of a key to be ambiguous; they are meant as a visual
/// aid.
///
/// **Example**
///
/// ```toml
/// [[kind]]
/// name = "action"
///
/// [[kind]]
/// name = "motion"
///
/// [[bind]]
/// kind = "action"
/// key = "d"
/// command = "deleteLeft"
///
/// [[bind]]
/// kind = "motion"
/// key = "l"
/// command = "cursorLeft"
/// ```

#[derive(Serialize, Deserialize, Clone, Debug)]
#[wasm_bindgen(getter_with_clone)]
pub struct Kind {
    pub name: String,
    pub description: String,
    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
}

impl Kind {
    pub(crate) fn process(
        input: &Option<Vec<Spanned<Kind>>>,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Vec<Kind>> {
        let mut known_kinds = HashSet::new();
        if let Some(input) = input {
            for kind in input.iter() {
                let span = kind.span().clone();
                let kind_input = kind.as_ref();
                if known_kinds.contains(&kind_input.name) {
                    return Err(err!("Kind `name` must be unique.")).with_range(&span)?;
                }

                // warning about unknown fields
                for (key, _) in &kind_input.other_fields {
                    let err: Result<()> = Err(wrn!(
                        "The field `{}` is unrecognized and will be ignored",
                        key,
                    ))
                    .with_range(&span);
                    warnings.push(err.unwrap_err());
                }

                known_kinds.insert(kind_input.name.clone());
            }
            scope.kinds = input.iter().map(|x| x.as_ref().name.clone()).collect();
            return Ok(input.iter().map(|x| x.as_ref().clone()).collect());
        } else {
            return Ok(Vec::new());
        }
    }
}
