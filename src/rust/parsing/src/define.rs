#[allow(unused_imports)]
use log::info;

use indexmap::IndexMap;
use lazy_static::lazy_static;
use regex::Regex;
use rhai::Dynamic;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, hash_map};
use toml::Spanned;

use crate::bind::BindingInput;
use crate::bind::command::CommandInput;
use crate::bind::validation::BindingReference;
use crate::error::{ErrorContext, ParseError, Result, ResultVec, err};
use crate::expression::Scope;
use crate::expression::value::{Expanding, Expression, Value};
use crate::util::{Merging, Resolving};
use crate::{err, wrn};

/// @bindingField define
/// @description object of arbitrary fields which can be used in
/// computed arguments.
///
/// The `define` field can be used to define re-usable values. There are three types of
/// values that can be defined.
///
/// 1. `[[define.val]]:` variable definitions: defines any number of key-value pairs that can
///    be referenced inside an [expression](/expressions/index)
/// 2. `[[define.command]]`: command definitions: defines one or more commands that can be
///    referenced when [running multiple commands](/bindings/bind#running-multiple-commands).
/// 3. `[[define.bind]]`: bind definitions: defines a partial set of `command` fields that can
///    be referenced using the `default` field of [bind](/bindings/bind).
///
#[derive(Deserialize, Clone, Debug, Default)]
pub struct DefineInput {
    /// @forBindingField define
    ///
    /// ## Variable Definitions
    ///
    /// These can be any arbitrary TOML value. You can define multiple variables within
    /// each `[[define.val]]` element this way. These are then available in any
    /// [expressions](/expressions/index)
    /// evaluated at runtime and in [when clauses](/bindings/bind#available-when-contexts).
    ///
    /// ### Example
    ///
    /// A common command pattern in Larkin is to allow multiple lines to be selected using a
    /// count followed by the operation to perform on those lines. The line selection is
    /// defined as follows
    ///
    /// To handle symmetric insert of brackets, Larkin uses the following definition
    ///
    /// ```toml
    /// [define.braces]
    /// "{".before = "{"
    /// "{".after = "}"
    /// "}".before = "{"
    /// "}".after = "}"
    /// "[".before = "["
    /// "[".after = "]"
    /// "]".before = "["
    /// "]".after = "]"
    /// "(".before = "("
    /// "(".after = ")"
    /// ")".before = "("
    /// ")".after = ")"
    /// "<".before = "<"
    /// "<".after = ">"
    /// ">".before = "<"
    /// ">".after = ">"
    /// ```
    ///
    /// This is then applied when handling symmetric typing using the
    /// [`onType`](/bindings/mode#ontype-field) field of `[[mode]]`.
    ///
    /// ```toml
    /// [[mode]]
    /// name = "syminsert"
    /// highlight = "Highlight"
    /// cursorShape = "BlockOutline"
    ///
    /// [[mode.onType]]
    /// command = "selection-utilities.insertAround"
    /// args.before = "{{braces[captured].?before ?? captured}}"
    /// args.after = "{{braces[captured].?after ?? captured}}"
    /// args.followCursor = true
    /// ```
    pub val: Option<Vec<IndexMap<String, Spanned<Value>>>>,
    /// @forBindingField define
    ///
    /// ## Command Definitions
    ///
    /// You can define re-usable commands that can be run when running
    /// [running multiple commands](/bindings/bind#running-multiple-commands).
    ///
    /// In addition the normal fields of a command, you must provide an `id` to refer to the
    /// command as <span v-pre>`{{command.[id]}}`</span>.
    ///
    /// ### Example
    ///
    /// Larkin defines commands to select N lines downwards
    ///
    /// ```toml
    /// [[define.command]]
    /// id = "selectLinesDown"
    /// command = "runCommands"
    /// args.commands = [
    ///     "selection-utilities.shrinkToActive",
    ///     { skipWhen = "{{count <= 0}}", command = "cursorMove", args = { to = "down", by = "wrappedLine", select = true, value = "{{count}}" } },
    ///     "expandLineSelection",
    ///     "selection-utilities.exchangeAnchorActive",
    /// ]
    /// ```
    /// And uses this definition is as follows
    ///
    /// ```toml
    /// [[bind]]
    /// default = "{{bind.edit_action}}"
    /// key = "c"
    /// when = "!editorHasSelection && master-key.count > 1"
    /// command = "runCommands"
    /// args.commands = [
    ///     "{{command.selectLinesDown}}",
    ///     "deleteRight",
    ///     "editor.action.insertLineBefore",
    ///     "master-key.enterInsert",
    /// ]
    /// ```
    pub command: Option<Vec<Spanned<CommandInput>>>,
    /// @forBindingField define
    ///
    /// ## Binding Definitions
    ///
    /// You can define partial [bind](/bindings/bind) definitions, e.g. for common default
    /// values to use across many bindings.
    ///
    /// The `args` field is merged recursively, allowing you to specify some arguments in
    /// the default `[[define.bind]]` and others in `[[bind]]` directly.
    ///
    /// ### Example
    ///
    /// Larkin makes extensive use of this for the simple cursor motions. The default
    /// command is always `cursorMove` and each motion indications in what direction to move
    /// using `args.value.`
    ///
    /// ```toml
    /// [[define.bind]]
    /// id = "edit_motion_prim"
    /// default = "{{bind.edit_motion}}"
    /// command = "cursorMove"
    /// args.value = "{{count}}"
    /// args.select = "{{editorHasSelection}}"
    ///
    /// [[bind]]
    /// default = "{{bind.edit_motion_prim}}"
    /// key = "h"
    /// args.to = "left"
    /// mode = "normal"
    ///
    /// [[bind]]
    /// default = "{{bind.edit_motion_prim}}"
    /// key = "l"
    /// args.to = "right"
    /// ```
    ///
    /// This example also demonstrates that `define.bind` definitions can themselves have
    /// defaults, allowing for a hierarchy of defaults if so desired.
    ///
    pub bind: Option<Vec<Spanned<BindingInput>>>,

    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Define {
    #[serde(skip)]
    pub bind: HashMap<String, BindingInput>,
    #[serde(skip)]
    pub command: HashMap<String, CommandInput>,
    pub val: HashMap<String, Value>,
}

lazy_static! {
    pub static ref BIND_REF: Regex = Regex::new(r"^bind\.([\w--\d]+\w*)$").unwrap();
    pub static ref COMMAND_REF: Regex = Regex::new(r"^command\.([\w--\d]+\w*)$").unwrap();
}

impl Define {
    pub fn new(
        input: DefineInput,
        scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<Define> {
        let mut resolved_bind = HashMap::<String, BindingInput>::new();
        let mut resolved_command = HashMap::<String, CommandInput>::new();
        let mut resolved_var = HashMap::<String, Value>::new();
        let mut errors: Vec<ParseError> = Vec::new();

        for def_block in input.val.into_iter().flatten() {
            for (val, value) in def_block.into_iter() {
                match value.resolve("`define.val`", scope) {
                    Ok(x) => {
                        resolved_var.insert(val, x);
                    }
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                    }
                }
            }
        }

        for def in input.command.into_iter().flatten() {
            let id = def.get_ref().id.clone();
            let span = id
                .ok_or_else(|| err("requires `id` field"))
                .with_range(&def.span());
            match span {
                Err(e) => errors.push(e.into()),
                Ok(x) => match x.resolve("`id`", scope) {
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                    }
                    Ok(id) => {
                        resolved_command.insert(id, def.into_inner());
                    }
                },
            }
        }

