// parsing of individual `[[bind]]` elements

#![allow(non_snake_case)]

mod foreach;
mod validation;

use crate::bind::foreach::{ForeachExpanding, ForeachInterpolated, expand_keys};
use crate::bind::validation::{JsonObjectShape, valid_json_array_object, valid_key_binding};
use crate::error::{Context, ErrorContext, Result, constrain, unexpected};
use crate::util::{Merging, Plural, Required, Requiring, Resolving};

#[allow(unused_imports)]
use log::info;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::{Spanned, Value};
use validator::Validate;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn debug_parse_command(command_str: &str) -> std::result::Result<Binding, JsError> {
    let result = toml::from_str::<BindingInput>(command_str)?;
    return Ok(Binding::new(result)?);
}

pub const UNKNOWN_RANGE: core::ops::Range<usize> = usize::MIN..usize::MAX;

fn default_mode() -> Spanned<Plural<String>> {
    return Spanned::new(UNKNOWN_RANGE, Plural::One("default".into()));
}

fn span_required_default<T>() -> Spanned<Required<T>> {
    return Spanned::new(UNKNOWN_RANGE, Required::DefaultValue);
}

fn span_plural_default<T>() -> Spanned<Plural<T>> {
    return Spanned::new(UNKNOWN_RANGE, Plural::Zero);
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
#[derive(Deserialize, Validate, Clone, Debug)]
pub struct BindingInput {
    /**
     * @forBindingField bind
     *
     * - `command`*: A string denoting the command to execute. This is a command
     *   defined by VSCode or an extension thereof.
     *   See [finding commands](#finding-commands). This field has special
     *   behavior for the command `runCommands`
     *   (see [running multiple commands](#running-multiple-commands)).
     */
    #[serde(default = "span_required_default")]
    command: Spanned<Required<String>>,

    /**
     * @forBindingField bind
     *
     * - `args`: The arguments to directly pass to the `command`, these are static
     *   values.
     */
    #[validate(custom(function = "JsonObjectShape::valid_json_object"))]
    #[serde(default)]
    args: Option<Spanned<toml::Table>>,

    /**
     * @forBindingField bind
     *
     * - `key`*: the
     *   [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that
     *   triggers `command`.
     */
    #[serde(default = "span_required_default")]
    #[validate(custom(function = "valid_key_binding"))]
    key: Spanned<Required<String>>,
    /**
     * @forBindingField bind
     *
     * - `when`: A [when
     *   clause](https://code.visualstudio.com/api/references/when-clause-contexts)
     *   context under which the binding will be active. Also see Master Key's
     *   [available contexts](#available-contexts)
     */
    #[serde(default = "span_plural_default")]
    when: Spanned<Plural<String>>,
    /**
     * @forBindingField bind
     *
     * - `mode`: The mode during which the binding will be active. The default mode is
     *   used when this field is not specified (either directly or via the `defaults`
     *   field). You can also specify multiple modes as an array of strings. To specify
     *   a binding that is applied in all modes use "{{all_modes}}".
     */
    #[serde(default = "default_mode")]
    mode: Spanned<Plural<String>>,
    /**
     * @forBindingField bind
     *
     * - `priority`: The ordering of the keybinding relative to others; determines which
     *   bindings take precedence. Defaults to 0.
     */
    #[serde(default)]
    priority: Option<Spanned<i64>>,
    /**
     * @forBindingField bind
     *
     * - `defaults`: the hierarchy of defaults applied to this binding, see
     *   [`default`](/bindings/default) for more details.
     */
    #[serde(default)]
    defaults: Option<Spanned<String>>,
    /**
     * @forBindingField bind
     *
     * - `foreach`: Allows parametric definition of multiple keybindings, see
     *   [`foreach` clauses](#foreach-clauses).
     */
    #[serde(default)]
    #[validate(custom(function = "valid_json_array_object"))]
    foreach: Option<Spanned<toml::Table>>,

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
    #[serde(default = "span_plural_default")]
    prefixes: Spanned<Plural<String>>,

    /**
     * @forBindingField bind
     *
     * - `finalKey`: (boolean, default=true) Whether this key should clear any transient
     *   state associated with the pending keybinding prefix. See
     *   [`master-key.prefix`](/commands/prefix) for details.
     */
    #[serde(default)]
    finalKey: Option<Spanned<bool>>,

    /**
     * @forBindingField bind
     *
     *  **TODO**: update docs, and make it possible to be a number or a string
     *
     * - `repeat`: This is an [expression](/expressions/index). It is expected
     *   to evaluate to the number of times to repeat the command. Defaults to zero: one
     *   repeat means the command is run twice.
     * - `command` will be repeated the given
     *   number of times.
     */
    repeat: Option<Spanned<String>>,

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
    name: Option<Spanned<String>>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `description`: A longer description of what the command does. Shouldn't be much
     *   longer than a single sentence for most keys. Save more detailed descriptions
     *   for the literate comments.
     */
    #[serde(default)]
    description: Option<Spanned<String>>,
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `hideInPalette/hideInDocs`: whether to show the keys in the popup suggestions
     *   and the documentation. These both default to false.
     */
    #[serde(default)]
    hideInPalette: Option<Spanned<bool>>,
    #[serde(default)]
    hideInDocs: Option<Spanned<bool>>,

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
    combinedName: Option<Spanned<String>>,
    #[serde(default)]
    combinedKey: Option<Spanned<String>>,
    #[serde(default)]
    combinedDescription: Option<Spanned<String>>,

    /**
     * @forBindingField bind
     * @order 10
     *
     * - `kind`: The broad cagegory of commands this binding falls under. There should
     *   be no more than 4-5 of these. Each `kind` here should have a corresponding
     *   entry in the top-level `kind` array.
     */
    #[serde(default)]
    kind: Option<Spanned<String>>,
}

impl Merging for BindingInput {
    fn coalesce(self, new: Self) -> Self {
        return new;
    }
    fn merge(self, y: Self) -> Self {
        BindingInput {
            command: self.command.coalesce(y.command),
            args: self.args.merge(y.args),
            key: self.key.coalesce(y.key),
            when: self.when.coalesce(y.when),
            mode: self.mode.coalesce(y.mode),
            priority: self.priority.coalesce(y.priority),
            defaults: self.defaults.coalesce(y.defaults),
            foreach: self.foreach,
            prefixes: self.prefixes.coalesce(y.prefixes),
            finalKey: self.finalKey.coalesce(y.finalKey),
            repeat: self.repeat.coalesce(y.repeat),
            name: self.name.coalesce(y.name),
            description: self.description.coalesce(y.description),
            hideInPalette: self.hideInPalette.coalesce(y.hideInPalette),
            hideInDocs: self.hideInDocs.coalesce(y.hideInDocs),
            combinedName: self.combinedName.coalesce(y.combinedName),
            combinedKey: self.combinedKey.coalesce(y.combinedKey),
            combinedDescription: self.combinedDescription.coalesce(y.combinedDescription),
            kind: self.kind.coalesce(y.kind),
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct Command {
    pub command: String,
    pub args: JsValue,
}

#[derive(Clone)]
#[allow(non_snake_case)]
#[wasm_bindgen(getter_with_clone)]
pub struct Binding {
    pub key: String,
    pub commands: Vec<Command>,
    pub when: Vec<String>,
    pub mode: Vec<String>,
    pub priority: i64,
    pub defaults: String,
    pub prefixes: Vec<String>,
    pub finalKey: bool,
    pub repeat: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub hideInPalette: Option<bool>,
    pub hideInDocs: Option<bool>,
    pub combinedName: Option<String>,
    pub combinedKey: Option<String>,
    pub combinedDescription: Option<String>,
    pub kind: Option<String>,
}

// TODO: convert errors to my own error type for Validation and serde_wasm_bindgen error

impl BindingInput {
    fn has_foreach(&self) -> bool {
        if let Some(foreach) = &self.foreach {
            return foreach.get_ref().len() > 0;
        }
        return false;
    }

    fn expand_foreach(&mut self) -> Result<Vec<BindingInput>> {
        let mut result = vec![self.clone()];
        while self.has_foreach() {
            result = self.expand_foreach_once(&result)?;
        }
        return Ok(result);
    }

    fn expand_foreach_once(&mut self, inputs: &Vec<BindingInput>) -> Result<Vec<BindingInput>> {
        let foreach = match &self.foreach {
            Some(foreach) => foreach.get_ref(),
            None => &toml::map::Map::new(),
        };
        let mut final_foreach = foreach.clone();
        let mut iter = foreach.iter();
        let first = iter.next();
        if let Some(item) = first {
            let (var, values) = item;
            final_foreach.remove(var);

            if let Value::Array(items) = values {
                let expanded_items = expand_keys(items)
                    .context(Context::String(format!("while reading {}", values)))?;
                let mut result = Vec::with_capacity(inputs.len() * expanded_items.len());
                for input in inputs {
                    for value in &expanded_items {
                        let str = value.foreach_interpolation();
                        result.push(input.expand_foreach_value(var, &str));
                    }
                }
                self.foreach = Some(Spanned::new(UNKNOWN_RANGE, final_foreach));
                return Ok(result);
            } else {
                return unexpected("`foreach` was not an object of arrays");
            }
        } else {
            return Ok(vec![]);
        }
    }

    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        return BindingInput {
            command: self.command.expand_foreach_value(var, value),
            args: self.args.expand_foreach_value(var, value),
            key: self.key.expand_foreach_value(var, value),
            when: self.when.expand_foreach_value(var, value),
            mode: self.mode.expand_foreach_value(var, value),
            priority: self.priority.clone(),
            defaults: self.defaults.expand_foreach_value(var, value),
            prefixes: self.prefixes.expand_foreach_value(var, value),
            finalKey: self.finalKey.clone(),
            repeat: self.repeat.expand_foreach_value(var, value),
            foreach: None,
            name: self.name.expand_foreach_value(var, value),
            description: self.description.expand_foreach_value(var, value),
            hideInPalette: self.hideInPalette.clone(),
            hideInDocs: self.hideInDocs.clone(),
            combinedName: self.combinedName.expand_foreach_value(var, value),
            combinedKey: self.combinedKey.expand_foreach_value(var, value),
            combinedDescription: self.combinedDescription.expand_foreach_value(var, value),
            kind: self.kind.expand_foreach_value(var, value),
        };
    }
}

fn regularize_commands(input: BindingInput) -> Result<(BindingInput, Vec<Command>)> {
    let to_json = serde_wasm_bindgen::Serializer::json_compatible();
    let command_pos = input.command.span();
    let command = input.command.get_ref().clone().resolve("command")?;
    // TODO: replicate for computedArgs (and do in a function?)
    let args = input.args.clone();
    if command == "runCommands" {
        let spanned = args
            .require("`args`")
            .context(Context::Range(command_pos))
            .context(Context::String(
                "`runCommands` must have `args` field".into(),
            ))?;
        let args_pos = spanned.span();
        let args = spanned.into_inner();
        let commands = args
            .get("commands")
            .require("`commands`")
            .context(Context::String(
                "`runCommands.args` must have a `commands` fields".into(),
            ))
            .context(Context::Range(args_pos.clone()))?;
        let commands = commands.as_array().require("`commands` to be an array")?;
        let mut command_result = Vec::with_capacity(commands.len());
        for command in commands {
            let (command, args) = match command {
                Value::String(str) => (str.to_owned(), toml::Table::new()),
                Value::Table(kv) => {
                    let command_name = kv
                        .get("command")
                        .require("`command`")?
                        .as_str()
                        .require("`command` to be string")
                        .context(Context::Range(args_pos.clone()))?
                        .to_owned();
                    let args = command
                        .get("args")
                        .require("`args`")?
                        .as_table()
                        .require("`args` to be a table")?
                        .to_owned();
                    (command_name, args)
                }
                _ => {
                    return constrain(
                        "`commands` to be an array that includes objects and strings only",
                    )?;
                }
            };

            command_result.push(Command {
                command,
                args: args
                    .serialize(&to_json)
                    .expect("while serializing command arguments"),
            })
        }

        return Ok((input, command_result));
    } else {
        return Ok((
            input,
            vec![Command {
                command,
                args: args
                    .serialize(&to_json)
                    .expect("while serializing command arguments"),
            }],
        ));
    }
}

// TODO: think about whether I want to represent commands as a sequence in the output...
impl Binding {
    pub fn new(input: BindingInput) -> Result<Self> {
        serde_wasm_bindgen::Serializer::json_compatible();
        if let Some(_) = input.foreach {
            return unexpected("`foreach` with unresolved variables");
        }
        let (input, commands) = regularize_commands(input)?;
        // TODO this is where we should validate that prefix has `finalKey == false`

        return Ok(Binding {
            commands: commands,
            key: input.key.into_inner().require("key")?,
            when: input.when.into_inner().to_array(),
            mode: input.mode.into_inner().to_array(),
            priority: input.priority.map(|x| x.into_inner()).unwrap_or(0),
            defaults: input.defaults.map(|x| x.into_inner()).unwrap_or_default(),
            prefixes: input.prefixes.into_inner().to_array(),
            finalKey: input.finalKey.map(|x| x.into_inner()).unwrap_or_default(),
            repeat: input.repeat.map(|x| x.into_inner()),
            name: input.name.map(|x| x.into_inner()),
            description: input.description.map(|x| x.into_inner()),
            hideInPalette: input.hideInPalette.map(|x| x.into_inner()),
            hideInDocs: input.hideInDocs.map(|x| x.into_inner()),
            combinedName: input.combinedName.map(|x| x.into_inner()),
            combinedKey: input.combinedKey.map(|x| x.into_inner()),
            combinedDescription: input.combinedDescription.map(|x| x.into_inner()),
            kind: input.kind.clone().map(|x| x.into_inner()),
        });
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use test_log::test;

    use super::*;
    #[test]
    fn complete_parsing() {
        let data = r#"
        command = "do"
        args = { a = "2", b = 3 }
        key = "a"
        when = "joe > 1"
        mode = "normal"
        priority = 1
        defaults = "foo.bar"
        foreach.index = [1,2,3]
        prefixes = "c"
        finalKey = true
        repeat = "2+c"
        name = "foo"
        description = "foo bar bin"
        hideInPalette = false
        hideInDocs = false
        combinedName = "Up/down"
        combinedKey = "A/B"
        combinedDescription = "bla bla bla"
        kind = "biz"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();

        assert_eq!(result.command.into_inner(), Required::Value("do".into()));
        let args = result.args.unwrap().into_inner();
        assert_eq!(args.get("a").unwrap(), &Value::String("2".into()));
        assert_eq!(args.get("b").unwrap(), &Value::Integer(3));
        assert_eq!(result.key.into_inner(), Required::Value("a".into()));
        assert_eq!(result.when.into_inner(), Plural::One("joe > 1".into()));
        assert_eq!(result.mode.into_inner(), Plural::One("normal".into()));
        assert_eq!(result.priority.map(|x| x.into_inner()).unwrap(), 1);
        assert_eq!(result.defaults.map(|x| x.into_inner()).unwrap(), "foo.bar");
        assert_eq!(
            result.foreach.unwrap().into_inner().get("index").unwrap(),
            &Value::Array(vec![1, 2, 3].iter().map(|x| Value::Integer(*x)).collect())
        );
        assert_eq!(result.prefixes.into_inner(), Plural::One("c".into()));
        assert_eq!(result.finalKey.map(|x| x.into_inner()).unwrap(), true);
        assert_eq!(result.name.map(|x| x.into_inner()).unwrap(), "foo");
        assert_eq!(
            result.description.map(|x| x.into_inner()).unwrap(),
            "foo bar bin"
        );
        assert_eq!(result.hideInDocs.map(|x| x.into_inner()).unwrap(), false);
        assert_eq!(result.hideInPalette.map(|x| x.into_inner()).unwrap(), false);
        assert_eq!(
            result.combinedName.map(|x| x.into_inner()).unwrap(),
            "Up/down"
        );
        assert_eq!(result.combinedKey.map(|x| x.into_inner()).unwrap(), "A/B");
        assert_eq!(
            result.combinedDescription.map(|x| x.into_inner()).unwrap(),
            "bla bla bla"
        );
        assert_eq!(result.kind.map(|x| x.into_inner()).unwrap(), "biz");
    }

    #[test]
    fn default_parsing() {
        let data = r#"
        key = "l"
        command = "cursorMove"
        args.to = "left"
        "#;

        let result = toml::from_str::<BindingInput>(data).unwrap();
        assert_eq!(result.key.into_inner().unwrap(), "l");
        assert_eq!(result.command.into_inner().unwrap(), "cursorMove");
        assert_eq!(
            result
                .args
                .unwrap()
                .into_inner()
                .get("to")
                .unwrap()
                .as_str()
                .unwrap(),
            "left"
        );

        assert_eq!(result.when.into_inner(), Plural::Zero);
        assert_eq!(result.combinedDescription, None);
        assert_eq!(result.combinedName, None);
    }

    #[test]
    fn simple_command_merging() {
        let data = r#"
        [[bind]]
        name = "default"
        command = "cursorMove"
        prefixes = ["a"]

        [[bind]]
        key = "l"
        name = "←"
        args.to = "left"
        prefixes = ["b", "c"]
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let left = default.merge(left);
        assert_eq!(left.key.into_inner().unwrap(), "l");
        assert_eq!(left.command.into_inner().unwrap(), "cursorMove");
        assert_eq!(
            left.args
                .unwrap()
                .into_inner()
                .get("to")
                .unwrap()
                .as_str()
                .unwrap(),
            "left"
        );
        assert_eq!(
            left.prefixes.into_inner(),
            Plural::Many(vec!["b".into(), "c".into()])
        );

        assert_eq!(left.when.into_inner(), Plural::Zero);
        assert_eq!(left.combinedDescription, None);
        assert_eq!(left.combinedName, None);
    }

    #[test]
    fn merge_nested_arguments() {
        let data = r#"
            [[bind]]
            name = "default"
            command = "cursorMove"
            args.foo = { a = 2, b = 3, c = { x = 1 } }

            [[bind]]
            key = "r"
            name = "→"
            args.foo = { d = 12, c = { y = 2 } }

            [[bind]]
            key = "x"
            name = "expected"
            args.foo = { a = 2, b = 3, c = { x = 1, y = 2 }, d = 12 }
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let expected = result.get("bind").unwrap()[2].clone();
        let left = default.merge(left);

        assert_eq!(left.args, expected.args);
    }

    #[test]
    fn merge_nested_array_arguments() {
        let data = r#"
            [[bind]]
            name = "default"
            command = "runCommands"

            [[bind.args.commands]]
            command = "step1"
            args.b = "bar"

            [[bind.args.commands]]
            command = "step2"
            args.x = "biz"

            [[bind]]
            name = "run"
            key = "x"
            command = "runCommands"

            [[bind.args.commands]]
            command = "step1"
            args.a = "foo"

            [[bind.args.commands]]
            command = "step2"
            args.y = "fiz"


            [[bind]]
            name = "run_merged"
            key = "x"
            command = "runCommands"

            [[bind.args.commands]]
            command = "step1"
            args = {a = "foo", b = "bar"}

            [[bind.args.commands]]
            command = "step2"
            args = {x = "biz", y = "fiz"}
        "#;

        let result = toml::from_str::<HashMap<String, Vec<BindingInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let expected = result.get("bind").unwrap()[2].clone();
        let left = default.merge(left);

        assert_eq!(left.args, expected.args);
    }

    #[test]
    fn expands_foreach() {
        let data = r#"
            foreach.a = [1, 2]
            foreach.b = ["x", "y"]
            name = "test {{a}}-{{b}}"
            command = "run-{{a}}"
            args.value = "with-{{b}}"
        "#;

        let mut result = toml::from_str::<BindingInput>(data).unwrap();
        let items = result.expand_foreach().unwrap();

        let expected_command = vec!["run-1", "run-1", "run-2", "run-2"];
        let expected_value = vec!["with-x", "with-y", "with-x", "with-y"];
        let expected_name = vec!["test 1-x", "test 1-y", "test 2-x", "test 2-y"];

        for i in 0..4 {
            let item = items[i].clone();
            assert_eq!(
                item.command.as_ref().clone().unwrap().as_str(),
                expected_command[i]
            );
            assert_eq!(item.name.unwrap().as_ref().as_str(), expected_name[i]);
            assert_eq!(
                item.args
                    .unwrap()
                    .as_ref()
                    .get("value")
                    .unwrap()
                    .as_str()
                    .unwrap(),
                expected_value[i]
            );
        }
    }

    #[test]
    fn expand_foreach_keys() {
        let data = r#"
            foreach.key = ["{{key: [0-9]}}"]
            name = "update {{key}}"
            command = "foo"
            args.value = "{{key}}"
        "#;

        let mut result = toml::from_str::<BindingInput>(data).unwrap();
        let items = result.expand_foreach().unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(items.len(), 10);
        for i in 0..9 {
            assert_eq!(items[i].name.as_ref().unwrap().get_ref(), &expected_name[i]);
            let value = items[i].args.as_ref().unwrap().get_ref().get("value");
            assert_eq!(value.unwrap().as_str().unwrap(), expected_value[i]);
        }
    }

    // TODO: are there any edge cases / failure modes I want to look at in the tests
    // (most of the things seem likely to be covered by serde / toml parsing, and the
    // stuff I would want to check should be done at a higher level when I'm working
    // through default resolution across multiple commands rather than the within
    // command tests I'm working on here)
}

// TODO: define the "output" type for `Binding` that can actually be passed to javascript
