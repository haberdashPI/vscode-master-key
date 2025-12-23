#[allow(unused_imports)]
use log::info;

use rhai::{EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use toml::Spanned;
use wasm_bindgen::prelude::*;

use crate::bind::command::{Command, CommandInput};
use crate::bind::foreach::all_characters;
use crate::bind::{
    Binding, BindingCodes, BindingOutput, ReifiedBinding, TEXT_FOCUS_CONDITION, UNKNOWN_RANGE,
};
use crate::error::{Context, ErrorContext, ParseError, Result, ResultVec, err};
use crate::expression::Scope;
use crate::file::KeyFileResult;
use crate::resolve;
use crate::util::{LeafValue, Resolving};
use crate::{err, wrn};

/// @bindingField mode
/// @order -1
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
/// whenNoBinding = "insertCharacters"
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
/// whenNoBinding = "insertCharacters"
/// ```
///
/// ## Fields
///
/// The only required field for a mode is its name (marked with "❗") but there are a number
/// of optional fields that impact the behavior of the mode.

#[allow(non_snake_case)]
#[derive(Deserialize, Clone, Debug)]
pub struct ModeInput {
    /// @forBindingField mode
    ///
    /// - ❗`name`: The name of the mode; displayed in the bottom left corner of VSCode
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
    /// - `whenNoBinding`: How to respond to keys when there is no binding for them in this
    /// mode. The options are:
    ///   - `"ignoreCharacters"`: The mode will introduce implicit bindings that cause any
    ///     characters that are typed to be ignored. This is the default behavior when you
    ///     explicitly define a mode in your file.
    ///   - `"insertCharacters"`: The mode defines no implicit bindings. Pressing characters
    ///     will cause text to be inserted into a file, as usual. This is the default
    ///     behavior for the implicitly defined "default" mode. If you define modes
    ///     explicitly at least one of them must be set to `'insertCharacters'`; otherwise the
    ///     user could not type.
    ///   - `{"useMode": "[mode]"}`: fallback to the keybindings and behavior defined in
    ///     another mode.
    ///   - `{"run": [<commands>]}`: captures characters in the variable `key.captured`, a
    ///     string representing the key pressed. Then run the given commands, as per the
    ///     fields allowed when [running multiple commands](/bindings/bind#running-multiple-commands) in
    ///     `[[bind]]`.
    #[serde(default)]
    whenNoBinding: Option<Spanned<WhenNoBindingInput>>,

    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
}

impl Default for ModeInput {
    fn default() -> Self {
        return ModeInput {
            name: "default".to_string(),
            default: Some(true),
            highlight: None,
            cursorShape: None,
            whenNoBinding: Some(Spanned::new(
                UNKNOWN_RANGE,
                WhenNoBindingInput::InsertCharacters,
            )),
            other_fields: HashMap::new(),
        };
    }
}

#[derive(Clone, Debug, Default)]
pub enum WhenNoBindingInput {
    #[default]
    IgnoreCharacters,
    InsertCharacters,
    UseMode(String),
    Run(Vec<CommandInput>),
}

impl<'de> serde::de::Deserialize<'de> for WhenNoBindingInput {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Define a visitor struct
        struct WhenNoBindingInputVisitor;

        impl<'de> serde::de::Visitor<'de> for WhenNoBindingInputVisitor {
            type Value = WhenNoBindingInput;

            // This is our main custom error message!
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str(
                    "a string ('ignoreCharacters' or 'insertCharacters') or a single-key object ('useMode: <string>' or 'run: [<commands>]')",
                )
            }

            // Handles the unit variants: "ignore" and "insert"
            fn visit_str<E>(self, v: &str) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match v {
                    "ignoreCharacters" => Ok(WhenNoBindingInput::IgnoreCharacters),
                    "insertCharacters" => Ok(WhenNoBindingInput::InsertCharacters),
                    other => Err(serde::de::Error::custom(format_args!(
                        "unexpected string value '{}', expected 'ignoreCharacters' or 'insertCharacters'",
                        other
                    ))),
                }
            }

            // Handles the newtype variants: UseMode(String) and Run(...)
            fn visit_map<A>(self, mut map: A) -> std::result::Result<Self::Value, A::Error>
            where
                A: serde::de::MapAccess<'de>,
            {
                // We expect exactly one key
                let key: String = match map.next_key()? {
                    Some(key) => key,
                    Option::None => {
                        return Err(serde::de::Error::custom(
                            "expected object with one key ('useMode' or 'run'), but got empty object",
                        ));
                    }
                };

                // Deserialize the value based on the key
                let result = match key.as_str() {
                    "useMode" => {
                        let val = map.next_value::<String>()?;
                        Ok(WhenNoBindingInput::UseMode(val))
                    }
                    "run" => {
                        let val = map.next_value::<Vec<CommandInput>>()?;
                        Ok(WhenNoBindingInput::Run(val))
                    }
                    other => Err(serde::de::Error::custom(format_args!(
                        "unknown key `{other}`, expected 'useMode' or 'run'",
                    ))),
                }?;

                // Check for any extra keys, which is an error
                if let Some(next_key) = map.next_key::<String>()? {
                    return Err(serde::de::Error::custom(format_args!(
                        "expected object with only one key but found extra key `{next_key}`",
                    )));
                }

                Ok(result)
            }
        }

        // Tell Serde we can deserialize from *either* a string or a map.
        // `deserialize_any` will call the appropriate visitor method.
        deserializer.deserialize_any(WhenNoBindingInputVisitor)
    }
}

