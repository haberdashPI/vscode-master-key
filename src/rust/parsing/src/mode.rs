#[allow(unused_imports)]
use log::info;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use toml::Spanned;
use wasm_bindgen::prelude::*;

use crate::bind::command::{Command, CommandInput};
use crate::error::{ErrorContext, RawError, ResultVec};
use crate::expression::Scope;
use crate::expression::value::BareValue;
use crate::resolve;
use crate::util::{LeafValue, Plural, Resolving};

/// @bindingField mode @description array describing behavior of keybinding modes
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
/// If you don't define ay keybinding modes an implicit mode is defined as follows:
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
    /// - `default`: whether this mode is the default when the editor is opened. There should
    ///   only be one default mode.
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
    whenNoBinding: WhenNoBindingInput,
}

impl Default for ModeInput {
    fn default() -> Self {
        return ModeInput {
            name: "default".to_string(),
            default: Some(true),
            highlight: None,
            cursorShape: None,
            whenNoBinding: WhenNoBindingInput::Insert,
        };
    }
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WhenNoBindingInput {
    #[default]
    Ignore,
    Insert,
    UseMode(Spanned<String>),
    Run(Plural<Spanned<CommandInput>>),
}

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

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
#[wasm_bindgen]
pub struct Mode {
    name: String,
    default: bool,
    highlight: ModeHighlight,
    cursorShape: CursorShape,
    whenNoBinding: WhenNoBinding,
}

#[derive(Clone, Debug, Serialize)]
pub enum WhenNoBinding {
    Ignore,
    Insert,
    UseMode(String),
    Run(Vec<Command>),
}

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

impl Mode {
    pub(crate) fn new(input: ModeInput, scope: &mut Scope) -> ResultVec<Self> {
        return Ok(Mode {
            name: resolve!(input, name, scope)?,
            default: resolve!(input, default, scope)?,
            highlight: resolve!(input, highlight, scope)?,
            cursorShape: resolve!(input, cursorShape, scope)?,
            whenNoBinding: resolve!(input, whenNoBinding, scope)?,
        });
    }

    pub(crate) fn vec(input: Vec<Spanned<ModeInput>>, scope: &mut Scope) -> ResultVec<Self> {
        let all_mode_names = HashSet::new();
        let default_mode = None;
        for mode in input {
            let mode_name = mode.as_ref().name;
            if all_mode_names.contains(&mode_name) {
                Err(RawError::Static("mode name must be unique")).with_range(&mode.span())?;
            }
            if mode.as_ref().default.unwrap_or_default() {
                if let Some(default) = default_mode {
                    return Err(RawError::Static("default mode already set"))
                        .with_range(&mode.span())?;
                }
                default_mode = Some(mode_name);
            }
            all_mode_names.insert(mode_name);
        }
        if let None = default_mode {
            // we `unwrap` here because we do not expect vec to ever get an
            // empty vector (the default contains a single mode)
            Err(RawError::Static("exactly one mode must be the default"))
                .with_range(&input.first().unwrap().span())?
        }

        let modes = HashMap::new();
        scope.private.insert(
            "modes",
            BareValue::Array(all_mode_names.iter().map(BareValue::String).collect()),
        );
        scope.register_fn("all_modes", || )
        for mode in input {}

        return input.resolve();
    }
}

impl Resolving<Mode> for ModeInput {
    fn resolve(self, _name: &'static str, scope: &mut Scope) -> ResultVec<Mode> {
        return Ok(Mode::new(self, scope)?);
    }
}
