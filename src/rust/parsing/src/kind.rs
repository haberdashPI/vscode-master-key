#[allow(unused_imports)]
use log::info;

use serde::Deserialize;
use std::collections::HashMap;
use toml::Spanned;

use crate::err;
use crate::error::{ErrorContext, ResultVec};
use crate::expression::Scope;

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

#[derive(Deserialize, Clone, Debug)]
pub struct Kind {
    name: String,
    description: String,
}

impl Kind {
    pub(crate) fn process(
        input: &Option<Vec<Spanned<Kind>>>,
        scope: &mut Scope,
    ) -> ResultVec<HashMap<String, String>> {
        let mut kinds = HashMap::new();
        if let Some(input) = input {
            for kind in input.iter() {
                let span = kind.span().clone();
                let kind_input = kind.as_ref();
                if kinds.contains_key(&kind_input.name) {
                    return Err(err!("Kind `name` must be unique.")).with_range(&span)?;
                }

                kinds.insert(kind_input.name.clone(), kind_input.description.clone());
            }
            scope.kinds = kinds.keys().map(|x| x.clone()).collect();
            return Ok(kinds);
        } else {
            return Ok(HashMap::new());
        }
    }
}
