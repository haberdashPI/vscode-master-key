#[allow(unused_imports)]
use log::info;

use rhai::{EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use toml::Spanned;
use wasm_bindgen::prelude::*;

use crate::bind::UNKNOWN_RANGE;
use crate::bind::command::{Command, CommandInput};
use crate::err;
use crate::error::{ErrorContext, ResultVec, err};
use crate::expression::Scope;
use crate::resolve;
use crate::util::{LeafValue, Plural, Resolving};

/// @bindingField mode
/// @description array describing behavior of keybinding modes
///
/// The `mode` element defines a distinct keybinding mode. Like vim modes, they affect which
/// keybindings are currently active.
///
/// **Example**
///
/// ```toml
/// [[mode]]
/// name = "normal"
/// default = true
/// cursorShape = "Block"
/// highlight = "Highlight"
///
/// [[mode]]
/// name = "insert"
/// cursorShape = "Line"
/// highlight = "NoHighlight"
/// whenNoBinding = "insert"
/// ```
///
/// If no keybinding modes are defined, an implicit mode is defined as follows:
///
/// ```toml
/// [[mode]]
/// name = "default"
/// default = true
/// cursorShape = "Line"
/// highlight = "NoHighlight"
/// whenNoBinding = "insert"
/// ```
///
/// ## Fields
///
/// The only required field for a mode is its name (marked with "*") but there are a number
/// of optional fields that impact the behavior of the mode.

#[allow(non_snake_case)]
#[derive(Deserialize, Clone, Debug)]
pub struct ModeInput {
    /// @forBindingField mode
    ///
    /// - `name`*: The name of the mode; displayed in the bottom left corner of VSCode
    name: String,

    /// @forBindingField mode
    ///
    /// - `default`: whether this mode is the default when the editor is opened. There
    ///   should be exactly one default mode. All keybindings without an explicit
    ///   mode are defined to use this mode.
    default: Option<bool>,
    /// @forBindingField mode
    ///
    /// - `highlight`: Whether and how to highlight the name of this mode in the bottom left
    ///   corner of VSCode. Possible values are:
    ///     - `NoHighlight` does not add coloring
    ///     - `Highlight` adds warning related colors (usually orange)
    ///     - `Alert` adds error related colors (usually red)
    highlight: Option<ModeHighlight>,
    /// @forBindingField mode
    ///
    /// - `cursorShape`: The shape of the cursor when in this mode. One of the following:
    ///   - `Line`
    ///   - `Block`
    ///   - `Underline`
    ///   - `LineThin`
    ///   - `BlockOutline`
    ///   - `UnderlineThin`
    cursorShape: Option<CursorShape>,
    /// @forBindingField mode
    ///
    /// - `whenNoBinding`: How to respond to keys when there is no key binding in this mode.
    /// The options are
    ///   - `"ignore"`: Prevent the key from doing anything. This is the default when you
    ///      explicitly define a mode
    ///   - `"insert"`: The keys should insert text. This is true for the implicitly defined
    ///      "default" mode.
    ///   - `"useMode": "[mode]"`: fallback to the keybindings defined for another mode
    ///   - `"run": <command> | [<commands>]`: set `key.capture` to a string representing
    ///     the key pressed and run the given command or commands, as per the fields allowed
    ///     when [running multiple commands](#running-multiple-commands) in `[[bind]]`.
    #[serde(default)]
    whenNoBinding: Option<Spanned<WhenNoBindingInput>>,
}

impl Default for ModeInput {
    fn default() -> Self {
        return ModeInput {
            name: "default".to_string(),
            default: Some(true),
            highlight: None,
            cursorShape: None,
            whenNoBinding: Some(Spanned::new(UNKNOWN_RANGE, WhenNoBindingInput::Insert)),
        };
    }
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WhenNoBindingInput {
    #[default]
    Ignore,
    Insert,
    UseMode(String),
    Run(Plural<CommandInput>),
}

impl LeafValue for WhenNoBindingInput {}

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
pub enum ModeHighlight {
    #[default]
    NoHighlight,
    Highlight,
    Alert,
}
impl LeafValue for ModeHighlight {}

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
pub enum CursorShape {
    #[default]
    Line,
    Block,
    Underline,
    LineThin,
    BlockOutline,
    UnderlineThin,
}
impl LeafValue for CursorShape {}

// TODO: get wasm interface worked out
#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
pub struct Mode {
    pub name: String,
    pub default: bool,
    pub highlight: ModeHighlight,
    pub cursorShape: CursorShape,
    pub whenNoBinding: WhenNoBinding,
}

#[derive(Clone, Debug, Serialize, Default, PartialEq)]
pub enum WhenNoBinding {
    #[default]
    Ignore,
    Insert,
    UseMode(String),
    Run(Vec<Command>),
}

impl LeafValue for WhenNoBinding {}

impl Resolving<WhenNoBinding> for WhenNoBindingInput {
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<WhenNoBinding> {
        return Ok(match self {
            WhenNoBindingInput::Ignore => WhenNoBinding::Ignore,
            WhenNoBindingInput::Insert => WhenNoBinding::Insert,
            WhenNoBindingInput::UseMode(mode) => WhenNoBinding::UseMode(mode.resolve(name, scope)?),
            WhenNoBindingInput::Run(commands) => WhenNoBinding::Run(commands.resolve(name, scope)?),
        });
    }
}

#[wasm_bindgen]
impl Mode {
    pub(crate) fn new(input: ModeInput, scope: &mut Scope) -> ResultVec<Self> {
        if let Some(ref x) = input.whenNoBinding {
            let span = x.span().clone();
            if let WhenNoBindingInput::UseMode(mode) = x.as_ref() {
                if !scope.modes.contains(mode) {
                    Err(err!("mode `{mode}` is not defined")).with_range(&span)?;
                }
            }
        }
        return Ok(Mode {
            name: resolve!(input, name, scope)?,
            default: resolve!(input, default, scope)?,
            highlight: resolve!(input, highlight, scope)?,
            cursorShape: resolve!(input, cursorShape, scope)?,
            whenNoBinding: resolve!(input, whenNoBinding, scope)?,
        });
    }
}

#[derive(Serialize, Clone, Debug)]
#[wasm_bindgen(getter_with_clone)]
pub struct Modes {
    map: HashMap<String, Mode>,
    pub default: String,
}

impl Modes {
    pub(crate) fn new(input: Vec<Spanned<ModeInput>>, scope: &mut Scope) -> ResultVec<Self> {
        // define the set of available modes
        let mut all_mode_names = HashSet::new();
        let mut default_mode = None;
        let mut first_mode_span = UNKNOWN_RANGE;
        for mode in &input {
            if first_mode_span != UNKNOWN_RANGE {
                first_mode_span = mode.span().clone();
            }
            let mode_name = mode.as_ref().name.clone();
            if all_mode_names.contains(&mode_name) {
                Err(err("mode name is not unique")).with_range(&mode.span())?;
            }
            if mode.as_ref().default.unwrap_or_default() {
                if let Some(old_default) = default_mode {
                    return Err(err!("default mode already set to `{old_default}"))
                        .with_range(&mode.span())?;
                }
                default_mode = Some(mode_name.clone());
            }
            all_mode_names.insert(mode_name);
        }
        if let Option::None = default_mode {
            // we `unwrap` here because we do not expect vec to ever get an
            // empty vector (the default contains a single mode)
            Err(err("exactly one mode must be the default")).with_range(&first_mode_span)?
        }

        // make the set of available modes accessible to expressions
        let rhai_mode_names: HashSet<_> = all_mode_names.iter().collect();
        scope.modes = all_mode_names;
        scope.default_mode = default_mode.clone().unwrap();

        let all_modes_fn_data = rhai_mode_names.clone();
        scope.engine.register_fn("all_modes", move || {
            all_modes_fn_data
                .iter()
                .map(|x| rhai::Dynamic::from(scope.engine.get_interned_string(x)))
                .collect::<rhai::Array>()
        });
        scope.engine.register_fn(
            "all_modes_but",
            move |x: rhai::Array| -> std::result::Result<rhai::Array, Box<EvalAltResult>> {
                let strings = x
                    .into_iter()
                    .map(|xi| xi.into_immutable_string())
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let mut missing_modes = strings
                    .iter()
                    .filter(|str_i| !rhai_mode_names.contains(str_i));
                if let Some(missing_mode) = missing_modes.next() {
                    return Err(format!("mode `{missing_mode}` does not exist").into());
                }
                return Ok(rhai_mode_names
                    .clone()
                    .difference(&strings.into_iter().collect::<HashSet<_>>())
                    .map(rhai::Dynamic::from)
                    .collect::<rhai::Array>());
            },
        );

        // create `Mode` objects
        let mut modes = HashMap::new();
        for mode in input {
            let span = mode.span().clone();
            modes.insert(
                mode.as_ref().name.clone(),
                Mode::new(mode.into_inner(), scope).with_range(&span)?,
            );
        }

        return Ok(Modes {
            map: modes,
            default: default_mode.unwrap(),
        });
    }

    pub fn get(&self, x: &str) -> Option<&Mode> {
        return self.map.get(x);
    }
}

impl Default for Modes {
    fn default() -> Self {
        return Modes {
            map: HashMap::new(),
            default: "default".to_string(),
        };
    }
}

impl Resolving<Mode> for ModeInput {
    fn resolve(self, _name: &'static str, scope: &mut Scope) -> ResultVec<Mode> {
        return Ok(Mode::new(self, scope)?);
    }
}
