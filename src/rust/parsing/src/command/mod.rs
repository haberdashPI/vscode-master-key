#![allow(non_snake_case)]

mod constraints;
mod foreach;
mod validation;

use crate::command::foreach::{ForeachExpanding, ForeachInterpolated, expand_keys};
use crate::command::validation::{valid_json_array_object, valid_json_object, valid_key_binding};
use crate::error::{Error, Result, unexpected};
use crate::util::{Merging, Plural, Required, Requiring};

#[allow(unused_imports)]
use log::info;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen;
use toml::Value;
use validator::Validate;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn debug_parse_command(command_str: &str) -> std::result::Result<Command, JsError> {
    let result = toml::from_str::<CommandInput>(command_str)?;
    return Ok(Command::new(result)?);
}

fn default_mode() -> Plural<String> {
    return Plural::One("default".into());
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

impl<'a> Merging for CommandInput {
    fn merge(self, y: Self) -> Self {
        CommandInput {
            command: y.command.or(self.command),
            args: self.args.merge(y.args),
            computedArgs: self.computedArgs.merge(y.computedArgs),
            key: y.key.or(self.key),
            when: y.when.or(self.when),
            mode: y.mode.or(self.mode),
            priority: y.priority.or(self.priority),
            defaults: y.defaults.or(self.defaults),
            foreach: self.foreach,
            prefixes: y.prefixes.or(self.prefixes),
            finalKey: y.finalKey.or(self.finalKey),
            computedRepeat: y.computedRepeat.or(self.computedRepeat),
            name: y.name.or(self.name),
            description: y.description.or(self.description),
            hideInPalette: y.hideInPalette.or(self.hideInPalette),
            hideInDocs: y.hideInDocs.or(self.hideInDocs),
            combinedName: y.combinedName.or(self.combinedName),
            combinedKey: y.combinedKey.or(self.combinedKey),
            combinedDescription: y.combinedDescription.or(self.combinedDescription),
            kind: y.kind.or(self.kind),
            whenComputed: y.whenComputed.or(self.whenComputed),
        }
    }
}

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

impl CommandInput {
    fn has_foreach(&self) -> bool {
        if let Some(foreach) = &self.foreach {
            return foreach.len() > 0;
        }
        return false;
    }

    fn expand_foreach(&mut self) -> Result<Vec<CommandInput>> {
        let mut result = vec![self.clone()];
        while self.has_foreach() {
            result = self.expand_foreach_once(&result)?;
        }
        return Ok(result);
    }

    fn expand_foreach_once(&mut self, inputs: &Vec<CommandInput>) -> Result<Vec<CommandInput>> {
        let foreach = match &self.foreach {
            Some(foreach) => foreach,
            None => &toml::map::Map::new(),
        };
        let mut final_foreach = foreach.clone();
        let mut iter = foreach.iter();
        let first = iter.next();
        if let Some(item) = first {
            let (var, values) = item;
            final_foreach.remove(var);

            if let Value::Array(items) = values {
                info!("{items:?}");
                let expanded_items = expand_keys(items)?;
                info!("{expanded_items:?}");
                let mut result = Vec::with_capacity(inputs.len() * expanded_items.len());
                for input in inputs {
                    for value in &expanded_items {
                        let str = value.foreach_interpolation();
                        result.push(input.expand_foreach_value(var, &str));
                    }
                }
                self.foreach = Some(final_foreach);
                return Ok(result);
            } else {
                return unexpected("`foreach` was not an object of arrays");
            }
        } else {
            return Ok(vec![]);
        }
    }

    fn expand_foreach_value(&self, var: &str, value: &str) -> Self {
        return CommandInput {
            command: self.command.expand_foreach_value(var, value),
            args: self.args.expand_foreach_value(var, value),
            computedArgs: self.computedArgs.expand_foreach_value(var, value),
            key: self.key.expand_foreach_value(var, value),
            when: self.when.expand_foreach_value(var, value),
            mode: self.mode.expand_foreach_value(var, value),
            priority: self.priority,
            defaults: self.defaults.expand_foreach_value(var, value),
            prefixes: self.prefixes.expand_foreach_value(var, value),
            finalKey: self.finalKey,
            computedRepeat: self.computedRepeat.expand_foreach_value(var, value),
            foreach: None,
            name: self.name.expand_foreach_value(var, value),
            description: self.description.expand_foreach_value(var, value),
            hideInPalette: self.hideInPalette,
            hideInDocs: self.hideInDocs,
            combinedName: self.combinedName.expand_foreach_value(var, value),
            combinedKey: self.combinedKey.expand_foreach_value(var, value),
            combinedDescription: self.combinedDescription.expand_foreach_value(var, value),
            kind: self.kind.expand_foreach_value(var, value),
            whenComputed: self.whenComputed.expand_foreach_value(var, value),
        };
    }
}