        for def in input.bind.into_iter().flatten() {
            let id = def.get_ref().id.clone();
            let span = id
                .ok_or_else(|| err("requires `id` field"))
                .with_range(&def.span());
            match span {
                Err(e) => errors.push(e.into()),
                Ok(x) => match x.resolve("`id`", scope) {
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                    }
                    Ok(x) => {
                        resolved_bind.insert(x, def.into_inner());
                    }
                },
            }
        }

        // warning about unknown fields
        for (key, _) in &input.other_fields {
            // XXX:: we have no good way of detecting the byte range of these items using
            // TOML without radically change the `DefineInput` data structure. We fallback
            // to showing an error at the top of the file (UNKNOWN_RANGE values are expected
            // to be resolved by the time we print out an error, so we can't use that)
            let err: Result<()> = Err(wrn!(
                "The `define.{}` section in this file is unrecognized and will be ignored",
                key,
            ))
            .with_range(&(0..1));
            warnings.push(err.unwrap_err());
        }

        if errors.len() > 0 {
            return Err(errors.into());
        } else {
            // TODO: because resolution to the Binding and Command structs does not occur until
            // later, we could, in theory end up with a *lot* of errors for the same lines, it
            // will be important to clean up the output to only show one of these errors and
            // remove the other instances; or convince our selves no such issue will arise
            return Ok(Define {
                bind: resolved_bind,
                command: resolved_command,
                val: resolved_var,
            });
        }
    }

    pub fn add_to_scope(&self, scope: &mut Scope) -> ResultVec<()> {
        let mut val = rhai::Map::new();
        for (k, v) in self.val.iter() {
            v.require_constant()?;
            let item: Dynamic = v.clone().into();
            val.insert(k.into(), item);
        }
        scope.state.set_or_push("val", val);
        return Ok(());
    }

    pub fn expand(&mut self, binding: BindingInput) -> ResultVec<BindingInput> {
        // resolve default values
        let binding = if let Some(ref default) = binding.default {
            let BindingReference(name) = default.as_ref();
            let entry = self.bind.entry(name.clone());
            let occupied_entry = match entry {
                hash_map::Entry::Vacant(_) => Err(err!("{name}"))?,
                hash_map::Entry::Occupied(entry) => entry,
            };
            let mut default_value;
            if !occupied_entry.get().is_constant() {
                default_value = occupied_entry.remove();
                default_value = self.expand(default_value)?;
                self.bind.insert(name.clone(), default_value.clone());
            } else {
                default_value = occupied_entry.get().clone()
            }
            default_value.without_id().merge(binding)
        } else {
            binding
        };

        return binding.map_expressions(&mut |exp: Expression| {
            let command = COMMAND_REF.captures(&exp.content);
            if let Some(captures) = command {
                let name = captures.get(1).expect("variable name").as_str();
                return Ok(self
                    .command
                    .get(name)
                    .ok_or_else(|| err!("`{name}` is undefined"))?
                    .without_id()
                    .into());
            }
            if BIND_REF.is_match(&exp.content) {
                return Err(err(
                    "unexpected `bind.` reference; only valid inside `bind.default`",
                ))?;
            }
            return Ok(Value::Exp(exp));
        });
    }
}

