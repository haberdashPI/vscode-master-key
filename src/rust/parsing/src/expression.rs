// TODO: here is where we would want to invoke rhai to resolve any outstanding expressions

pub mod value;

#[allow(unused_imports)]
use log::info;

use std::collections::{HashMap, HashSet, VecDeque};

use rhai::Dynamic;
use serde::Serialize;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    bind::command::Command, bind::foreach::expression_fn__keys, err, error::ErrorContext,
    error::Result, error::ResultVec, expression::value::Expanding, expression::value::Value,
};

/// @file expressions/index.md
///
/// # Expressions
///
/// You can use expressions in a number of places inside a [bind](/bindings/bind)
/// definition. An expression is a snippet of code surrounded by double curly braces
/// <code v-pre>{{like + this}}</code> that occurs within a TOML string.
///
/// When the string is comprised entirely of a single expression, it can evaluate to any
/// valid TOML object.
///
/// **Example**
///
/// ```toml
/// [[define.val]]
/// action_priority = 3
///
/// [[bind]]
/// # ...other fields here...
/// priority = "{{val.action_priority + 2}}"
///
/// # after expression evaluation, the above would evaluate to
/// priority = 5
/// ```
///
/// If there is additional text in the string that falls outside of the expression, the
/// expression is interpolated into the string
///
/// ```toml
/// [[define.val]]
/// action_priority = 3
///
/// [[bind]]
/// # ...other fields here...
/// name = "My cool action (priority {{val.action_priority + 2}})"
///
/// # after expression evaluation, the above would evaluate to
/// name = "My cool action (priority 5)"
/// ```
///
/// Valid expressions are a simple subset of [Rhai](https://rhai.rs/book/ref/index.html).
/// You can only evaluate expressions not statements, and you cannot set variables, use
/// loops, or define functions. If you find yourself wanting to write an elaborate
/// expression, your goal is probably better accomplished by writing an
/// [extension](https://code.visualstudio.com/api) and running the extension
/// defined-command.
///
/// There are two points at which an expression can be evaluated: while parsing the master
/// keybinding file (e.g. making use of [foreach](/bindings/bind#foreach-clauses)) or at
/// runtime: when the user presses a key.
///
/// ## Read-time Evaluation
///
/// Read-time expressions are computed directly after a keybinding file (and any user
/// defined bindings) have been loaded. The following values are in scope:
///
/// - Any field defined in a [`[[define.val]]`](/bindings/define) section. These variables
///   are all stored under the top-level `val.` object.
/// - Variables defined by [`foreach`](/bindings/bind#foreach-clauses)
/// - `keys([regex]):` returns all keys matching the regular expression defined by the given
///   string
/// - `all_modes()`: returns an array of strings all keybinding modes defined by the current
///   keybinding set
/// - `not_modes([exclusions])`: given an array of strings of excluded modes, returns
///   all keybinding modes defined by the current keybinding set that are not among these
///   exclusions.
///
/// ## Run-time Evaluation
///
/// Fields for which expressions are evaluated at run time are clearly denoted as such with
/// a ⚡ symbol. The are computed directly after a user presses the given keybinding. They
/// have access to the following values:
///
/// - any value available at read-time (see above)
/// - `code.editorHasSelection`: true if there is any selection, false otherwise
/// - `code.editorHasMultipleSelections`: true if there are multiple selections, false
///   otherwise
/// - `code.firstSelectionOrWord`: the first selection, or the word under the first cursor
///   if the selection is empty
/// - `code.editorLangId`: the [language
///   id](https://code.visualstudio.com/docs/languages/identifiers) of the current editor or
///   the empty string if there is no current editor (or no language id for that editor)
/// - `key.mode`: the current keybinding mode
/// - `key.count`: The current count, as defined by
///   [`master-key.updateCount`](/commands/updateCount)
/// - `key.captured`: The text currently captured by the most recent call to
///   [`master-key.restoreNamed`](/commands/restoreNamed) or
///   [`master-key.captureKeys`](/commands/captureKeys).
/// - `key.prefix`: The currently active [keybinding prefix](/commands/prefix)
/// - `key.record`: a boolean flag used to indicate when keys are marked for recording
/// - `key.commandsHistory`: an array containing all previously run master key commands, up
///   to the number configured by Master Key's "Command History Maximum" (defaults to 1024).
///   Commands are stored from least recent (smallest index) to most recent (largest index).

