// TODO: here is where we would want to invoke rhai to resolve any outstanding expressions

pub mod value;

#[allow(unused_imports)]
use log::info;

use log::error;
use rhai::{Dynamic, Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use wasm_bindgen::JsValue;

use crate::{
    bind::command::CommandOutput,
    bind::{BindingDoc, CombinedBindingDoc, ReifiedBinding, foreach::expression_fn__keys},
    err,
    error::{ErrorContext, RawError, Result, ResultVec},
    expression::value::{Expanding, Value},
    note,
};

/// @file expressions/index.md
///
/// # Expressions
///
/// You can use expressions in a number of places inside a [bind](/bindings/bind)
/// definition. An expression is a snippet of code surrounded by double curly braces <code
/// v-pre>{{like + this}}</code> that occurs within a TOML string.
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
/// Valid expressions are a simple derivative of
/// [Rhai](https://rhai.rs/book/ref/index.html). The constraints are:
///   1. You can only evaluate expressions not statements
///   2. You cannot set variables
///   3. You cannot use loops
///   4. You cannot define named functions
///
/// If you find yourself wanting to write more than a few relatively simple lines, your goal
/// is probably better accomplished by writing an
/// [extension](https://code.visualstudio.com/api) and running the extension-defined
/// command.
///
/// There are two points at which an expression can be evaluated: while parsing the master
/// keybinding file (e.g. making use of [foreach](/bindings/bind#foreach-clauses)) or at
/// runtime: when the user presses a key.
///
/// ## Read-time Evaluation
///
/// Read-time expressions are computed directly after a keybinding file has been loaded.
/// The following values are in scope:
///
/// - Any field defined in a [`[[define.val]]`](/bindings/define) section. These variables
///   are all stored under the top-level `val.` object.
/// - Variables defined by [`foreach`](/bindings/bind#foreach-clauses)
/// - `keys([regex]):` returns all valid keys (as per `key` in `keybindings.json`) matching
///   the regular expression
/// - `all_modes()`: returns an array of strings of all keybinding modes defined by the
///   current keybinding set. It does not include the automatically defined mode
///   `"capture"`. It is rarely advised to define bindings for this mode.
///   The "capture" is used to capture keys typed during
///   [`master-key.search`](/commands/search)
///   and [`master-key.captureKeys`](/commands/captureKeys). Defining bindings for
///   a key will prevent it from being captured by these commands.
/// - `not_modes([exclusions])`: given an array of strings of excluded modes, returns all
///   keybinding modes defined by the current keybinding set that are not among these
///   exclusions. Like `all_modes` the mode "capture" is not included.
///
/// ## Run-time Evaluation
///
/// Fields for which expressions are evaluated at run time are clearly denoted as such with
/// a ⚡ symbol. They are computed after a user presses the given keybinding. When there are
/// multiple commands run for a keybinding (via `runCommands`) the expressions for a given
/// command are evaluated after all previous commands have executed.
///
/// Run-time expressions have access to the following values:
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
///   [`master-key.captureKeys`](/commands/captureKeys).
/// - `key.prefix`: The currently active [keybinding prefix](/commands/prefix)
/// - `key.record`: a boolean flag used to indicate when keys are marked for recording
/// - `history`: a queue containing a record of all previously run master key commands, up
///   to the number configured by Master Key's "Command History Maximum" (defaults to 1024).
///   See [master-key.replayFromHistory](/commands/replayFromHistory) for details.
///
/// ## Debugging
///
/// You can use the function `show` to print out a message in VSCode's output pane. It
/// accepts two arguments: a string to print and a value. The value is printed after the
/// string and it is also returned as the result of show. This allows you to insert show
/// wherever you want within an expression.
///
/// ```toml
/// [[bind]]
/// key = "j"
/// mode = "normal"
/// command = "cursorMove"
/// args.to = "right"
/// args.value = '{{show("count: ", 1+2)}}'
/// ```
///
/// This would print the string `"count: 3"` to the output pane whenever the user presses
/// the `j` key in normal mode.

/// Scope tracks all information we need to execute rhai expressions inside our keybinding
/// file
#[derive(Debug, Serialize, Deserialize)]
pub struct Scope {
    // the pre-parsed abstract syntax trees for each unique expression
    #[serde(skip)]
    pub(crate) asts: HashMap<String, rhai::AST>,
    // the engine used to execute expressions
    #[serde(skip)]
    pub(crate) engine: rhai::Engine,
    // a list of all keybinding modes (used for validation)
    pub(crate) modes: HashSet<String>,
    // a list of all kinds (used for validation)
    pub(crate) kinds: HashSet<String>,
    // the default mode (used for validation)
    pub(crate) default_mode: String,
    // the current set of variable values to use when evaluating expressions
    #[serde(skip)]
    pub(crate) state: rhai::Scope<'static>,
    // a list of messages generated by Rhai expressions, shows in the output pane in VSCode
    #[serde(skip)]
    pub(crate) messages: Rc<RefCell<Vec<String>>>,
}

// TODO: populate `state`, asts` and `engine` after deserializing

// toml_to_dynamic converts a TOML value to a rhai::Dynamic value
// this code is only covered by KeyFileResult which is run during integration tests
#[cfg_attr(coverage_nightly, coverage(off))]
fn toml_to_dynamic(x: toml::Value) -> rhai::Dynamic {
    // TODO: there might be a more efficient approach to the containers that avoids more
    // copying
    return match x {
        toml::Value::Float(x) => Dynamic::from(x),
        toml::Value::Integer(x) => Dynamic::from(x),
        toml::Value::Boolean(x) => Dynamic::from(x),
        toml::Value::String(x) => Dynamic::from(x),
        toml::Value::Datetime(x) => Dynamic::from(x.to_string()),
        toml::Value::Array(xs) => {
            let elements: Vec<Dynamic> = xs.into_iter().map(|x| toml_to_dynamic(x)).collect();
            elements.into()
        }
        toml::Value::Table(x) => {
            let map: HashMap<String, Dynamic> = x
                .into_iter()
                .map(|(k, v)| (k, toml_to_dynamic(v)))
                .collect();
            map.into()
        }
    };
}

// the type used to store command history
pub type HistoryQueue = Rc<RefCell<VecDeque<ReifiedBinding>>>;
// the type used to store all command macros that have been recorded
pub type MacroStack = Rc<RefCell<Vec<Vec<ReifiedBinding>>>>;

// TODO: define `CustomType` on `Value` and `Command` to avoid copying
impl Scope {
    // NOTE: `init` is seperate from `new` so that we can call it on a deserialized value
    pub fn init(&mut self) {
        // the engine is how expressions get evaluated
        self.engine.set_allow_looping(false);
        self.engine.set_allow_statement_expression(false);

        // some types and functions expressions have access to
        self.engine.register_fn("keys", expression_fn__keys);
        self.engine
            .build_type::<BindingDoc>()
            .build_type::<CombinedBindingDoc>()
            .build_type::<CommandOutput>()
            .build_type::<ReifiedBinding>();

        // messages are displayed in the output are of VSCode
        let show_messages = self.messages.clone();
        self.engine.register_fn(
            "show",
            move |x: ImmutableString, y: rhai::Dynamic| -> rhai::Dynamic {
                show_messages.borrow_mut().push(format!("{}{}", x, y));
                return y;
            },
        );

        // some variables that expressions have access to
        self.state.set_or_push("key", rhai::Map::new());
        self.state.set_or_push("val", rhai::Map::new());
        self.state.set_or_push("code", rhai::Map::new());

        // command history
        let history: HistoryQueue = Rc::new(RefCell::new(VecDeque::new()));
        let noop = ReifiedBinding::noop(&self);
        history.borrow_mut().push_back(noop);
        self.state.set_or_push("history", history.clone());
        define_history_queue_api(&mut self.engine, history.clone());

        // macro stack
        let macros: MacroStack = Rc::new(RefCell::new(Vec::new()));
        self.state.set_or_push("macros", macros);
    }

    pub fn new() -> Scope {
        let mut scope = Scope {
            asts: HashMap::new(),
            engine: rhai::Engine::new(),
            messages: Rc::new(RefCell::new(Vec::new())),
            state: rhai::Scope::new(),
            default_mode: "default".to_string(),
            modes: HashSet::from(["default".to_string()]),
            kinds: HashSet::new(),
        };

        scope.init();
        return scope;
    }

    // access the messages that will be posted to VSCode output window
    pub fn report_messages(&self) -> Vec<String> {
        return self.messages.borrow_mut().drain(..).collect();
    }

    // extract the messages as `ParseError` warnings this is necessary when the messages
    // occur at parse time instead of run time
    pub fn messages_as_warnings(&self, warnings: &mut Vec<crate::error::ParseError>) {
        for msg in self.messages.borrow_mut().drain(..) {
            warnings.push(note!("{}", msg));
        }
    }

    // `expand` converts some general value (e.g. `expression::value::Value`)
    // by replacing its expressions with the evaluated result of each expression
    pub(crate) fn expand<T>(&mut self, obj: &T) -> ResultVec<T>
    where
        T: Expanding + Clone,
    {
        return Ok(obj.clone().map_expressions(&mut |expr| {
            if let Some(_) = expr.error {
                // errors stored in the expression are raised in `parse_asts` which must be
                // run before `expand`, so we can safely call this a repeat error
                return Err(RawError::RepeatError.into());
            }
            if let Some(ast) = self.asts.get(&expr.content) {
                let rewind_to = self.state.len();
                for (k, v) in &expr.scope {
                    let val: Dynamic = v.clone().into();
                    self.state.push_dynamic(k, val);
                }
                let dynamic: Dynamic = self
                    .engine
                    .eval_ast_with_scope(&mut self.state, ast)
                    .with_message(format!(" (while evaluating {expr})"))
                    .with_exp_range(&expr.span)?;
                self.state.rewind(rewind_to);
                let result_value: std::result::Result<Value, _> = dynamic.clone().try_into();
                let value = result_value
                    .with_message(format!(" (while evaluating {expr})"))
                    .with_exp_range(&expr.span)?;
                return Ok(value);
            } else {
                // if the ast element doesn't exist this is *probably* because it failed to
                // compile. If so, we've already generated an error. If not, it's a bug. So
                // we log the problem, but do not report the issue through error handling.
                error!("No ast defined for expression: {}", expr);
                return Err(RawError::RepeatError.into());
            }
        })?);
    }

    // `parse_asts` (abstract syntax trees) should be run once expandable objects have been
    // defined, so that we can evaluate the expressions using `expand` at some later date
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

    // there are three namespaces from which we can get values `key.`, `val.` and `code.`
    #[cfg_attr(coverage_nightly, coverage(off))]
    fn get_namespace<'a>(
        &self,
        name: &str,
    ) -> Result<impl std::ops::Deref<Target = rhai::Map> + '_> {
        let namespace_object = if let Some(val) = self.state.get(name) {
            val
        } else {
            return Err(err!("Namespace `{name}` does not exist"))?;
        };

        return match namespace_object.as_map_ref() {
            Ok(x) => Ok(x),
            Err(t) => Err(err!("Namespace `{name}` is of unexpected type `{t}`"))?,
        };
    }

    #[cfg_attr(coverage_nightly, coverage(off))]
    fn get_mut_namespace<'a>(
        &mut self,
        name: &str,
    ) -> Result<impl std::ops::DerefMut<Target = rhai::Map> + '_> {
        let namespace_object = if let Some(val) = self.state.get_mut(name) {
            val
        } else {
            return Err(err!("Namespace `{name}` does not exist"))?;
        };

        return match namespace_object.as_map_mut() {
            Ok(x) => Ok(x),
            Err(t) => Err(err!("Namespace `{name}` is of unexpected type `{t}`"))?,
        };
    }

    // public facing set of variables within one of the valid namespaces
    #[cfg_attr(coverage_nightly, coverage(off))]
    pub fn set(&mut self, namespace: &str, name: &str, value: JsValue) -> Result<()> {
        let toml: toml::Value = match serde_wasm_bindgen::from_value(value) {
            Err(e) => Err(err!("{} while converting js to toml value", e))?,
            Ok(x) => x,
        };
        let val: Dynamic = toml_to_dynamic(toml);
        self.get_mut_namespace(namespace)?.insert(name.into(), val);
        return Ok(());
    }

    // public facing get of variables within one of the valid namespaces
    #[cfg_attr(coverage_nightly, coverage(off))]
    pub fn get(&self, namespace: &str, name: &str) -> Result<JsValue> {
        if let Some(rhai_value) = self.get_namespace(namespace)?.get(name) {
            let value: Value = rhai_value.clone().try_into()?;
            let toml: toml::Value = value.into();
            let to_json = serde_wasm_bindgen::Serializer::json_compatible();
            let js_val = match toml.serialize(&to_json) {
                Err(e) => Err(err!("While serializing `{name}` {}", e))?,
                Ok(x) => x,
            };
            return Ok(js_val);
        } else {
            return Ok(js_sys::Object::new().into());
        }
    }

    // lists all values that are under the namespace `val.`
    #[cfg_attr(coverage_nightly, coverage(off))]
    pub fn get_defined_vals(&self) -> Result<Vec<String>> {
        return Ok(self
            .get_namespace("val")?
            .keys()
            .map(|x| x.as_str().to_string())
            .collect());
    }

    // pub fn unset(&mut self, name: &str) -> Result<()> {
    //     return Ok(self
    //         .state
    //         .remove(name)
    //         .ok_or_else(|| err!("`{name}` is undefined"))?);
    // }

    // TODO: function to evaluate args of replay and return a range of expressions
    // to replay in type script
}

