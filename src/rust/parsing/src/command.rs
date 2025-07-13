#![allow(non_snake_case)]

use crate::error::{Error, Result};

use lazy_static::lazy_static;
use regex::Regex;
use serde::de::Unexpected;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::Value;
use validator::{Validate, ValidationError};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn debug_parse_command(command_str: &str) -> std::result::Result<Command, JsError> {
    let result = toml::from_str::<CommandInput>(command_str)?;
    return Ok(Command::new(result)?);
}

// ----------------------------------
// Validate TOML table structure

fn valid_json_array(values: &Vec<toml::Value>) -> std::result::Result<(), ValidationError> {
    return values.iter().try_for_each(valid_json_value);
}

fn valid_json_object(kv: &toml::Table) -> std::result::Result<(), ValidationError> {
    return kv.iter().try_for_each(|(_, v)| valid_json_value(v));
}

// we read in TOML values, but only want to accept JSON-valid values in some contexts
// (since that is what we'll be serializing out to)
fn valid_json_value(x: &Value) -> std::result::Result<(), ValidationError> {
    match x {
        Value::Integer(_) | Value::Float(_) | Value::Boolean(_) | Value::String(_) => {
            return Ok(());
        }
        Value::Datetime(_) => {
            return Err(ValidationError::new("DateTime values are not supported"));
        }
        Value::Array(values) => return valid_json_array(values),
        Value::Table(kv) => return valid_json_object(kv),
    };
}

fn valid_json_array_object(kv: &toml::Table) -> std::result::Result<(), ValidationError> {
    return kv.iter().try_for_each(|(_, v)| valid_json_value(v));
}