#[wasm_bindgen]
pub struct Scope {
    pub(crate) asts: HashMap<String, rhai::AST>,
    pub(crate) engine: rhai::Engine,
    pub(crate) modes: HashSet<String>,
    pub(crate) kinds: HashSet<String>,
    pub(crate) default_mode: String,
    pub(crate) state: rhai::Scope<'static>,
    pub(crate) queues: HashMap<String, VecDeque<Command>>,
}

// TODO: we'll need to define `CustomType` on `Value` and `Command`
#[wasm_bindgen]
impl Scope {
    // TODO: incorporate command queues
    pub(crate) fn expand<T>(&mut self, obj: &T) -> ResultVec<T>
    where
        T: Expanding + Clone,
    {
        for (k, v) in self.queues.iter() {
            // TODO: tell engine how to handle dequeues
            // TODO: I don't love that we have to copy the queue for every evaluation
            // this will have to be fixed to avoid ridiculous amounts of copying
            // per command run

            // PLAN: make queue type a CustomType and track it in `state` instead of
            // in `queues`.
            self.state.set_or_push(k, v.clone());
        }
        return Ok(obj.clone().map_expressions(&mut |expr| {
            let ast = &self.asts[&expr.content];

            let rewind_to = self.state.len();
            for (k, v) in &expr.scope {
                let val: Dynamic = From::<Value>::from(Value::new(v.clone(), None)?);
                self.state.push_dynamic(k, val);
            }
            let dynamic: Dynamic = self
                .engine
                .eval_ast_with_scope(&mut self.state, ast)
                .with_exp_range(&expr.span)?;
            self.state.rewind(rewind_to);
            let result_value: std::result::Result<Value, _> = dynamic.clone().try_into();
            let value = result_value
                .with_message(format!(" while evaluating:\n{expr}"))
                .with_exp_range(&expr.span)?;
            return Ok(value);
        })?);
    }

    pub(crate) fn parse_asts(&mut self, x: &(impl Expanding + Clone)) -> ResultVec<()> {
        x.clone().map_expressions(&mut |expr| {
            if let Some(e) = expr.error {
                return Err(e)?;
            }
            let ast = self
                .engine
                .compile_expression(expr.content.clone())
                .with_exp_range(&expr.span)?;
            self.asts.insert(expr.content.clone(), ast);
            return Ok(Value::Exp(expr));
        })?;
        return Ok(());
    }

    #[wasm_bindgen(constructor)]
    pub fn new() -> Scope {
        let mut engine = rhai::Engine::new();
        engine.set_allow_looping(false);
        engine.set_allow_statement_expression(false);
        engine.register_fn("keys", expression_fn__keys);

        return Scope {
            asts: HashMap::new(),
            engine: engine,
            state: rhai::Scope::new(),
            default_mode: "default".to_string(),
            modes: HashSet::from(["default".to_string()]),
            kinds: HashSet::new(),
            queues: HashMap::new(),
        };
    }

    pub fn set(&mut self, name: String, value: JsValue) -> Result<()> {
        let toml: toml::Value = match serde_wasm_bindgen::from_value(value) {
            Err(e) => Err(err!("{}", e))?,
            Ok(x) => x,
        };
        let val: Value = toml.try_into()?;
        let val: Dynamic = val.into();
        self.state.set_or_push(&name, val);
        return Ok(());
    }

    pub fn unset(&mut self, name: String) -> Result<()> {
        return Ok(self
            .state
            .remove(&name)
            .ok_or_else(|| err!("`{name}` is undefined"))?);
    }