// TODO: think about whether I want to represent commands as a sequence in the output...
impl Command {
    pub fn new(input: CommandInput) -> Result<Self> {
        if let Some(_) = input.foreach {
            return unexpected("`foreach` with unresolved variables");
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
    use std::collections::HashMap;
    use test_log::test;

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

    #[test]
    fn default_parsing() {
        let data = r#"
        key = "l"
        command = "cursorMove"
        args.to = "left"
        "#;

        let result = toml::from_str::<CommandInput>(data).unwrap();
        assert_eq!(result.key.unwrap(), "l");
        assert_eq!(result.command.unwrap(), "cursorMove");
        assert_eq!(
            result.args.unwrap().get("to").unwrap().as_str().unwrap(),
            "left"
        );

        assert_eq!(result.when, Plural::Zero);
        assert_eq!(result.combinedDescription, None);
        assert_eq!(result.combinedName, None);
    }

    #[test]
    fn simple_command_merging() {
        let data = r#"
        [[bind]]
        name = "default"
        command = "cursorMove"
        computedArgs.value = "count"
        prefixes = ["a"]

        [[bind]]
        key = "l"
        name = "←"
        args.to = "left"
        prefixes = ["b", "c"]
        "#;

        let result = toml::from_str::<HashMap<String, Vec<CommandInput>>>(data).unwrap();
        let default = result.get("bind").unwrap()[0].clone();
        let left = result.get("bind").unwrap()[1].clone();
        let left = default.merge(left);
        assert_eq!(left.key.unwrap(), "l");
        assert_eq!(left.command.unwrap(), "cursorMove");
        assert_eq!(
            left.args.unwrap().get("to").unwrap().as_str().unwrap(),
            "left"
        );
        assert_eq!(
            left.computedArgs
                .unwrap()
                .get("value")
                .unwrap()
                .as_str()
                .unwrap(),
            "count"
        );
        assert_eq!(left.prefixes, Plural::Many(vec!["b".into(), "c".into()]));

        assert_eq!(left.when, Plural::Zero);
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

        let result = toml::from_str::<HashMap<String, Vec<CommandInput>>>(data).unwrap();
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

        let result = toml::from_str::<HashMap<String, Vec<CommandInput>>>(data).unwrap();
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

        let mut result = toml::from_str::<CommandInput>(data).unwrap();
        let items = result.expand_foreach().unwrap();

        let expected_command = vec!["run-1", "run-1", "run-2", "run-2"];
        let expected_value = vec!["with-x", "with-y", "with-x", "with-y"];
        let expected_name = vec!["test 1-x", "test 1-y", "test 2-x", "test 2-y"];

        for i in 0..4 {
            let item = items[i].clone();
            assert_eq!(item.command.unwrap().as_str(), expected_command[i]);
            assert_eq!(item.name.unwrap().as_str(), expected_name[i]);
            assert_eq!(
                item.args.unwrap().get("value").unwrap().as_str().unwrap(),
                expected_value[i]
            );
        }
    }

    #[test]
    fn expand_foreach_keys() {
        let data = r#"
            foreach.key = ["{{key: [0-9}}"]
            name = "update {{key}}"
            command = "foo"
            args.value = "{{key}}"
        "#;

        let mut result = toml::from_str::<CommandInput>(data).unwrap();
        let items = result.expand_foreach().unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(items.len(), 10);
        for i in 0..9 {
            assert_eq!(items[i].name.as_ref().unwrap(), &expected_name[i]);
            assert_eq!(
                items[i]
                    .args
                    .as_ref()
                    .unwrap()
                    .get("value")
                    .unwrap()
                    .as_str()
                    .unwrap(),
                expected_value[i]
            )
        }
    }

    // TODO: are there any edge cases / failure modes I want to look at in the tests
    // (most of the things seem likely to be covered by serde / toml parsing, and the
    // stuff I would want to check should be done at a higher level when I'm working
    // through default resolution across multiple commands rather than the within
    // command tests I'm working on here)
}

// TODO: define the "output" type for `Command` that can actually be passed to javascript