trait Merging {
    fn merge(self, new: Self) -> Self;
}
trait Requiring<R> {
    fn require(self, name: &'static str) -> Result<R>;
}

#[derive(Default, Deserialize, PartialEq, Debug)]
#[serde(untagged)]
enum Plural<T> {
    #[default]
    Zero,
    One(T),
    Many(Vec<T>),
}

impl<T> Merging for Plural<T> {
    fn merge(self, new: Self) -> Self {
        return match new {
            Plural::Zero => self,
            _ => new,
        };
    }
}

impl Plural<String> {
    fn to_array(self) -> Vec<String> {
        return match self {
            Plural::Zero => Vec::new(),
            Plural::One(val) => vec![val],
            Plural::Many(vals) => vals,
        };
    }
}

// required values are only required at the very end of parsing, once all known defaults
// have been resolved
#[derive(Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(untagged)]
enum Required<T> {
    #[default]
    DefaultValue,
    Value(T),
}

impl<T> Requiring<T> for Required<T> {
    fn require(self, name: &'static str) -> Result<T> {
        return match self {
            Required::DefaultValue => Err(Error::RequiredField(name)),
            Required::Value(val) => Ok(val),
        };
    }
}

impl<T: Merging> Merging for Required<T> {
    fn merge(self, new: Self) -> Self {
        return match new {
            Required::Value(new_val) => match self {
                Required::Value(old_val) => Required::Value(old_val.merge(new_val)),
                Required::DefaultValue => Required::Value(new_val),
            },
            Required::DefaultValue => self,
        };
    }
}

fn default_mode() -> Plural<String> {
    return Plural::One("default".into());
}

lazy_static! {
    static ref MODIFIER_REGEX: Regex = Regex::new(r"(?i)Ctrl|Shift|Alt|Cmd|Win|Meta").unwrap();
    static ref KEY_REGEXS: Vec<Regex> = vec![
        Regex::new(r"(?i)f[1-9]").unwrap(),
        Regex::new(r"(?i)f1[0-9]").unwrap(),
        Regex::new(r"[a-z]").unwrap(),
        Regex::new(r"[0-9]").unwrap(),
        Regex::new(r"`").unwrap(),
        Regex::new(r"-").unwrap(),
        Regex::new(r"=").unwrap(),
        Regex::new(r"\[").unwrap(),
        Regex::new(r"\]").unwrap(),
        Regex::new(r"\\").unwrap(),
        Regex::new(r";").unwrap(),
        Regex::new(r"'").unwrap(),
        Regex::new(r",").unwrap(),
        Regex::new(r"\.").unwrap(),
        Regex::new(r"\/").unwrap(),
        Regex::new(r"(?i)left").unwrap(),
        Regex::new(r"(?i)up").unwrap(),
        Regex::new(r"(?i)right").unwrap(),
        Regex::new(r"(?i)down").unwrap(),
        Regex::new(r"(?i)pageup").unwrap(),
        Regex::new(r"(?i)pagedown").unwrap(),
        Regex::new(r"(?i)end").unwrap(),
        Regex::new(r"(?i)home").unwrap(),
        Regex::new(r"(?i)tab").unwrap(),
        Regex::new(r"(?i)enter").unwrap(),
        Regex::new(r"(?i)escape").unwrap(),
        Regex::new(r"(?i)space").unwrap(),
        Regex::new(r"(?i)backspace").unwrap(),
        Regex::new(r"(?i)delete").unwrap(),
        Regex::new(r"(?i)pausebreak").unwrap(),
        Regex::new(r"(?i)capslock").unwrap(),
        Regex::new(r"(?i)insert").unwrap(),
        Regex::new(r"(?i)numpad[0-9]").unwrap(),
        Regex::new(r"(?i)numpad_multiply").unwrap(),
        Regex::new(r"(?i)numpad_add").unwrap(),
        Regex::new(r"(?i)numpad_separator").unwrap(),
        Regex::new(r"(?i)numpad_subtract").unwrap(),
        Regex::new(r"(?i)numpad_decimal").unwrap(),
        Regex::new(r"(?i)numpad_divide").unwrap(),
        // layout independent versions
        Regex::new(r"(?i)\[f[1-9]\]").unwrap(),
        Regex::new(r"(?i)\[f1[0-9]\]").unwrap(),
        Regex::new(r"(?i)\[Key[A-Z]\]").unwrap(),
        Regex::new(r"(?i)\[Digit[0-9]\]").unwrap(),
        Regex::new(r"(?i)\[Numpad[0-9]\]").unwrap(),
        Regex::new(r"\[Backquote\]").unwrap(),
        Regex::new(r"\[Minus\]").unwrap(),
        Regex::new(r"\[Equal\]").unwrap(),
        Regex::new(r"\[BracketLeft\]").unwrap(),
        Regex::new(r"\[BracketRight\]").unwrap(),
        Regex::new(r"\[Backslash\]").unwrap(),
        Regex::new(r"\[Semicolon\]").unwrap(),
        Regex::new(r"\[Quote\]").unwrap(),
        Regex::new(r"\[Comma\]").unwrap(),
        Regex::new(r"\[Period\]").unwrap(),
        Regex::new(r"\[Slash\]").unwrap(),
        Regex::new(r"\[ArrowLeft\]").unwrap(),
        Regex::new(r"\[ArrowUp\]").unwrap(),
        Regex::new(r"\[ArrowRight\]").unwrap(),
        Regex::new(r"\[ArrowDown\]").unwrap(),
        Regex::new(r"\[PageUp\]").unwrap(),
        Regex::new(r"\[PageDown\]").unwrap(),
        Regex::new(r"\[End\]").unwrap(),
        Regex::new(r"\[Home\]").unwrap(),
        Regex::new(r"\[Tab\]").unwrap(),
        Regex::new(r"\[Enter\]").unwrap(),
        Regex::new(r"\[Escape\]").unwrap(),
        Regex::new(r"\[Space\]").unwrap(),
        Regex::new(r"\[Backspace\]").unwrap(),
        Regex::new(r"\[Delete\]").unwrap(),
        Regex::new(r"\[Pause\]").unwrap(),
        Regex::new(r"\[CapsLock\]").unwrap(),
        Regex::new(r"\[Insert\]").unwrap(),
        Regex::new(r"\[NumpadMultiply\]").unwrap(),
        Regex::new(r"\[NumpadAdd\]").unwrap(),
        Regex::new(r"\[NumpadComma\]").unwrap(),
        Regex::new(r"\[NumpadSubtract\]").unwrap(),
        Regex::new(r"\[NumpadDecimal\]").unwrap(),
        Regex::new(r"\[NumpadDivide\]").unwrap(),
    ];
}

fn valid_key_binding(val: &Required<String>) -> std::result::Result<(), ValidationError> {
    match val {
        Required::DefaultValue => return Ok(()),
        Required::Value(x) => {
            if valid_key_binding_str(&x) {
                return Err(ValidationError::new("Invalid key binding"));
            } else {
                return Ok(());
            }
        }
    };
}

fn valid_key_binding_str(str: &str) -> bool {
    for press in Regex::new(r"\s+").unwrap().split(str) {
        let mut first = true;
        for part in press.split('+') {
            if first {
                first = false;
                if !KEY_REGEXS.iter().any(|r| r.is_match(part)) {
                    return false;
                }
            } else {
                if !MODIFIER_REGEX.is_match(part) {
                    return false;
                }
            }
        }
    }
    return false;
}

/**
 * @bindingField bind
 * @description an actual keybinding; extends the schema used by VSCode's `keybindings.json`
 *
 * **Example**
 *
 * ```toml
 * [[bind]]
 * name = "left"
 * key = "h"
 * mode = "normal"
 * command = "cursorLeft"
 * ```
 * The `bind` element has two categories of fields: functional and documenting.
 *
 * ## Functional Fields
 *
 * The functional fields determine what the keybinding does. Required fields are marked with
 * a `*`.
 *
 */
#[derive(Deserialize, Validate)]
pub struct CommandInput {
    /**
     * @forBindingField bind
     *
     * - `command`*: A string denoting the command to execute. This is a command
     *   defined by VSCode or an extension thereof.
     *   See [finding commands](#finding-commands). This field has special
     *   behavior for the command `runCommands`
     *   (see [running multiple commands](#running-multiple-commands)).
     */
    #[serde(default)]
    command: Required<String>,