fn define_history_queue_api(engine: &mut Engine, history: HistoryQueue) {
    engine
        .register_type_with_name::<HistoryQueue>("HistoryQueue")
        .register_fn("is_empty", |x: &mut HistoryQueue| x.borrow().is_empty())
        .register_fn("len", |x: &mut HistoryQueue| x.borrow().len() as i64)
        .register_fn(
            "last_history_index",
            move |context: rhai::NativeCallContext, f: rhai::FnPtr| {
                last_index_of_history(context, history.clone(), f)
            },
        )
        .register_indexer_get(
            |x: &mut HistoryQueue, i: i64| match x.borrow().get(i as usize) {
                Some(x) => Dynamic::from(x.clone()),
                Option::None => Dynamic::from(()),
            },
        );
}

// this code is only covered by expressions run during integration tests it shows up as
// `last_history_index` in expressions
#[cfg_attr(coverage_nightly, coverage(off))]
fn last_index_of_history(
    context: rhai::NativeCallContext, // implicit argument, required to call a closure
    queue: HistoryQueue,
    f: rhai::FnPtr,
) -> std::result::Result<usize, Box<EvalAltResult>> {
    let n = queue.borrow().len();
    let indices = 0..n;
    for i in indices.rev() {
        if f.call_within_context(&context, (i as i64,))? {
            return Ok(i);
        }
    }
    return Ok(n);
}

impl Default for Scope {
    fn default() -> Scope {
        return Scope::new();
    }
}

mod tests {
    #[allow(unused_imports)]
    use super::*;
    use test_log::test;

    // #[test::test]
    // fn set_expression_to_object() {
    //     let scope = Scope::new();
    //     let value =
    // }

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
        // let range = report.first().unwrap().range.clone();
        // let val: String = data[(range.start.col)..=(range.end.col)].to_string();
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
        // let range = report.first().unwrap().range.clone();
        // let val: String = data[(range.start.col)..=(range.end.col)].to_string();
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