    pub fn get(&self, name: String) -> Result<JsValue> {
        let x: &rhai::Dynamic = self
            .state
            .get(&name)
            .ok_or_else(|| err!("`{name}` is undefined"))?;
        let x: Value = match x.clone().try_cast_result() {
            Err(e) => Err(err!("{x} is not a valid JSON value: {e}"))?,
            Ok(x) => x,
        };
        let x: toml::Value = x.into();
        let to_json = serde_wasm_bindgen::Serializer::json_compatible();
        return match x.serialize(&to_json) {
            Err(e) => Err(err!("JSON serialization error: {e}"))?,
            Ok(x) => Ok(x),
        };
    }

    pub fn add_to_command_queue(&mut self, queue: String, x: Command) {
        let queue = self.queues.entry(queue).or_insert_with(|| VecDeque::new());
        queue.push_back(x);
        // TODO: pop queue if it gets too large
    }

    pub fn pop_command_queue(&mut self, queue: String) -> Option<Command> {
        let queue = self.queues.entry(queue).or_insert_with(|| VecDeque::new());
        return queue.pop_front();
    }

    // TODO: function to evaluate args of replay and return a range of expressions
    // to replay in type script
}

mod tests {
    #[allow(unused_imports)]
    use super::*;
    use test_log::test;

    #[test]
    fn expression_paren_error() {
        let data = r#"
        joe = "{{(1 + 3}}"
        "#;
        let value: Value = toml::from_str(data).unwrap();

        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();
        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();

        assert_eq!("3", val);
        assert!(message.contains("Expecting ')'"));
    }

    #[test]
    fn expression_operator_error() {
        let data = r#"
        joe = "{{(1 # 3}}"
        "#;
        let value: Value = toml::from_str(data).unwrap();

        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();
        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col + 1)..=(range.end.col + 1)].to_string();

        assert_eq!("#", val);
        assert!(message.contains("Unknown operator"))
    }

    #[test]
    fn expression_bracket_error() {
        let data = r#"
        joe = "{{joe.bob {{ bill}}"
        "#;
        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();

        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();
        assert_eq!("{{joe.bob {{ bill", val);
        assert!(message.contains("unexpected `{{`"));
    }

    #[test]
    fn expression_bracket_error_2() {
        let data = r#"
        joe = "{{joe.bob.bill}} bob.fob}}"
        "#;
        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();

        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();
        assert_eq!(r#" "{{joe.bob.bill}} bob.fob}}""#, val);
        assert!(message.contains("unexpected `}}`"));
    }

    #[test]
    fn expression_bracket_error_3() {
        let data = r#"
        joe = "joe.bob.bill bob.fob}}"
        "#;
        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();

        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();
        assert_eq!(r#" "joe.bob.bill bob.fob}}""#, val);
        assert!(message.contains("unexpected `}}`"));
    }

    #[test]
    fn expression_bracket_error_4() {
        let data = r#"
        joe = "{{joe.bob.{{bill bob}}.fob}}"
        "#;
        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();

        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();
        assert_eq!(r#"{{joe.bob.{{bill bob"#, val);
        assert!(message.contains("unexpected `"));
    }

    #[test]
    fn expression_bracket_error_5() {
        let data = r#"
        joe = "{{joe.bob}}.{{bill.bob}}.fob{{"
        "#;
        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();

        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();
        info!("report: {report:#?}");
        assert!(message.contains("unexpected `{{`"));
    }

    #[test]
    fn expression_bracket_error_6() {
        let data = r#"
        joe = "{{joe.bob}}.{{bill.bob}}.fob{{"
        "#;
        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();

        let report = err.report(data.as_bytes());
        let message = report.first().unwrap().message.clone();
        let range = report.first().unwrap().range.clone();
        let val: String = data[(range.start.col)..=(range.end.col)].to_string();
        info!("report: {report:#?}");
        assert!(message.contains("unexpected `{{`"));
    }

    #[test]
    fn clean_expression_error_locations() {
        let data = r#"
        bob = "{{x # y}}"
        "#;

        let value: Value = toml::from_str(data).unwrap();
        let mut scope = Scope::new();
        let err = scope.parse_asts(&value).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(!report[0].message.contains("(line"))
    }
}