    /**
     * @forBindingField bind
     *
     * - `args`: The arguments to directly pass to the `command`, these are static
     *   values.
     */
    #[validate(custom(function = "valid_json_object"))]
    #[serde(default)]
    args: Option<toml::Table>,

    /**
     * @forBindingField bind
     *
     * - `computedArgs`: Like `args` except that each value is a string that is
     *   evaluated as an [expression](/expressions/index).
     */
    // TODO: should be fieldds of strings not a general table (right??)
    #[validate(custom(function = "valid_json_object"))]
    #[serde(default)]
    computedArgs: Option<toml::Table>,

    /**
     * @forBindingField bind
     *
     * - `key`*: the
     *   [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that
     *   triggers `command`.
     */
    #[serde(default)]
    #[validate(custom(function = "valid_key_binding"))]
    key: Required<String>,
    /**
     * @forBindingField bind
     *
     * - `when`: A [when
     *   clause](https://code.visualstudio.com/api/references/when-clause-contexts)
     *   context under which the binding will be active. Also see Master Key's
     *   [available contexts](#available-contexts)
     */
    #[serde(default)]
    when: Plural<String>,
    /**
     * @forBindingField bind
     *
     * - `mode`: The mode during which the binding will be active. The default mode is
     *   used when this field is not specified (either directly or via the `defaults`
     *   field). You can also specify multiple modes as an array of strings. To specify
     *   a binding that is applied in all modes use "{{all_modes}}".
     */
    #[serde(default = "default_mode")]
    mode: Plural<String>,
    /**
     * @forBindingField bind
     *
     * - `priority`: The ordering of the keybinding relative to others; determines which
     *   bindings take precedence. Defaults to 0.
     */
    #[serde(default)]
    priority: Option<i64>,
    /**
     * @forBindingField bind
     *
     * - `defaults`: the hierarchy of defaults applied to this binding, see
     *   [`default`](/bindings/default) for more details.
     */
    #[serde(default)]
    defaults: Option<String>,
    /**
     * @forBindingField bind
     *
     * - `foreach`: Allows parametric definition of multiple keybindings, see
     *   [`foreach` clauses](#foreach-clauses).
     */
    #[serde(default)]
    #[validate(custom(function = "valid_json_array_object"))]
    foreach: Option<toml::Table>,