mod tests {
    use test_log::test;

    #[allow(unused_imports)]
    use super::*;
    #[allow(unused_imports)]
    use crate::resolve;

    #[allow(dead_code)]
    fn unwrap_table(x: &Value) -> HashMap<String, Value> {
        match x {
            Value::Table(x, _) => x.clone(),
            _ => panic!("Expected a table!"),
        }
    }

    #[test]
    fn simple_parsing() {
        let data = r#"
        [[val]]
        y = "bill"

        [[bind]]
        id = "foo"
        key = "x"
        command = "foo"
        args = { k = 1, h = 2 }

        [[command]]
        id = "foobar"
        command = "runCommands"
        args.commands = ["foo", "bar"]

        [[val]]
        joe = "bob"

        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = Define::new(
            toml::from_str::<DefineInput>(data).unwrap(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(result.val.get("y").unwrap(), &Value::String("bill".into()));
        assert_eq!(result.val.get("joe").unwrap(), &Value::String("bob".into()));
        let foo = result.bind.get("foo").unwrap();
        assert_eq!(foo.key.as_ref().to_owned().unwrap().unwrap(), "x");
        let args = foo.args.as_ref().unwrap().clone().into_inner();
        assert_eq!(
            unwrap_table(&args),
            HashMap::from([
                ("k".into(), Value::Integer(1)),
                ("h".into(), Value::Integer(2))
            ])
        );

        let foobar = result.command.get("foobar").unwrap();
        let command: String = resolve!(foobar.clone(), command, &mut scope).unwrap();
        assert_eq!(command, "runCommands");
        let commands = foobar.args.as_ref().unwrap().clone().into_inner();
        assert_eq!(
            unwrap_table(&commands),
            HashMap::from([(
                "commands".into(),
                Value::Array(vec![
                    Value::String("foo".into()),
                    Value::String("bar".into())
                ])
            )])
        );
    }
}