impl LeafValue for WhenNoBindingInput {}

#[wasm_bindgen]
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
pub enum ModeHighlight {
    #[default]
    NoHighlight,
    Highlight,
    Alert,
}
impl LeafValue for ModeHighlight {}

#[wasm_bindgen]
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
#[wasm_bindgen(getter_with_clone)]
pub struct Mode {
    pub name: String,
    pub default: bool,
    pub highlight: ModeHighlight,
    pub cursorShape: CursorShape,
    pub(crate) whenNoBinding: WhenNoBinding,
}

#[wasm_bindgen]
#[cfg_attr(coverage_nightly, coverage(off))]
impl Mode {
    #[allow(non_snake_case)]
    pub fn whenNoBinding(&self) -> WhenNoBindingHeader {
        return match &self.whenNoBinding {
            WhenNoBinding::IgnoreCharacters => WhenNoBindingHeader::IgnoreCharacters,
            WhenNoBinding::InsertCharacters => WhenNoBindingHeader::InsertCharacters,
            WhenNoBinding::UseMode(_) => WhenNoBindingHeader::UseMode,
            WhenNoBinding::Run(_) => WhenNoBindingHeader::Run,
        };
    }

    pub fn run_commands(&self, bindings: &mut KeyFileResult) -> ReifiedBinding {
        if let WhenNoBinding::Run(commands) = &self.whenNoBinding {
            return ReifiedBinding::from_commands(
                commands.iter().map(Command::clone).collect(),
                &bindings.scope,
            );
        } else {
            return ReifiedBinding::noop(&bindings.scope);
        }
    }
}

#[derive(Clone, Debug, Serialize, Default, PartialEq)]
pub enum WhenNoBinding {
    #[default]
    IgnoreCharacters,
    InsertCharacters,
    UseMode(String),
    Run(Vec<Command>),
}

#[wasm_bindgen]
pub enum WhenNoBindingHeader {
    IgnoreCharacters,
    InsertCharacters,
    UseMode,
    Run,
}

// TODO: figure out type script interface to WhenNoBinding

impl LeafValue for WhenNoBinding {}

impl Resolving<WhenNoBinding> for WhenNoBindingInput {
    fn resolve(self, name: &'static str, scope: &mut Scope) -> ResultVec<WhenNoBinding> {
        return Ok(match self {
            WhenNoBindingInput::IgnoreCharacters => WhenNoBinding::IgnoreCharacters,
            WhenNoBindingInput::InsertCharacters => WhenNoBinding::InsertCharacters,
            WhenNoBindingInput::UseMode(mode) => WhenNoBinding::UseMode(mode.resolve(name, scope)?),
            WhenNoBindingInput::Run(commands) => WhenNoBinding::Run(commands.resolve(name, scope)?),
        });
    }
}