    /**
     * @forBindingField bind
     *
     * - `prefixes`: (array of strings or the string
     *   <code v-pre>{{all_prefixes}}</code>). Determines one or more *unresolved* key
     *   sequences that can have occurred before typing this key. See
     *   [`master-key.prefix`](/commands/prefix) for details. Defaults to `""` (a.k.a.
     *   no prefix is allowed). This can be set to <code v-pre>{{all_prefixes}}</code>,
     *   if you wish to allow the key binding to work regardless of any unresolved key
     *   sequence that has been pressed (e.g. this is used for the "escape" key binding
     *   in Larkin).
     */
    #[serde(default)]
    prefixes: Plural<String>,

    /**
     * @forBindingField bind
     *
     * - `finalKey`: (boolean, default=true) Whether this key should clear any transient
     *   state associated with the pending keybinding prefix. See
     *   [`master-key.prefix`](/commands/prefix) for details.
     */
    #[serde(default)]
    finalKey: Option<bool>,

    /**
     * @forBindingField bind
     *
     * - `computedRepeat`: This is an [expression](/expressions/index). It is expected
     *   to evaluate to the number of times to repeat the command. Defaults to zero: one
     *   repeat means the command is run twice.
     * - `command` will be repeated the given
     *   number of times.
     */
    computedRepeat: Option<String>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * ## Documenting Fields
     *
     * The documenting fields determine how the keybinding is documented. They are all
     * optional.
     *
     * - `name`: A very description for the command; this must fit in the visual
     *   documentation so it shouldn't be much longer than five characters for most
     *   keys. Favor unicode symbols such as → and ← over text.
     */
    #[serde(default)]
    name: Option<String>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `description`: A longer description of what the command does. Shouldn't be much
     *   longer than a single sentence for most keys. Save more detailed descriptions
     *   for the literate comments.
     */
    #[serde(default)]
    description: Option<String>,
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `hideInPalette/hideInDocs`: whether to show the keys in the popup suggestions
     *   and the documentation. These both default to false.
     */
    #[serde(default)]
    hideInPalette: Option<bool>,
    #[serde(default)]
    hideInDocs: Option<bool>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `combinedName/combinedKey/combinedDescription`: in the suggestion palette and
     *   textual documentation, keys that have the same `combinedName` will be
     *   represented as single entry, using the `combinedKey` and `combinedDescription`
     *   instead of `key` and `description`. The `combinedKey` for a multi-key sequence
     *   should only include the suffix key. All but the first key's `combinedKey` and
     *   `combinedDescription` are ignored.
     */
    #[serde(default)]
    combinedName: Option<String>,
    #[serde(default)]
    combinedKey: Option<String>,
    #[serde(default)]
    combinedDescription: Option<String>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `kind`: The broad cagegory of commands this binding falls under. There should
     *   be no more than 4-5 of these. Each `kind` here should have a corresponding
     *   entry in the top-level `kind` array.
     */
    #[serde(default)]
    kind: Option<String>,
    /**
     * @forBindingField bind
     * @order 5
     *
     * - `whenComputed`: an [expression](/expressions/index) that, if evaluated to
     *   false, the command will not execute. Favor `when` clauses over `whenComputed`.
     *   The `whenComputed` field is distinct from the `when` clause because it uses the
     *   scope of expressions rather than when clause statements. Furthermore, even if
     *   the `whenComputed` is false, the binding is still considered to have triggered,
     *   and now downstream keybindings will be triggered. It is most useful in
     *   conjunction with `runCommands` or [`storeCommand`](/commands/storeCommand).
     */
    #[serde(default)]
    whenComputed: Option<String>,
}

impl<T: Merging> Merging for Option<T> {
    fn merge(self, new: Self) -> Self {
        return match new {
            Some(x) => match self {
                Some(y) => Some(y.merge(x)),
                None => Some(x),
            },
            None => self,
        };
    }
}

impl Merging for String {
    fn merge(self, _: Self) -> Self {
        return self;
    }
}

impl Merging for i64 {
    fn merge(self, _: Self) -> Self {
        return self;
    }
}

impl Merging for bool {
    fn merge(self, _: Self) -> Self {
        return self;
    }
}

impl Merging for toml::Value {
    fn merge(self, new: Self) -> Self {
        match new {
            Value::Array(mut new_values) => match self {
                Value::Array(mut old_values) => {
                    old_values.append(&mut new_values);
                    Value::Array(old_values)
                }
                _ => Value::Array(new_values),
            },
            Value::Table(new_kv) => match self {
                Value::Table(old_kv) => Value::Table(old_kv.merge(new_kv)),
                _ => Value::Table(new_kv),
            },
            _ => new,
        }
    }
}

// TODO: think through ownship here
impl Merging for toml::Table {
    fn merge(mut self, new: Self) -> Self {
        self.extend(new);
        return self;
    }
}

impl<T> Requiring<Option<T>> for Option<T> {
    fn require(self, _: &str) -> Result<Self> {
        return Ok(self);
    }
}

// TODO: before I finish implementing this, make sure I can
// read in the TOML table values to a javascript
impl Merging for CommandInput {
    fn merge(self, y: Self) -> Self {
        CommandInput {
            command: self.command.merge(y.command),
            args: self.args.merge(y.args),
            computedArgs: self.computedArgs.merge(y.computedArgs),
            key: self.key.merge(y.key),
            when: self.when.merge(y.when),
            mode: self.mode.merge(y.mode),
            priority: self.priority.merge(y.priority),
            defaults: self.defaults.merge(y.defaults),
            foreach: self.foreach.merge(y.foreach),
            prefixes: self.prefixes.merge(y.prefixes),
            finalKey: self.finalKey.merge(y.finalKey),
            computedRepeat: self.computedRepeat.merge(y.computedRepeat),
            name: self.name.merge(y.name),
            description: self.description.merge(y.description),
            hideInPalette: self.hideInPalette.merge(y.hideInPalette),
            hideInDocs: self.hideInDocs.merge(y.hideInDocs),
            combinedName: self.combinedName.merge(y.combinedName),
            combinedKey: self.combinedKey.merge(y.combinedKey),
            combinedDescription: self.combinedDescription.merge(y.combinedDescription),
            kind: self.kind.merge(y.kind),
            whenComputed: self.whenComputed.merge(y.whenComputed),
        }
    }
}

// TODO: do the Table objects get properly understand as basic JS objects
// or do we have to convert them here to JsObjects?
#[wasm_bindgen(getter_with_clone)]
#[allow(non_snake_case)]
pub struct Command {
    pub command: String,
    pub args: JsValue,
    pub computedArgs: JsValue,
    pub key: String,
    pub when: Vec<String>,
    pub mode: Vec<String>,
    pub priority: i64,
    pub defaults: String,
    pub prefixes: Vec<String>,
    pub finalKey: bool,
    pub computedRepeat: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub hideInPalette: Option<bool>,
    pub hideInDocs: Option<bool>,
    pub combinedName: Option<String>,
    pub combinedKey: Option<String>,
    pub combinedDescription: Option<String>,
    pub kind: Option<String>,
    pub whenComputed: Option<String>,
}

// TODO: convert errors to my own error type for Validation and serde_wasm_bindgen error

// TODO: think about whether I want to represent commands as a sequence in the output...
impl Command {
    pub fn new(input: CommandInput) -> Result<Self> {
        if let Some(_) = input.foreach {
            return Err(Error::Unexpected("`foreach` remains unresolved"));
        }
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        return Ok(Command {
            command: input.command.require("command")?,
            args: input
                .args
                .unwrap_or_else(|| toml::Table::new())
                .serialize(&to_json)?,
            computedArgs: input
                .computedArgs
                .unwrap_or_else(|| toml::Table::new())
                .serialize(&to_json)?,
            key: input.key.require("key")?,
            when: input.when.to_array(),
            mode: input.mode.to_array(),
            priority: input.priority.unwrap_or(0),
            defaults: input.defaults.unwrap_or_default(),
            prefixes: input.prefixes.to_array(),
            finalKey: input.finalKey.unwrap_or_default(),
            computedRepeat: input.computedRepeat,
            name: input.name,
            description: input.description,
            hideInPalette: input.hideInPalette,
            hideInDocs: input.hideInDocs,
            combinedName: input.combinedName,
            combinedKey: input.combinedKey,
            combinedDescription: input.combinedDescription,
            kind: input.kind,
            whenComputed: input.whenComputed,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_parsing() {
        let data = r#"
        command = "do"
        args = { a = "2", b = 3 }
        computedArgs = { c = "1+2" }
        key = "a"
        when = "joe > 1"
        mode = "normal"
        priority = 1
        defaults = "foo.bar"
        foreach.index = [1,2,3]
        prefixes = "c"
        finalKey = true
        computedRepeat = "2+c"
        name = "foo"
        description = "foo bar bin"
        hideInPalette = false
        hideInDocs = false
        combinedName = "Up/down"
        combinedKey = "A/B"
        combinedDescription = "bla bla bla"
        kind = "biz"
        whenComputed = "f > 2"
        "#;

        let result = toml::from_str::<CommandInput>(data).unwrap();

        assert_eq!(result.command, Required::Value("do".into()));
        let args = result.args.unwrap();
        assert_eq!(args.get("a").unwrap(), &Value::String("2".into()));
        assert_eq!(args.get("b").unwrap(), &Value::Integer(3));
        assert_eq!(
            result.computedArgs.unwrap().get("c").unwrap(),
            &Value::String("1+2".into())
        );
        assert_eq!(result.key, Required::Value("a".into()));
        assert_eq!(result.when, Plural::One("joe > 1".into()));
        assert_eq!(result.mode, Plural::One("normal".into()));
        assert_eq!(result.priority.unwrap(), 1);
        assert_eq!(result.defaults.unwrap(), "foo.bar");
        assert_eq!(
            result.foreach.unwrap().get("index").unwrap(),
            &Value::Array(vec![1, 2, 3].iter().map(|x| Value::Integer(*x)).collect())
        );
        assert_eq!(result.prefixes, Plural::One("c".into()));
        assert_eq!(result.finalKey.unwrap(), true);
        assert_eq!(result.name.unwrap(), "foo");
        assert_eq!(result.description.unwrap(), "foo bar bin");
        assert_eq!(result.hideInDocs.unwrap(), false);
        assert_eq!(result.hideInPalette.unwrap(), false);
        assert_eq!(result.combinedName.unwrap(), "Up/down");
        assert_eq!(result.combinedKey.unwrap(), "A/B");
        assert_eq!(result.combinedDescription.unwrap(), "bla bla bla");
        assert_eq!(result.kind.unwrap(), "biz");
        assert_eq!(result.whenComputed.unwrap(), "f > 2");
    }

    // TODO: can handle defaults
    // TODO: errors on missing required fields
    // TODO: doesn't error on missing non-required fields
    //
}

// TODO: define the "output" type for `Command` that can actually be passed to javascript