#[wasm_bindgen]
impl Mode {
    pub(crate) fn new(
        input: ModeInput,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Self> {
        if let Some(ref x) = input.whenNoBinding {
            let span = x.span().clone();
            if let WhenNoBindingInput::UseMode(mode) = x.as_ref() {
                if !scope.modes.contains(mode) {
                    Err(err!("mode `{mode}` is not defined")).with_range(&span)?;
                }
            }
        }

        // warning about unknown fields
        for (key, _) in &input.other_fields {
            let err: Result<()> = Err(wrn!(
                "The field `{}` is unrecognized and will be ignored",
                key,
            ));
            warnings.push(err.unwrap_err());
        }

        return Ok(Mode {
            name: resolve!(input, name, scope)?,
            default: resolve!(input, default, scope)?,
            highlight: resolve!(input, highlight, scope)?,
            cursorShape: resolve!(input, cursorShape, scope)?,
            whenNoBinding: resolve!(input, whenNoBinding, scope)?,
        });
    }

    fn create_ignore_characters(name: &str, scope: &Scope, result: &mut Vec<BindingOutput>) {
        for k in all_characters() {
            let when: String;
            if name != &scope.default_mode {
                when = format!("master-key.mode == '{}' && {TEXT_FOCUS_CONDITION}", name)
            } else {
                when = format!(
                    "(!master-key.mode || master-key.mode == '{}') && {TEXT_FOCUS_CONDITION}",
                    name
                )
            }
            result.push(BindingOutput::Ignore {
                key: k,
                when: Some(when),
            });
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[wasm_bindgen(getter_with_clone)]
pub struct Modes {
    pub(crate) map: HashMap<String, Mode>,
    pub default: String,
}

impl Modes {
    pub(crate) fn new(
        input: Vec<Spanned<ModeInput>>,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Self> {
        // define the set of available modes
        let mut all_mode_names = HashSet::new();
        let mut default_mode = None;
        let mut first_mode_span = UNKNOWN_RANGE;
        for mode in &input {
            if first_mode_span == UNKNOWN_RANGE {
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
            if mode_name == "capture" {
                return Err(err!(
                    "The mode `capture` is implicitly defined, and should never \
                                be defined by the user."
                ))
                .with_range(&mode.span())?;
            }
            all_mode_names.insert(mode_name);
        }
        if let Option::None = default_mode {
            // we `unwrap` here because we do not expect vec to ever get an
            // empty vector (the default contains a single mode)
            Err(err("exactly one mode must be the default")).with_range(&first_mode_span)?
        }

        let old_modes = scope.modes.clone();
        let old_default_mode = scope.default_mode.clone();
        scope.modes = all_mode_names;
        scope.default_mode = default_mode.clone().unwrap();

        // create `Mode` objects
        let mut modes = HashMap::new();
        for mode in input {
            let span = mode.span().clone();
            let mut mode_warnings = Vec::new();
            modes.insert(
                mode.as_ref().name.clone(),
                match Mode::new(mode.into_inner(), scope, &mut mode_warnings).with_range(&span) {
                    Ok(x) => x,
                    Err(e) => {
                        // if we fail to define the modes revert the mode information stored
                        // in scope
                        scope.modes = old_modes;
                        scope.default_mode = old_default_mode;
                        return Err(e);
                    }
                },
            );
            mode_warnings
                .iter_mut()
                .for_each(|w| w.contexts.push(Context::Range(span.clone())));
            warnings.append(&mut mode_warnings)
        }

        // validate that at least one mode allows the user to type keys
        if !modes
            .iter()
            .any(|(_, m)| m.whenNoBinding == WhenNoBinding::InsertCharacters)
        {
            match Err(err(
                "`whenNoBinding='insertCharacters'` must be set for at least one mode; \
                 otherwise the user cannot type",
            ))
            .with_range(&first_mode_span)
            {
                Ok(x) => x,
                Err(e) => {
                    // if we fail to define the modes revert the mode information stored
                    // in scope
                    scope.modes = old_modes;
                    scope.default_mode = old_default_mode;
                    return Err(e.into());
                }
            }
        }

        let all_modes_fn_data = scope.modes.clone();
        scope.engine.register_fn("all_modes", move || {
            all_modes_fn_data
                .iter()
                .map(|x| rhai::Dynamic::from(ImmutableString::from(x)))
                .collect::<rhai::Array>()
        });
        let not_modes_fn_data = scope.modes.clone();
        scope.engine.register_fn(
            "not_modes",
            move |x: rhai::Array| -> std::result::Result<rhai::Array, Box<EvalAltResult>> {
                let not_modes = x
                    .into_iter()
                    .map(|xi| xi.into_immutable_string())
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let mut result = rhai::Array::new();
                for mode in &not_modes_fn_data {
                    if not_modes.iter().all(|x| x != mode) {
                        result.push(rhai::Dynamic::from(ImmutableString::from(mode)));
                    }
                }
                if result.len() == (&not_modes_fn_data).len() {
                    let mut bad_mode = None;
                    for mode in not_modes {
                        if (&not_modes_fn_data).iter().all(|x| x != mode) {
                            bad_mode = Some(mode);
                            break;
                        }
                    }
                    return Err(format!("mode `{}` does not exist", bad_mode.unwrap()).into());
                }
                return Ok(result);
            },
        );

        // add the implicit `capture` mode
        modes.insert(
            "capture".to_string(),
            Mode {
                name: "capture".to_string(),
                default: false,
                highlight: ModeHighlight::NoHighlight,
                cursorShape: CursorShape::Underline,
                whenNoBinding: WhenNoBinding::InsertCharacters,
            },
        );

        return Ok(Modes {
            map: modes,
            default: default_mode.unwrap(),
        });
    }

    pub fn get(&self, x: &str) -> Option<&Mode> {
        return self.map.get(x);
    }

    fn ignore_character_bindings_helper(
        &self,
        mode: &str,        // the mode whose whenNoBinding we're looking up
        parent_mode: &str, // the mode we're writing bindings for (could be different because of the `UseMode` option)
        scope: &Scope,     // we need this to know what the default mode is
        result: &mut Vec<BindingOutput>,
    ) {
        return match &self.map.get(mode) {
            Some(Mode {
                whenNoBinding: WhenNoBinding::IgnoreCharacters,
                ..
            }) => Mode::create_ignore_characters(parent_mode, scope, result),
            Some(Mode {
                whenNoBinding: WhenNoBinding::InsertCharacters,
                ..
            }) => (),
            Some(Mode {
                whenNoBinding: WhenNoBinding::Run(_),
                ..
            }) => (),
            Some(Mode {
                whenNoBinding: WhenNoBinding::UseMode(fallback),
                ..
            }) => {
                Modes::ignore_character_bindings_helper(self, fallback, parent_mode, scope, result)
            }
            Option::None => (),
        };
    }

    pub(crate) fn ignore_character_bindings(&self, scope: &Scope) -> Vec<BindingOutput> {
        let mut result = Vec::new();
        for mode in self.map.keys() {
            Modes::ignore_character_bindings_helper(self, mode, mode, scope, &mut result);
        }
        return result;
    }

    pub(crate) fn insert_implicit_mode_bindings(
        &self,
        bindings: &Vec<Binding>,
        scope: &Scope,
        codes: &mut BindingCodes,
        key_bind: &mut Vec<BindingOutput>,
    ) {
        // and keybindings to ignore characters if the mode (or its fallback) requests it
        key_bind.append(&mut self.ignore_character_bindings(scope)); // fallback bindings: these are the

        // and implicit keybindings for any fallback mode (ala `useMode`).
        let mut fallback_for: HashMap<String, Vec<&str>> = HashMap::new();
        for (_, mode) in &self.map {
            if let Mode {
                whenNoBinding: WhenNoBinding::UseMode(fallback_to),
                ..
            } = mode
            {
                fallback_for
                    .entry(fallback_to.clone())
                    .and_modify(|from| from.push(&mode.name))
                    .or_insert_with(|| vec![&mode.name]);
            }
        }

        // TODO: this logic is reversed: we need to propagate e.g. normal keys to a mode
        // that fall back to normal, not propagate back that modes keys to normal
        for (id, bind) in bindings.iter().enumerate() {
            let mut implicit_modes = Vec::new();
            for mode in &bind.mode {
                if let Some(fallback_from) = fallback_for.get(mode) {
                    for from in fallback_from {
                        implicit_modes.push(String::from(*from));
                    }
                }
            }
            let mut implicit_bind = bind.clone();
            implicit_bind.mode = implicit_modes;
            implicit_bind.implicit = true;
            let mut output = match implicit_bind.outputs(id as i32, &scope, None, codes) {
                Ok(x) => x,
                // silently ignore errors; these will be reported for the explicit bindings
                Err(_) => Vec::new(),
            };
            key_bind.append(&mut output);
        }
    }
}

impl Default for Modes {
    fn default() -> Self {
        return Modes {
            map: HashMap::from([(
                "default".to_string(),
                Mode {
                    name: "default".to_string(),
                    default: true,
                    highlight: ModeHighlight::default(),
                    cursorShape: CursorShape::default(),
                    whenNoBinding: WhenNoBinding::InsertCharacters,
                },
            )]),
            default: "default".to_string(),
        };
    }
}
