///
/// @file bindings/index.md
/// @order -10
///
/// # Master Keybindings
///
/// This defines version 2.1 of the master keybinding file format. All changes (including
/// breaking) are [described below](#breaking-changes)
///
/// Master keybindings are [TOML](https://toml.io/en/) files that begin with a line
/// containing `#:master-keybindings` and include the following top-level
/// fields:
///

// NOTE: .simple-src-docs.config.toml is setup to insert a list of
// bindings here, between the above text and the below example

/// @file bindings/index.md
/// @order 50
///
/// In addition, any comments prefixed with `##` will show up in the documentation displayed
/// by `Master Key: Show Text Documentation`. Any key bindings that fall between paragraphs
/// of the literate documentation are combined and presented as a table of keybindings.
///
/// ## Example
///
/// Here's a minimal example, demonstrating the most basic use of each field
///
/// ```toml
/// #:master-keybindings
///
/// ## # My Key Bindings
/// ##
/// ## The binding file is a literate document. This text will show up in
/// ## `Master Key: Show Text Documentation`
///
/// [header]
/// # this denotes the file-format version, it must be semver compatible with 2.0
/// version = "2.0.0"
/// name = "My Bindings"
///
/// [[mode]]
/// name = "insert"
/// # this comment will not show up in the documentation because it is prefixed
/// # with `#` instead of `##`.
/// whenNoBinding = 'insertCharacters'
///
/// [[mode]]
/// name = "normal"
/// default = true
///
/// [[kind]]
/// name = "motion"
/// description = "Commands that move your cursor"
///
/// [[kind]]
/// name = "mode"
/// description = "Commands that change the keybinding mode"
///
/// [[bind]]
/// key = "i"
/// doc.name = "insert"
/// mode = "normal"
/// command = "master-key.enterInsert"
/// doc.kind = "mode"
///
/// [[bind]]
/// key = "escape"
/// doc.name = "normal"
/// mode = "insert"
/// command = "master-key.enterNormal"
/// doc.kind = "mode"
///
/// [[define.bind]]
/// id = "basic_motion"
/// mode = "normal"
/// doc.kind = "motion"
/// command = "cursorMove"
///
/// [[bind]]
/// default = '{{bind.basic_motion}}'
/// doc.name = "right"
/// key = "l"
/// args.to = "right"
///
/// [[bind]]
/// doc.name = "left"
/// default = '{{bind.basic_motion}}'
/// key = "h"
/// args.to = "left"
///
/// [[define.val]]
/// foo = 1
///
/// [[bind]]
/// doc.name = "double right"
/// key = "g l"
/// default = '{{bind.basic_motion}}'
/// args.to = "right"
/// args.value = "{{foo+1}}"
/// ```
/// ## Breaking Changes
///
/// ### 2.1
///
/// The following, non-breaking changes were introduced in this version
///
/// - `define.bind.before/after`: Default binding definitions can now include a sequence of
/// commands to execute before or after the command or commands executed with
/// `bind.command`.
///
/// ### 2.0
///
/// The following changes were made from version 1.0 of the file format.
///
/// - `header.version` is now 2.0
/// - [`[[define]]`](/bindings/define) now has several sub fields. Definitions
///   previously under `[[define]]` should usually go under `[[define.val]]`, but
///   also see `[[define.command]]`.
/// - Comments prefixed with `##` show up in literate documentation and all other comments
///   are ignored. (Previously `#` showed up as literate documentation and `#-` was ignored).
/// - generalized [expressions](/expressions/index). This changed or replaced several
///   other features:
///   - `bind.computedArgs` no longer exists: instead, place expressions inside of `args`
///   - [`bind.foreach`](/bindings/bind#foreach-clause) has changed
///     - `{key: [regex]}` is now <span v-pre><code>{{keys(&grave;[regex]&grave;)}}</code></span>
///     - foreach variables are interpolated as expressions (<span v-pre>`{{symbol}}`</span>
///       instead of `{symbol}`).
///   - `bind.path` and `[[path]]`: A similar, but more explicit approach
///      is possible using `default` and [`define.bind`](/bindings/define#binding-definitions)
///   - replaced `mode = []` with <span v-pre>`mode = '{{all_modes()}}'`</span>
///   - replaced `mode = ["!normal", "!visual"]` with
///     <span v-pre>`mode = '{{not_modes(["normal", "visual"])}}'`</span>
/// - revised several fields:
///   - replaced `prefixes = ["a", "b", ...]` with `prefixes.anyOf = ["a", "b", ...]`
///   - replaced <code>prefixes = "&lt;all-prefixes&gt;"</code> with `prefixes.any = true`
///   - `name`, `description`, `hideInPalette` and `hideInDocs` moved to
///     `doc.name`, `doc.description`, `doc.hideInPalette` and `doc.hideInDocs`
///   - `combinedName`, `combinedDescription` and `combinedKey` moved to
///     `doc.combined.name`, `doc.combined.description` and `doc.combined.key`.
///   - `resetTransient` is now [`finalKey`](/bindings/bind)
///   - `bind.if` replaced with [`bind.skipWhen`](/bindings/bind)
///   - removed `(re)storeNamed` commands
///   - replay-related command fields have changed their semantics, see examples
///     under [replayFromHistory](/commands/replayFromHistory)
///
/// ### 1.0
///
/// THis was the original file format version
///
#[allow(unused_imports)]
use log::{error, info};

use crate::bind::command::{CommandValue, regularize_commands};
use crate::bind::{
    BindSection, Binding, BindingCodes, BindingDoc, BindingInput, BindingOutput, BindingOutputArgs,
    CombinedBindingDoc, KeyId, LegacyBindingInput, ReifiedBinding, UNKNOWN_RANGE,
};
use crate::define::{Define, DefineInput};
use crate::docs::{FileDocLine, FileDocSection};
use crate::error::{
    Context, ErrorContext, ErrorReport, ErrorSet, ParseError, Result, ResultVec, flatten_errors,
};
use crate::expression::value::{BareValue, Value};
use crate::expression::{HistoryQueue, MacroStack, Scope};
use crate::kind::Kind;
use crate::mode::{Mode, ModeInput, Modes, WhenNoBinding};
use crate::{err, resolve, wrn};

use lazy_static::lazy_static;
use regex::Regex;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use toml::Spanned;
use wasm_bindgen::prelude::*;

// TODO: copy over docs from typescript
#[derive(Deserialize, Clone, Debug)]
struct KeyFileInput {
    header: Header,
    define: Option<DefineInput>,
    mode: Option<Vec<Spanned<ModeInput>>>,
    bind: Option<Vec<Spanned<BindingInput>>>,
    kind: Option<Vec<Spanned<Kind>>>,
    #[serde(flatten)]
    other_fields: HashMap<String, toml::Value>,
}

/// @bindingField header
/// @order -10
/// @description top-level properties of the binding file
///
/// **Example**
///
/// ```toml
/// [header]
/// version = 2.0
/// name = "My Bindings"
/// requiredExtensions = ["Vue.volar"]
/// ```
///
/// ## Required Fields
///
/// - `version`: Must be version 2.x.y (typically 2.0.0); only version 2.0.0 currently
///   exists, but any future versions of 2 can be parsed by this version of master key, as
///   per [semantic versioning](https://semver.org/).
/// - `name`: The name of this keybinding set; shows up in menus to select keybinding
///   presets
/// - `requiredExtensions`: An array of string identifiers for all extensions used by this
///   binding set.
///
/// In general if you use the commands from an extension in your keybinding file, it is good
/// to include them in `requiredExtensions` so that others can use your keybindings without
/// running into errors due to a missing extension.
///
/// ## Finding Extension Identifiers
///
/// You can find an extension's identifier as follows:
///
/// 1. Open the extension in VSCode's extension marketplace
/// 2. Click on the gear (⚙︎) symbol
/// 3. Click "Copy Extension ID"; you now have the identifier in your system clipboard
///
#[derive(Deserialize, Clone, Debug)]
#[allow(non_snake_case)]
struct Header {
    name: Option<Spanned<String>>,
    version: Spanned<Version>,
    requiredExtensions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[wasm_bindgen(getter_with_clone)]
#[allow(non_snake_case)]
pub struct KeyFile {
    pub name: Option<String>,
    pub requiredExtensions: Vec<String>,
    define: Define,
    mode: Modes,
    bind: Vec<Binding>,
    docs: Vec<FileDocSection>,
    pub kind: Vec<Kind>,
    // TODO: avoid storing `key_bind` to make serialization smaller
    key_bind: Vec<BindingOutput>,
}

impl KeyFile {
    // TODO: refactor to have each section's processing in corresponding module for that
    // section, this would improve legibility here and keep more of the logic related to a
    // given section in one place
    fn new(
        input: KeyFileInput,
        doc_lines: Vec<FileDocLine>,
        mut scope: &mut Scope,
        warnings: &mut Vec<ParseError>,
    ) -> ResultVec<KeyFile> {
        let mut errors = Vec::new();

        // warn about unknown fields
        for (key, _) in &input.other_fields {
            let err: Result<()> = Err(wrn!(
                "The section `[[{}]]` is unrecognized and will be ignored",
                key,
            ));
            warnings.push(err.unwrap_err());
        }

        // [header]
        let version = input.header.version.as_ref();
        if !VersionReq::parse("2.0").unwrap().matches(version) {
            let r: Result<()> = Err(wrn!(
                "This version of master key is only compatible version 2 of the file format."
            ))
            .with_range(&input.header.version.span());
            errors.push(r.unwrap_err().into());
        }
        let name: Option<String> = match resolve!(input.header, name, scope) {
            Err(mut x) => {
                errors.append(&mut x.errors);
                Option::None
            }
            Ok(x) => x,
        };
        #[allow(non_snake_case)]
        let requiredExtensions: Vec<String> = input
            .header
            .requiredExtensions
            .into_iter()
            .flatten()
            .collect();

        // [[define]]
        let mut define_input = input.define.unwrap_or_default();
        let mut skip_define = false;
        let _ = scope
            .parse_asts(&define_input.val)
            .map_err(|mut es| errors.append(&mut es.errors));
        match scope.expand(&define_input.val) {
            Ok(x) => {
                define_input.val = x;
            }
            Err(mut es) => {
                skip_define = true;
                errors.append(&mut es.errors);
            }
        };
        let mut define = if !skip_define {
            match Define::new(define_input, &mut scope, warnings, version) {
                Err(mut es) => {
                    errors.append(&mut es.errors);
                    Define::default()
                }
                Ok(x) => x,
            }
        } else {
            Define::default()
        };

        // [[mode]]
        let mode_input = input
            .mode
            .unwrap_or_else(|| vec![Spanned::new(UNKNOWN_RANGE, ModeInput::default())]);
        let modes = match Modes::new(mode_input, &mut scope, warnings) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Modes::default()
            }
            Ok(x) => x,
        };
        for (_, mode) in &modes.map {
            if let WhenNoBinding::Run(commands) = &mode.whenNoBinding {
                match scope.parse_asts(commands) {
                    Err(mut es) => {
                        errors.append(&mut es.errors);
                    }
                    Ok(_) => (),
                }
            }
        }

        // [[kind]]
        let kind = Kind::process(&input.kind, &mut scope, warnings)?;

        // [[bind]]
        let input_iter = input.bind.into_iter().flatten().map(|x| {
            // validate `before/after`
            let span = x.span().clone();
            if !x.as_ref().before.is_none() {
                errors.push(
                    Result::<()>::Err(err!("`before` is reserved for `[[defined.bind]]`").into())
                        .with_range(&span)
                        .unwrap_err(),
                );
            }
            if !x.as_ref().before.is_none() {
                errors.push(
                    Result::<()>::Err(err!("`before` is reserved for `[[defined.bind]]`").into())
                        .with_range(&span)
                        .unwrap_err(),
                );
            }

            return Ok(Spanned::new(
                span.clone(),
                define.expand(x.into_inner()).with_range(&span)?,
            ));
        });

        let bind_input = match flatten_errors(input_iter) {
            Err(mut es) => {
                errors.append(&mut es.errors);
                Vec::new()
            }
            Ok(x) => x,
        };

        define.add_to_scope(&mut scope)?;
        let _ = scope
            .parse_asts(&bind_input)
            .map_err(|mut es| errors.append(&mut es.errors));

        // `foreach` expansion
        let (mut bind, bind_span): (Vec<_>, Vec<_>) = bind_input
            .into_iter()
            .flat_map(|x| {
                let span = x.span().clone();
                match x.into_inner().expand_foreach(&mut scope) {
                    Ok(replicates) => {
                        // we resolve the foreach elements originating from a single item
                        // here, rather than expanding and flattening all errors across
                        // every iteration of the `foreach`. That's because we only want the
                        // first instance of an error at a given text span to show up in the
                        // final error output (e.g. if we have [[bind]] item with
                        // foreach.key = [1,2,3] we don't want an error about a missing
                        // required `key` field` to show up three times

                        let items = replicates
                            .into_iter()
                            .map(|x| {
                                let mut bind_warnings = Vec::new();
                                let bind = Binding::new(x, &mut scope, &mut bind_warnings)?;
                                scope.messages_as_warnings(&mut bind_warnings);
                                bind_warnings
                                    .iter_mut()
                                    .for_each(|w| w.contexts.push(Context::Range(span.clone())));
                                warnings.append(&mut bind_warnings);
                                Ok((bind, span.clone()))
                            })
                            .collect::<ResultVec<Vec<_>>>()
                            .with_range(&span);
                        match items {
                            Ok(x) => x,
                            Err(mut e) => {
                                errors.append(&mut e.errors);
                                Vec::new()
                            }
                        }
                    }
                    Err(mut e) => {
                        errors.append(&mut e.errors);
                        Vec::new()
                    }
                }
            })
            .unzip();

        let docs = FileDocSection::assemble(&bind, &bind_span, doc_lines);
        FileDocSection::assign_binding_headings(&mut bind, &docs);

        // create outputs to store in `keybindings.json`
        // TODO: store spans so we can do avoid serializing `key_bind`?
        let mut key_bind = Vec::new();
        bind = Binding::resolve_prefixes(bind, &bind_span)?;
        let mut codes = BindingCodes::new();
        for (i, (bind_item, span)) in bind.iter_mut().zip(bind_span.into_iter()).enumerate() {
            key_bind.append(&mut bind_item.outputs(i as i32, &scope, Some(span), &mut codes)?);
        }
        modes.insert_implicit_mode_bindings(&bind, &scope, &mut codes, &mut key_bind);

        // sort all bindings by their priority
        key_bind.sort_by(BindingOutput::cmp_priority);

        // remove key_bind values with the exact same `key_id`, keeping the one with the
        // highest priority (last items); such collisions should only happen between
        // implicit keybindings, because we check and error on collisions between any two
        // explicitly defined bindings with the same implied id (same when clause, key and
        // mode)
        let mut seen_codes = HashSet::new();
        let mut final_key_bind = VecDeque::with_capacity(key_bind.len());
        for key in key_bind.into_iter().rev() {
            if key.key_id() == -1 {
                // the -1 id is special, and used in all bindings added by
                // `Modes::ignore_letter_bindings`
                final_key_bind.push_front(key)
            } else if !seen_codes.contains(&key.key_id()) {
                seen_codes.insert(key.key_id());
                final_key_bind.push_front(key);
            }
        }

        if errors.len() == 0 {
            return Ok(KeyFile {
                name,
                requiredExtensions,
                define,
                bind,
                docs,
                mode: modes,
                kind,
                key_bind: final_key_bind.into(),
            });
        } else {
            return Err(errors.into());
        }
    }
}

// TODO: don't use clone on `file`
#[derive(Default, Debug)]
#[wasm_bindgen(getter_with_clone)]
pub struct KeyFileResult {
    file: Option<KeyFile>,
    errors: Option<Vec<ErrorReport>>,
    pub(crate) scope: Scope,
}

// These lines are tested during integration tests with the typescript code
#[wasm_bindgen]
#[cfg_attr(coverage_nightly, coverage(off))]
impl KeyFileResult {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        return KeyFileResult::default();
    }
    pub fn name(&self) -> String {
        match &self.file {
            Some(KeyFile { name: Some(x), .. }) => x.clone(),
            _ => "".to_string(),
        }
    }

    #[allow(non_snake_case)]
    pub fn requiredExtensions(&self) -> Vec<String> {
        match &self.file {
            Some(KeyFile {
                requiredExtensions, ..
            }) => requiredExtensions.clone(),
            _ => Vec::new(),
        }
    }

    pub fn n_errors(&self) -> usize {
        return match &self.errors {
            Some(x) => x.len(),
            Option::None => 0,
        };
    }

    pub fn error(&self, i: usize) -> ErrorReport {
        return self.errors.as_ref().unwrap()[i].clone();
    }

    pub fn n_bindings(&self) -> usize {
        return match &self.file {
            Some(x) => x.key_bind.len(),
            Option::None => 0,
        };
    }

    // the actual bindings we want to store in `keybindings.json`
    // (see `keybindings/index.ts` and related files)
    pub fn binding(&self, i: usize) -> JsValue {
        return serde_wasm_bindgen::to_value(&self.file.as_ref().unwrap().key_bind[i])
            .expect("keybinding object");
    }

    // documentation output for `showTextDocumentation` (see `keybindings/index.ts`)
    pub fn docs(&self, i: usize) -> Option<BindingDoc> {
        let command_id = match &self.file.as_ref().unwrap().key_bind[i] {
            BindingOutput::Do {
                args: BindingOutputArgs { command_id, .. },
                ..
            } => *command_id,
            _ => -1 as i32,
        };
        if command_id >= 0 {
            if let Some(KeyFile { bind, .. }) = &self.file {
                let binding = bind[command_id as usize].clone();
                let docs = &binding.doc;
                let combined = docs.combined.clone().unwrap_or_else(|| CombinedBindingDoc {
                    name: docs.name.clone(),
                    key: binding.key.last().unwrap().clone(),
                    description: docs.description.clone(),
                });
                let mut result = docs.clone();
                result.combined = Some(combined);
                return Some(result);
            }
        }
        return None;
    }

    // the documentation section a binding is located in (see commands/palette.ts)
    pub fn binding_section(&self, command_id: i32) -> Option<BindSection> {
        return match &self.file {
            Some(KeyFile { bind, .. }) => {
                if command_id >= 0 && (command_id as usize) < bind.len() {
                    bind[command_id as usize].section.clone()
                } else {
                    None
                }
            }
            Option::None => None,
        };
    }

    // used to inform the user about layout independent bindings (see
    // `keybindings/index.ts`)
    pub fn has_layout_independent_bindings(&self) -> bool {
        return match &self.file {
            Some(KeyFile { bind, .. }) => bind
                .iter()
                .any(|b| b.key.iter().any(|k| LAYOUT_INDEPENDENT_KEY.is_match(k))),
            _ => false,
        };
    }

    // get information about a given binding mode (e.g. mode.ts and mode-status.ts)
    pub fn mode(&self, name: &str) -> Option<Mode> {
        return match &self.file {
            Some(KeyFile { mode, .. }) => mode.get(name).map(Mode::clone),
            Option::None => None,
        };
    }
    pub fn default_mode(&self) -> String {
        return match &self.file {
            Some(KeyFile { mode, .. }) => mode.default.clone(),
            Option::None => Modes::default().default,
        };
    }

    // the first step of running bindings is to a get a list of `ReifiedBindings` (see
    // do.ts)
    pub fn prepare_binding_to_run(&mut self, id: i32) -> ReifiedBinding {
        if id == -1 {
            return ReifiedBinding::noop(&mut self.scope);
        } else {
            if let Some(KeyFile { bind, .. }) = &self.file {
                if id < 0 || id as usize >= bind.len() {
                    return ReifiedBinding::noop(&mut self.scope);
                } else {
                    let binding = &bind[id as usize];
                    return ReifiedBinding::new(&binding, &mut self.scope);
                }
            } else {
                return ReifiedBinding::noop(&mut self.scope);
            }
        }
    }

    // when we store commands they can be executed at a later date using this
    // function (see storeCommand.ts)
    fn do_stored_command_helper(&mut self, value: JsValue) -> ResultVec<ReifiedBinding> {
        let toml: toml::Value = match serde_wasm_bindgen::from_value(value) {
            Err(e) => Err(err!("{e} while serializing command value"))?,
            Ok(x) => x,
        };
        let bare_value = match BareValue::new(toml.clone()) {
            Err(e) => Err(err!("{e} while parsing expression brackets in {toml:#?}"))?,
            Ok(x) => x,
        };
        let value = match Value::new(bare_value, None) {
            Err(e) => Err(err!("{e} while creating value from {toml:#?}"))?,
            Ok(x) => x,
        };
        let commands = match value {
            Value::Table(kv, _) => {
                let command_value = kv.get("command").ok_or_else(|| {
                    err!("Expected `command` fields while serializing command value {toml:#?}")
                })?;
                let command = match command_value {
                    Value::String(x) => x.clone(),
                    _ => Err(err!(
                        "Expected `command` to be a string while serializing command value {toml:#?}",
                    ))?,
                };
                let args = kv.get("args");
                let value = CommandValue {
                    command,
                    args: args,
                    range: UNKNOWN_RANGE,
                };
                let mut warnings = Vec::new();
                regularize_commands(&value, &mut self.scope, &mut warnings)?
            }
            _ => Err(err!(
                "Expected an object while serializing command value {toml:#?}"
            ))?,
        };
        match self.scope.parse_asts(&commands) {
            Err(e) => return Err(err!("{e} for value {toml:#?}"))?,
            Ok(x) => x,
        }
        return Ok(ReifiedBinding::from_commands(commands, &self.scope));
    }

    pub fn do_stored_command(&mut self, value: JsValue) -> ReifiedBinding {
        return match self.do_stored_command_helper(value) {
            Ok(x) => x,
            Err(e) => {
                let mut result = ReifiedBinding::noop(&self.scope);
                result.error = Some(e.errors.iter().map(|er| format!("{er}")).collect());
                result
            }
        };
    }

    // when we store commands, this is where they end up (see `storeCommands.ts`)
    pub fn store_binding(
        &mut self,
        cmd: &ReifiedBinding,
        max_history: i32,
    ) -> std::result::Result<(), JsError> {
        if let Some(value) = self.scope.state.get_value::<HistoryQueue>("history") {
            let mut history = value.try_borrow_mut()?;
            history.push_back(cmd.clone());
            if history.len() > (max_history as usize) {
                history.pop_front();
            }
            return Ok(());
        } else {
            return Err(JsError::new(
                "Expected history to be defined (see `Scope::new()`)",
            ));
        };
    }

    // save a macro for future use; see `replay.ts`
    pub fn push_macro(
        &mut self,
        recording: Vec<ReifiedBinding>,
    ) -> std::result::Result<(), JsError> {
        if let Some(values) = self.scope.state.get_value::<MacroStack>("macros") {
            let mut macros = values.try_borrow_mut()?;
            macros.push(recording.clone())
        } else {
            return Err(JsError::new(
                "Expected `macro` to be defined (see `Scope::new()`)",
            ));
        };

        return Ok(());
    }

    // get a macro so we can run it
    pub fn get_macro(&self, i: usize) -> std::result::Result<Option<Vec<ReifiedBinding>>, JsError> {
        if let Some(values) = self.scope.state.get_value::<MacroStack>("macros") {
            let macros = values.try_borrow()?;
            return Ok(macros.get(macros.len() - i - 1).map(|x| x.to_owned()));
        } else {
            return Err(JsError::new(
                "Expected `macro` to be defined (see `Scope::new()`)",
            ));
        };
    }

    // get the sequence of bindings executed within a given range of ranges in the command
    // history see `replay.ts`
    pub fn history_at(
        &self,
        from: i32,
        to: i32,
    ) -> std::result::Result<Option<Vec<ReifiedBinding>>, JsError> {
        if from < 0 || to < 0 {
            return Ok(None);
        }
        if let Some(value) = self.scope.state.get_value::<HistoryQueue>("history") {
            let history = value.try_borrow()?;
            let from = from as usize;
            let to = to as usize;
            if from >= history.len() || to >= history.len() || from > to {
                return Ok(None);
            }
            return Ok(Some((from..=to).map(|i| history[i].clone()).collect()));
        }

        return Ok(None);
    }

    // check if we are currently recording edits for a given document id see `replay.ts`
    pub fn is_recording_edits_for(
        &self,
        id: i32,
        max_text_history: usize,
    ) -> std::result::Result<bool, JsError> {
        if let Some(value) = self.scope.state.get_value::<HistoryQueue>("history") {
            let history = value.try_borrow()?;
            if let Some(last) = history.iter().last() {
                return Ok(last.edit_document_id == id && last.edit_text.len() < max_text_history);
            }
        }
        return Ok(false);
    }

    // store an document edit in the current command (see `replay.ts`)
    pub fn store_edit(
        &mut self,
        text: String,
        max_text_history: usize,
    ) -> std::result::Result<(), JsError> {
        if let Some(value) = self.scope.state.get_value::<HistoryQueue>("history") {
            let mut history = value.try_borrow_mut()?;
            let n = history.len();
            let last = &mut history[n - 1];
            let room_left = max_text_history - last.edit_text.len();
            last.edit_text.push_str(&text[0..room_left.min(text.len())])
        }

        return Ok(());
    }

    // set a variable value in a given name space (see `state.ts`)
    pub fn set_value(&mut self, namespace: &str, name: &str, value: JsValue) -> Result<()> {
        return self.scope.set(namespace, name, value);
    }

    // get a variable value in a given name space (see `state.ts`)
    pub fn get_value(&self, namespace: &str, name: &str) -> Result<JsValue> {
        return self.scope.get(namespace, name);
    }

    // list all values defined under `val.` (ala `[[define.val]]`).
    pub fn get_defined_vals(&self) -> Result<Vec<String>> {
        return self.scope.get_defined_vals();
    }

    // list all keybinding kinds (from [[kind]])
    pub fn kinds(&self) -> Vec<Kind> {
        if let Some(KeyFile { kind, .. }) = &self.file {
            return kind.clone();
        } else {
            return Vec::new();
        }
    }

    // get the actual text documentation as a string of markdown
    pub fn text_docs(&self) -> Option<String> {
        if let Some(KeyFile { docs, mode, .. }) = &self.file {
            return Some(FileDocSection::write_markdown(&docs, mode.map.len() > 1));
        } else {
            return None;
        }
    }
}

lazy_static! {
    static ref LAYOUT_INDEPENDENT_KEY: Regex = Regex::new(r"\[[^\]]+\]").unwrap();
}

// These lines are tested during integration tests with the typescript code
#[wasm_bindgen]
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn parse_keybinding_bytes(file_content: Box<[u8]>) -> KeyFileResult {
    return parse_keybinding_data(&file_content);
}

pub fn parse_keybinding_data<T>(file_content: T) -> KeyFileResult
where
    T: AsRef<[u8]>,
{
    let mut warnings = Vec::new();
    let mut scope = Scope::new();
    let result = parse_bytes_helper(file_content.as_ref(), &mut warnings, &mut scope);
    return match result {
        Ok(result) => KeyFileResult {
            scope,
            file: Some(result),
            errors: Some(ErrorSet::from(warnings).report(file_content.as_ref())),
        },
        Err(err) => KeyFileResult {
            scope,
            file: None,
            errors: Some(
                ErrorSet::from(
                    err.errors
                        .into_iter()
                        .chain(warnings.into_iter())
                        .collect::<Vec<_>>(),
                )
                .report(file_content.as_ref()),
            ),
        },
    };
}

pub fn parse_bytes_helper(
    file_content: &[u8],
    warnings: &mut Vec<ParseError>,
    scope: &mut Scope,
) -> ResultVec<KeyFile> {
    // ensure there's a directive
    // we know that the content was converted from a string on the typescript side
    // so we're cool with an unchecked conversion
    // TODO: maybe we implement this check in typescript??
    let has_directive: bool = {
        let mut result: bool = false;
        let skip_line = Regex::new(r"\s*(#.*)?").unwrap();
        let lines = unsafe { str::from_utf8_unchecked(file_content).lines() };
        for line in lines {
            if !skip_line.is_match(line) {
                break;
            }
            if Regex::new(r"^\s*#:master-keybindings\s*$")
                .unwrap()
                .is_match(line)
            {
                result = true;
                break;
            }
        }
        result
    };
    if !has_directive {
        Err(err!(
            "To be treated as a master keybindings file, the TOML document must \
             include the directive `#:master-keybindings` on a line by itself \
             before any TOML data."
        ))
        .with_range(&(0..0))?;
    }

    let parsed = toml::from_slice::<KeyFileInput>(file_content)?;
    let docs = FileDocLine::read(file_content);

    let result = KeyFile::new(parsed, docs, scope, warnings);
    warnings.append(&mut identify_legacy_warnings(file_content));

    return result;
}

//
// ---------------- Legacy Keybinding warnings ----------------
//

#[derive(Deserialize, Clone, Debug)]
struct LegacyKeyFileInput {
    bind: Vec<Spanned<LegacyBindingInput>>,
    path: Option<Vec<Spanned<toml::Value>>>,
}

lazy_static! {
    static ref OLD_EXPRESSION: Regex = Regex::new(r"\{\w+\}").unwrap();
}

impl LegacyKeyFileInput {
    fn check(&self) -> ErrorSet {
        let mut errors = Vec::new();
        for bind in &self.bind {
            match bind.as_ref().check() {
                Ok(()) => (),
                Err(mut e) => errors.append(&mut e.errors),
            }
        }

        let empty = vec![];
        for path in self.path.as_ref().unwrap_or(&empty) {
            let err: Result<()> = Err(wrn!(
                "`[[path]]` section is not supported in the 2.0 format; replace `path` \
                with `[[define.bind]]` and review more details in documentation"
            ))
            .with_range(&path.span());
            errors.push(err.unwrap_err());
        }

        return errors.into();
    }
}

pub fn identify_legacy_warnings(file_content: &[u8]) -> Vec<ParseError> {
    let warnings = toml::from_slice::<LegacyKeyFileInput>(&file_content);
    return match warnings {
        Ok(x) => x.check().errors,
        Err(_) => Vec::new(),
    };
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::bind::foreach::all_characters;
    use crate::bind::prefix::Prefix;
    use crate::bind::{BindingOutput, BindingOutputArgs, UNKNOWN_RANGE};
    use crate::expression::value::Expression;
    use crate::expression::value::Value;
    use crate::mode::WhenNoBinding;
    use smallvec::SmallVec;
    use std::collections::HashMap;
    use test_log::test;

    pub(crate) fn unwrap_table(x: &Value) -> HashMap<String, Value> {
        match x {
            Value::Table(x, _) => x.clone(),
            _ => panic!("Expected a table!"),
        }
    }

    #[test]
    fn parse_example() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[define.val]]
        foo = "bar"

        [[mode]]
        name = "insert"
        whenNoBinding = "insertCharacters"

        [[mode]]
        name = "normal"
        default = true

        [[bind]]
        key = "l"
        mode = "normal"
        command = "cursorRight"

        [[bind]]
        key = "h"
        mode = "normal"
        command = "cursorLeft"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap();

        assert_eq!(result.bind[0].key[0], "l");
        assert_eq!(result.bind[0].commands[0].command, "cursorRight");
        assert_eq!(result.bind[1].key[0], "h");
        assert_eq!(result.bind[1].commands[0].command, "cursorLeft");
    }

    #[test]
    fn parse_with_modifiers() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        doc.name = "default"
        key = "cmd+x"
        command = "foobar"

        [[bind]]
        doc.name = "run_merged"
        key = "cmd+k"
        command = "bizbaz"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        assert_eq!(result.unwrap().bind.len(), 2)
    }

    #[test]
    fn unknown_field_raises_warning() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bink]]
        doc.name = "default"
        key = "cmd+x"
        command = "foobar"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        assert!(result.is_ok());
        let error_str = format!("{}", warnings.first().unwrap().error);
        assert!(error_str.contains("section `[[bink]]`"));
    }

    #[test]
    fn bad_toml_raises_error() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[define.val
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = result.report(data.as_bytes());
        assert!(report[0].message.contains("expected `]]`"));
        assert_eq!(report[0].range.start.line, 6);
        assert_eq!(report[0].range.end.line, 6);
    }

    #[test]
    fn validate_version() {
        let data = r#"
        [header]
        version = "1.0.0"

        [[bind]]
        key = "a"
        command = "foo"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("version"));
        assert_eq!(report[0].range.start.line, 2);
    }

    #[test]
    fn validate_comment_directive() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "b"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let err = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("directive"));
        assert_eq!(report[0].range.start.line, 0);
    }

    #[test]
    fn resolve_bind_and_command() {
        let data = r#"
        [header]
        version = "2.0.0"


        [[define.val]]
        foo_string = "bizbaz"

        [[define.command]]
        id = "run_shebang"
        command = "shebang"
        args.a = 1
        args.b = "{{val.foo_string}}"

        [[define.bind]]
        id = "whole_shebang"
        doc.name = "the whole shebang"
        command = "runCommands"
        args.commands = ["{{command.run_shebang}}", "bar"]

        [[bind]]
        default = "{{bind.whole_shebang}}"
        key = "a"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(result.bind[0].doc.name, "the whole shebang");
        assert_eq!(result.bind[0].key[0], "a");
        assert_eq!(result.bind[0].commands[0].command, "shebang");
        assert_eq!(
            unwrap_table(&result.bind[0].commands[0].args),
            HashMap::from([
                ("a".into(), Value::Integer(1)),
                (
                    "b".into(),
                    Value::Exp(Expression {
                        content: "val.foo_string".into(),
                        span: UNKNOWN_RANGE,
                        error: None,
                        scope: SmallVec::new(),
                    })
                ),
            ])
        );
        assert_eq!(result.bind[0].commands[1].command, "bar");
    }

    #[test]
    fn resolve_nested_command() {
        let data = r#"
        [header]
        version = "2.0.0"


        [[define.command]]
        id = "run_shebang"
        command = "shebang"
        args.a = 1
        args.b = "{{val.foo_string}}"

        [[define.bind]]
        id = "a"
        args.commands = ["{{command.run_shebang}}", "bar"]

        [[define.bind]]
        id = "b"
        key = "x"
        command = "runCommands"
        default = "{{bind.a}}"

        [[bind]]
        default = "{{bind.b}}"
        doc.name = "the whole shebang"
        key = "a"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(result.bind[0].doc.name, "the whole shebang");
        assert_eq!(result.bind[0].key[0], "a");
        assert_eq!(result.bind[0].commands[0].command, "shebang");
        assert_eq!(
            unwrap_table(&result.bind[0].commands[0].args),
            HashMap::from([
                ("a".into(), Value::Integer(1)),
                (
                    "b".into(),
                    Value::Exp(Expression {
                        content: "val.foo_string".into(),
                        span: UNKNOWN_RANGE,
                        error: None,
                        scope: SmallVec::new(),
                    })
                ),
            ])
        );
        assert_eq!(result.bind[0].commands[1].command, "bar");
    }

    #[test]
    fn expand_foreach() {
        let data = r#"
        [header]
        version = "2.0.0"

        # define.bind has interactions with foreach
        # that can lead to bugs
        [[define.bind]]
        id = "testing"
        doc.description = "testing"

        [[bind]]
        default = "{{bind.testing}}"
        foreach.key = ["{{keys(`[0-9]`)}}"]
        key = "c {{key}}"
        doc.name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();

        let expected_name: Vec<String> =
            (0..9).into_iter().map(|n| format!("update {n}")).collect();
        let expected_value: Vec<String> = (0..9).into_iter().map(|n| format!("{}", n)).collect();

        assert_eq!(result.bind.len(), 10);
        for i in 0..9 {
            let args: toml::Value = result.bind[i].commands(&mut scope).unwrap()[0]
                .clone()
                .args
                .into();
            assert_eq!(result.bind[i].doc.name, expected_name[i]);
            assert_eq!(
                args,
                toml::Value::Table(
                    [(
                        "value".to_string(),
                        toml::Value::String(expected_value[i].clone())
                    )]
                    .into_iter()
                    .collect()
                )
            );
        }
    }

    #[test]
    fn foreach_error() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        foreach.key = ["{{keys(`[0-9]`)}}"]
        doc.name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        // TODO: ensure that a proper span is shown here
        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        );
        let report = result.unwrap_err().report(data.as_bytes());
        assert_eq!(report[0].message, "`key` field is required".to_string());
        assert_eq!(report[0].range.start.line, 4);
        assert_eq!(report[0].range.end.line, 4);
    }

    #[test]
    fn foreach_regex_error() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        foreach.key = ["{{keys(`[0-9`)}}"]
        key = "c {{key}}"
        doc.name = "update {{key}}"
        command = "foo"
        args.value = "{{key}}"
        "#;

        // TODO: ensure that a proper span is shown here
        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        );
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("regex parse error"));
        assert!(!report[0].message.contains("(line"));
        assert_eq!(report[0].range.start.line, 5);
        assert_eq!(report[0].range.end.line, 5);
    }

    #[test]
    fn define_val_at_read() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.val]]
        foo = "bar"
        biz = '{{"baz" + "_biz"}}'

        [[bind]]
        key = "x"
        command = "{{val.foo}}"
        args.val = 2
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        assert_eq!(result.bind[0].commands[0].command, "bar");
        assert_eq!(
            result.define.val["biz"],
            Value::String("baz_biz".to_string())
        )
    }

    #[test]
    fn just_one_default_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"
        default = true

        [[bind]]
        key = "a"
        command = "foo"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("default mode already set"));
        assert_eq!(report[0].range.start.line, 9)
    }

    #[test]
    fn includes_default_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"

        [[bind]]
        key = "a"
        command = "foo"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(
            report[0]
                .message
                .contains("exactly one mode must be the default")
        );
        assert_eq!(report[0].range.start.line, 4)
    }

    #[test]
    fn unique_mode_name() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "a"

        [[bind]]
        key = "a"
        command = "foo"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("mode name is not unique"));
        assert_eq!(report[0].range.start.line, 8)
    }

    #[test]
    fn parse_use_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "a"
        default = true

        [[mode]]
        name = "b"
        whenNoBinding.useMode = "a"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        assert_eq!(
            result.mode.get("b").unwrap().whenNoBinding,
            crate::mode::WhenNoBinding::UseMode("a".to_string())
        )
    }

    #[test]
    fn validate_use_mode() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"
        whenNoBinding.useMode = "c"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("mode `c` is not defined"));
        assert_eq!(report[0].range.start.line, 11)
    }

    #[test]
    fn validate_capture_mode() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "capture"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let err = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("`capture` is implicit"));
        assert_eq!(report[0].range.start.line, 11);
        assert_eq!(report[0].range.end.line, 11);
    }

    #[test]
    fn eval_mode_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"

        [[mode]]
        name = "c"

        [[bind]]
        key = "a"
        command = "foo"
        mode = '{{all_modes()}}'

        [[bind]]
        key = "b"
        command = "bar"
        mode = '{{not_modes(["c"])}}'
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        assert!(result.bind[0].mode.iter().any(|x| x == "a"));
        assert!(result.bind[0].mode.iter().any(|x| x == "b"));
        assert!(result.bind[0].mode.iter().any(|x| x == "c"));
        assert!(result.bind[1].mode.iter().any(|x| x == "a"));
        assert!(result.bind[1].mode.iter().any(|x| x == "b"));
        assert!(!result.bind[1].mode.iter().any(|x| x == "c"));
    }

    #[test]
    fn validate_mode_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"

        [[mode]]
        name = "c"

        [[bind]]
        key = "b"
        command = "bar"
        mode = '{{not_modes(["d"])}}'
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("mode `d`"));
        assert_eq!(report[0].range.start.line, 18)
    }

    fn unwrap_prefixes(prefix: &Prefix) -> &Vec<String> {
        return match prefix {
            Prefix::AnyOf(x) => x,
            x @ _ => panic!("Unexpected, unresolved prefix: {x:?}"),
        };
    }

    #[test]
    fn eval_prefix_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "z"
        command = "biz"
        prefixes.any = true

        [[bind]]
        key = "w"
        command = "baz"
        prefixes.allBut = ["d e"]

        [[bind]]
        key = "q"
        command = "master-key.prefix"
        finalKey = false
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();

        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "a")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "a b")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "d")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "d e")
        );
        assert!(
            unwrap_prefixes(&result.bind[2].prefixes)
                .iter()
                .any(|x| x == "q")
        );
        unwrap_prefixes(&result.bind[2].prefixes)
            .iter()
            .any(|x| x == "");
        assert_eq!(unwrap_prefixes(&result.bind[2].prefixes).len(), 6);
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "a")
        );
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "a b")
        );
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "d")
        );
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "q")
        );
        assert!(
            unwrap_prefixes(&result.bind[3].prefixes)
                .iter()
                .any(|x| x == "")
        );
        assert_eq!(unwrap_prefixes(&result.bind[3].prefixes).len(), 5);
    }

    #[test]
    fn validate_prefix_expressions() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a b c"
        command = "foo"

        [[bind]]
        key = "d e f"
        command = "bar"

        [[bind]]
        key = "w"
        command = "baz"
        prefixes.allBut = ["d k"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("undefined: `d k`"));

        assert_eq!(report[0].range.start.line, 12)
    }

    #[test]
    fn command_expansion() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.val]]
        flag = true
        bar = "test"

        [[define.command]]
        id = "foo"
        command = "runCommands"
        args.commands = ["a", "b", "c"]

        [[bind]]
        key = "x"
        command = "runCommands"

        [[bind.args.commands]]
        command = "x"
        args.val = 1
        args.name = "{{val.bar}}"

        [[bind.args.commands]]
        command = "y"
        skipWhen = "{{val.flag}}"

        [[bind.args.commands]]
        command = "runCommands"
        args.commands = ["j", "k", "{{command.foo}}"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        let commands = result.bind[0].commands(&mut scope).unwrap();
        assert_eq!(commands[0].command, "x");
        assert_eq!(commands[1].command, "j");
        assert_eq!(commands[2].command, "k");
        assert_eq!(commands[3].command, "a");
        assert_eq!(commands[4].command, "b");
        assert_eq!(commands[5].command, "c");
        assert_eq!(commands.len(), 6);
    }

    #[test]
    fn command_expansion_validates_final_key() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.val]]
        flag = true
        bar = "test"

        [[define.command]]
        id = "foo"
        command = "runCommands"
        args.commands = ["a", "b", "master-key.prefix"]

        [[bind]]
        key = "x"
        command = "runCommands"
        finalKey = true

        [[bind.args.commands]]
        command = "x"
        args.val = 1
        args.name = "{{val.bar}}"

        [[bind.args.commands]]
        command = "y"
        skipWhen = "{{val.flag}}"

        [[bind.args.commands]]
        command = "runCommands"
        args.commands = ["j", "k", "{{command.foo}}"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("`finalKey`"));
        assert_eq!(report[0].range.start.line, 13);
    }

    #[test]
    fn command_expansion_dynamically_validates_final_key() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.val]]
        flag = true
        bar = "test"

        [[define.command]]
        id = "foo"
        command = "runCommands"
        args.commands = ["a", "b", '{{"master-key" + ".prefix"}}']

        [[bind]]
        key = "x"
        command = "runCommands"

        [[bind.args.commands]]
        command = "x"
        args.val = 1
        args.name = "{{val.bar}}"

        [[bind.args.commands]]
        command = "y"
        skipWhen = "{{val.flag}}"

        [[bind.args.commands]]
        command = "runCommands"
        args.commands = ["j", "k", "{{command.foo}}"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        let err = result.bind[0].commands(&mut scope).unwrap_err();
        assert!(format!("{err}").contains("`finalKey`"))
    }

    #[test]
    fn output_bindings_overwrite_implicit_prefix() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        finalKey = false
        command = "master-key.prefix"
        args.cursor = "Block"
        doc.name = "explicit prefix"

        [[bind]]
        key = "a b"
        command = "foo"

        [[bind]]
        key = "a c"
        command = "bar"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        assert_eq!(result.key_bind.len(), 3);
        if let BindingOutput::Do {
            key,
            args: BindingOutputArgs { prefix, name, .. },
            ..
        } = &result.key_bind[0]
        {
            assert_eq!(key, "a");
            assert_eq!(prefix, "");
            assert_eq!(name, "explicit prefix")
        } else {
            error!("Unexpected binding {:#?}", result.key_bind[0]);
            assert!(false);
        }

        if let BindingOutput::Do {
            key,
            args: BindingOutputArgs { prefix, .. },
            ..
        } = &result.key_bind[1]
        {
            assert_eq!(key, "b");
            assert_eq!(prefix, "a");
        } else {
            error!("Unexpected binding {:#?}", result.key_bind[0]);
            assert!(false);
        }
        if let BindingOutput::Do {
            key,
            args: BindingOutputArgs { prefix, .. },
            ..
        } = &result.key_bind[2]
        {
            assert_eq!(key, "c");
            assert_eq!(prefix, "a");
        } else {
            error!("Unexpected binding {:#?}", result.key_bind[0]);
            assert!(false);
        }
    }

    #[test]
    fn output_bindings_identify_duplicates() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a k"
        command = "bob"

        [[bind]]
        key = "a k"
        command = "allowed conditional"
        when = "master-key.count > 0"

        [[bind]]
        key = "a k"
        command = "duplicate"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("Duplicate key"));
        assert_eq!(report[0].range.start.line, 13);
        assert_eq!(report[1].range.start.line, 4);
    }

    #[test]
    fn output_bindings_expand_prefixes() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "x y z"
        command = "bar"

        [[bind]]
        key = "h k z"
        command = "biz"

        [[bind]]
        key = "a b"
        command = "foo"
        prefixes.anyOf = ["x y", "h k"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap();
        assert_eq!(result.key_bind.len(), 10)
    }

    #[test]
    fn explicit_prefixes_must_be_defined_elsewhere() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "x y"
        command = "bar"

        [[bind]]
        key = "a b"
        command = "foo"
        prefixes.anyOf = ["x y", "h k"]

        [[bind]]
        key = "k"
        command = "bizzle"
        prefixes.allBut = ["k", "y z"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let undefined_prefixes = result
            .errors
            .iter()
            .filter(|e| match e {
                ParseError {
                    error: crate::error::RawError::Dynamic(m),
                    ..
                } => m.contains("Prefix") && m.contains("undefined"),
                _ => false,
            })
            .collect::<Vec<_>>();
        assert_eq!(undefined_prefixes.len(), 4)
    }

    #[test]
    fn raises_unknown_key_warning() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "foo"
        comand = "bar"
        doc.blat = 1
        doc.combined.bar = 2

        [[kind]]
        name = "biz"
        description = "buzz"
        descriptn = "baz"

        [[mode]]
        name = "normal"
        default = true
        nme = "beep"
        whenNoBinding = 'insertCharacters'

        [[define.google]]
        bob = "x"

        [[bind]]
        key = "b"
        command = "runCommands"

        [[bind.args.commands]]
        command = "a"
        ags.value = "k"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let _result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let warnings: ErrorSet = warnings.into();
        let report = warnings.report(data.as_bytes());
        let unrecognized: Vec<_> = report
            .iter()
            .filter(|x| x.message.contains("is unrecognized"))
            .collect();
        assert_eq!(unrecognized[0].range.start.line, 0);
        assert_eq!(unrecognized[1].range.start.line, 18);
        assert_eq!(unrecognized[2].range.start.line, 13);
        assert_eq!(unrecognized[3].range.start.line, 6);
        assert_eq!(unrecognized[4].range.start.line, 6);
        assert_eq!(unrecognized[5].range.start.line, 6);
        assert_eq!(unrecognized[6].range.start.line, 33);

        assert_eq!(unrecognized.len(), 7);
    }

    #[test]
    fn raise_unknown_key_in_define() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[define.command]]
        id = "foo"
        command = "foo"
        ags = "bob"

        [[define.bind]]
        id = "beep"
        key = "x"
        cmd = "beep"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let _result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let warnings: ErrorSet = warnings.into();
        let report = warnings.report(data.as_bytes());
        assert!(report[0].message.contains("The field `ags`"));
        assert_eq!(report[0].range.start.line, 6);
        assert_eq!(report[0].range.end.line, 6);
        assert!(report[1].message.contains("The field `cmd`"));
        assert_eq!(report[1].range.start.line, 11);
        assert_eq!(report[1].range.end.line, 11);
    }

    #[test]
    fn raises_legacy_warnings() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[path]]
        id = "modes"
        description = "foo bar"

        [[bind]]
        key = "a"
        command = "foo"
        mode = ["!capture"]

        [[bind]]
        path = "modes"
        name = "normal"
        description = "All the legacy features!"
        kind = "foo"
        foreach.key = ["escape", "ctrl+[", "{key: [0-9]}"]
        combinedKey = "a/b"
        combinedName = "all"
        combinedDescription = "all the things"
        key = "{key}"
        mode = []
        resetTransient = false
        hideInPalette = true
        hideInDocs = false
        command = "master-key.enterNormal"
        computedArgs = "a+1"
        when = "!findWidgetVisible"
        "#;

        let warnings = identify_legacy_warnings(data.as_bytes());
        assert_eq!(
            warnings
                .iter()
                .filter(|x| x.error.to_string().contains("2.0"))
                .collect::<Vec<_>>()
                .len(),
            14
        );
    }

    #[test]
    fn validate_kind() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[kind]]
        name = "foo"
        description = "biz baz buz"

        [[bind]]
        key = "a"
        command = "bar"
        doc.kind = "foo"

        [[bind]]
        key = "b"
        command = "boop"
        doc.kind = "bleep"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("`bleep`"));
        assert_eq!(report[0].range.start.line, 16);
    }

    #[test]
    fn expression_error_resolves_to_field_in_array() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "foobar"
        args.names = ["{{1+2}}", "{{(1+2}}"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("Expecting ')'"));
        assert_eq!(report[0].range.start.line, 7);
        assert_eq!(report[0].range.end.line, 7);
        assert_eq!(report[0].range.start.col, 21);
        assert_eq!(report[0].range.end.col, 44);
    }

    #[test]
    fn unmatched_bracket_error_resolves_to_field_in_array() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "foobar"
        args.names = ["{{1+2}}", "{{1+2"]
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("unexpected `{{`"));
        assert_eq!(report[0].range.start.line, 7);
        assert_eq!(report[0].range.end.line, 7);
        assert_eq!(report[0].range.start.col, 21);
        assert_eq!(report[0].range.end.col, 41);
    }

    #[test]
    fn invalid_key_modifier_error() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        command = "bar"
        key = "crd+x"
        "#;

        let err = toml::from_str::<KeyFileInput>(data).unwrap_err();
        let err: ParseError = err.into();
        let report = err.report(data.as_bytes()).unwrap();
        assert!(report.message.contains("invalid modifier"));
        assert_eq!(report.range.start.line, 6);
        assert_eq!(report.range.end.line, 6);
        assert_eq!(report.range.start.col, 14);
        assert_eq!(report.range.end.col, 21);
    }

    #[test]
    fn invalid_key_name_error() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        command = "foo"
        key = "xyz"
        "#;

        let err = toml::from_str::<KeyFileInput>(data).unwrap_err();
        let err: ParseError = err.into();
        let report = err.report(data.as_bytes()).unwrap();
        assert!(report.message.contains("invalid key"));
        assert_eq!(report.range.start.line, 6);
        assert_eq!(report.range.end.line, 6);
        assert_eq!(report.range.start.col, 14);
        assert_eq!(report.range.end.col, 19);
    }

    #[test]
    fn invariant_key_name_parses() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        command = "foo"
        key = "[KeyX]"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let result = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn non_string_key_eval_errors() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        command = "foo"
        key = "{{1+2}}"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();

        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("expected a string"));
        assert_eq!(report[0].range.start.line, 6);
        assert_eq!(report[0].range.end.line, 6);
        assert_eq!(report[0].range.start.col, 14);
        assert_eq!(report[0].range.end.col, 23);
    }

    // TODO: something is up with how this is being parsed... 🤔

    #[test]
    fn expression_error_val() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.val]]
        x = "1+2}}"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();

        let report = err.report(data.as_bytes());
        assert_eq!(report[0].message, "unexpected `}}`");
        assert_eq!(report[0].range.start.line, 5);
        assert_eq!(report[0].range.end.line, 5);
        assert_eq!(report[0].range.start.col, 12);
        assert_eq!(report[0].range.end.col, 19);
    }

    #[test]
    fn define_command_error() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.command]]
        args.value = 2
        "#;

        let err = toml::from_str::<KeyFileInput>(data).unwrap_err();
        let err: ParseError = err.into();
        let report = err.report(data.as_bytes()).unwrap();
        assert_eq!(report.range.start.line, 4);
        assert_eq!(report.range.end.line, 4);
    }

    #[test]
    fn define_bind_error() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.bind]]
        key = "xyz"
        "#;

        let err = toml::from_str::<KeyFileInput>(data).unwrap_err();
        let err: ParseError = err.into();
        let report = err.report(data.as_bytes()).unwrap();
        assert_eq!(report.range.start.line, 5);
        assert_eq!(report.range.end.line, 5);
    }

    #[test]
    fn default_is_undefined() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "foo"
        default = "{{bind.foo}}"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();

        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("undefined value"));
        assert_eq!(report[0].range.start.line, 4);
        assert_eq!(report[0].range.end.line, 4);
    }

    #[test]
    fn bind_reference_misplaced() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[define.bind]]
        id = "foo"
        doc.name = "foo"

        [[bind]]
        key = "{{bind.foo}}"
        command = "bar"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();

        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("unexpected `bind.`"));
        assert_eq!(report[0].range.start.line, 9);
        assert_eq!(report[0].range.end.line, 9);
    }

    #[test]
    fn expression_error_points_to_line() {
        let data = r#"
        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "foo"
        finalKey = "{{(1+2}}"
        doc.name = "{{(2+3}}"
        doc.combined.name = "{{(3+4}}"
        "#;

        let mut scope = Scope::new();
        let mut warnings = Vec::new();
        let err = KeyFile::new(
            toml::from_str::<KeyFileInput>(data).unwrap(),
            Vec::new(),
            &mut scope,
            &mut warnings,
        )
        .unwrap_err();

        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("Expecting ')'"));
        assert_eq!(report[0].range.start.line, 7);
        assert_eq!(report[0].range.end.line, 7);
        assert!(report[1].message.contains("Expecting ')'"));
        assert_eq!(report[1].range.start.line, 8);
        assert_eq!(report[1].range.end.line, 8);
        assert!(report[2].message.contains("Expecting ')'"));
        assert_eq!(report[2].range.start.line, 9);
        assert_eq!(report[2].range.end.line, 9);
    }

    #[test]
    fn require_unique_kind_names() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[kind]]
        name = "biz"
        description = "buzz"

        [[kind]]
        name = "biz"
        description = "beep"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`name` must be unique"));
        assert_eq!(report[0].range.start.line, 10);
        assert_eq!(report[0].range.end.line, 10);
    }

    #[test]
    fn run_commands_needs_table() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "runCommands"
        args = [1,2,3]
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`args`"));
        assert_eq!(report[0].range.start.line, 6);
        assert_eq!(report[0].range.end.line, 6);
    }

    #[test]
    fn run_commands_needs_commands_array() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "runCommands"
        args.commands.x = 1
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`args.commands`"));
        assert_eq!(report[0].range.start.line, 9);
        assert_eq!(report[0].range.end.line, 9);
    }

    #[test]
    fn run_commands_needs_string_command() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "runCommands"

        [[bind.args.commands]]
        command = 2
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`command`"));
        assert_eq!(report[0].range.start.line, 11);
        assert_eq!(report[0].range.end.line, 11);
    }

    #[test]
    fn run_commands_no_nested_in_skipwhen() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "runCommands"

        [[bind.args.commands]]
        command = "runCommands"
        skipWhen = '{key.mode == "normal"}'
        args.commands = ["a", "b"]
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`skipWhen`"));
        assert_eq!(report[0].range.start.line, 12);
        assert_eq!(report[0].range.end.line, 12);
    }

    #[test]
    fn run_commands_args_table_or_array() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "runCommands"

        [[bind.args.commands]]
        command = "foo"
        args = 2
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`args`"));
        assert_eq!(report[0].range.start.line, 12);
        assert_eq!(report[0].range.end.line, 12);
    }

    #[test]
    fn run_commands_commands_args_has_objects_and_strings_only() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[bind]]
        key = "a"
        command = "runCommands"
        args.commands = ["a", 1]
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(report[0].message.contains("`commands`"));
        assert_eq!(report[0].range.start.line, 9);
        assert_eq!(report[0].range.end.line, 9);
    }

    #[test]
    fn one_mode_must_insert() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "normal"
        default = true
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope);
        let report = result.unwrap_err().report(data.as_bytes());
        assert!(
            report[0]
                .message
                .contains("`whenNoBinding='insertCharacters'`")
        );
        assert_eq!(report[0].range.start.line, 6);
        assert_eq!(report[0].range.end.line, 6);
    }

    #[test]
    fn mode_with_command_fallback() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "syminsert"
        highlight = "Highlight"
        cursorShape = "BlockOutline"

        [[mode.whenNoBinding.run]]
        command = "selection-utilities.insertAround"
        args.before = "{{val.braces[captured]?.before ?? captured}}"
        args.after = "{{val.braces[captured]?.after ?? captured}}"
        args.followCursor = true
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap();
        let run_commands = result.mode.map["syminsert"].whenNoBinding.clone();
        if let WhenNoBinding::Run(commands) = run_commands {
            assert_eq!(commands.len(), 1);
        } else {
            assert!(false);
        }
    }

    #[test]
    fn mode_with_command_has_clear_error() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "syminsert"
        highlight = "Highlight"
        cursorShape = "BlockOutline"

        [[mode.whenNoBinding.run]]
        args.before = "{{val.braces[captured].?before ?? captured}}"
        args.after = "{{val.braces[captured].?after ?? captured}}"
        args.followCursor = true
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let err = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());
        assert!(report[0].message.contains("missing field"));
        assert_eq!(report[0].range.start.line, 16);
        assert_eq!(report[0].range.end.line, 16);
    }

    #[test]
    fn mode_with_wrong_object_has_clear_error() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "syminsert"
        highlight = "Highlight"
        cursorShape = "BlockOutline"

        [[mode.whenNoBinding.rub]]
        args.before = "{{val.braces[captured].?before ?? captured}}"
        args.after = "{{val.braces[captured].?after ?? captured}}"
        args.followCursor = true
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let err = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("`rub`"));
        assert_eq!(report[0].range.start.line, 16);
        assert_eq!(report[0].range.end.line, 16);
    }

    #[test]
    fn mode_with_wrong_when_binding_string_has_clear_error() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "syminsert"
        highlight = "Highlight"
        cursorShape = "BlockOutline"
        whenNoBinding = 'insrt'
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let err = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("insrt"));
        assert_eq!(report[0].range.start.line, 15);
        assert_eq!(report[0].range.end.line, 15);
    }

    #[test]
    fn mode_with_extra_when_binding_key_fails() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "syminsert"
        highlight = "Highlight"
        cursorShape = "BlockOutline"
        whenNoBinding.useMode = "insert"
        whenNoBinding.x = "foo"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let err = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap_err();
        let report = err.report(data.as_bytes());

        assert!(report[0].message.contains("`x`"));
        assert_eq!(report[0].range.start.line, 15);
        assert_eq!(report[0].range.end.line, 15);
    }

    #[test]
    fn mode_generates_implicit_bindings() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "normal"
        default = true
        whenNoBinding = 'ignoreCharacters'

        [[mode]]
        name = "insert"
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "special"
        whenNoBinding.useMode = 'normal'

        [[bind]]
        foreach.key = ['a', 's', 'd', 'f']
        key = "{{key}}"
        command = "foo"
        args.value = "action-{{key}}"

        [[bind]]
        foreach.key = ['j','k','l']
        key = "{{key}}"
        command = "special"
        args.value = "action-{{key}}"
        mode = 'special'
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap();

        // verify that all ignore bindings are present
        let ignore_bindings = result.key_bind.iter().filter(|x| match x {
            BindingOutput::Ignore { .. } => true,
            _ => false,
        });
        assert_eq!(
            ignore_bindings.clone().collect::<Vec<_>>().len(),
            all_characters().len() * 2
        );
        assert_eq!(
            ignore_bindings
                .clone()
                .filter(|x| match x {
                    BindingOutput::Ignore { when: Some(w), .. } => {
                        !w.contains("special") && !w.contains("insert")
                    }
                    _ => false,
                })
                .collect::<Vec<_>>()
                .len(),
            all_characters().len()
        );
        assert_eq!(
            ignore_bindings
                .clone()
                .filter(|x| match x {
                    BindingOutput::Ignore { when: Some(w), .. } => w.contains("special"),
                    _ => false,
                })
                .collect::<Vec<_>>()
                .len(),
            all_characters().len()
        );

        // verify that fallback bindings are present
        let normal_fallback = result.key_bind.iter().filter(|x| match x {
            BindingOutput::Do {
                key, when: Some(w), ..
            } => w.contains("special") && (key == "a" || key == "s" || key == "d" || key == "f"),
            _ => false,
        });
        assert_eq!(normal_fallback.collect::<Vec<_>>().len(), 4);
    }

    #[test]
    fn indexing_binding_resolution() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        whenNoBinding = "insertCharacters"

        [[mode]]
        name = "normal"
        default = true
        whenNoBinding = "ignoreCharacters"

        [[bind]]
        key = "h"
        command = "left"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap();
        if let BindingOutput::Do {
            args: BindingOutputArgs { command_id, .. },
            ..
        } = result.key_bind.last().unwrap()
        {
            assert_eq!(command_id, &0);
        } else {
            assert!(false);
        }
    }

    /*
        #:master-keybindings

       [header]
       version = "2.0.0"

       [[mode]]
       name = "insert"
       whenNoBinding = "insertCharacters"

       [[mode]]
       name = "normal"
       default = true
       whenNoBinding = "ignoreCharacters"

       [[bind]]
       key = "a"
       command = "runCommands"

       [[bind.args.commands]]
       command = "master-key.prefix"

       [[bind.args.commands]]
       command = "foo"

       [[bind]]
       key = "b"
       command = "runCommands"
    */

    #[test]
    fn explicit_prefix_code_handling() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        whenNoBinding = "insertCharacters"

        [[mode]]
        name = "normal"
        default = true
        whenNoBinding = "insertCharacters"

        [[bind]]
        key = "a"
        command = "runCommands"

        [[bind.args.commands]]
        command = "master-key.prefix"

        [[bind.args.commands]]
        command = "foo"

        [[bind]]
        key = "a c"
        command = "bar"
        when = "editorTextFocus" # this line is crucial to what we're testing here
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap();

        let a_bind_id = result
            .key_bind
            .iter()
            .filter_map(|k| match k {
                BindingOutput::Do {
                    key,
                    args: crate::bind::BindingOutputArgs { key_id, .. },
                    ..
                } if key == "a" => Some(key_id),
                _ => None,
            })
            .next()
            .unwrap();
        let c_bind_when = result
            .key_bind
            .iter()
            .filter_map(|k| match k {
                BindingOutput::Do {
                    key,
                    when: Some(w_str),
                    ..
                } if key == "c" => Some(w_str),
                _ => None,
            })
            .next()
            .unwrap();
        assert!(c_bind_when.contains(&format!("prefixCode == {a_bind_id}")));
    }

    #[test]
    fn explicit_prefixes_work_with_any_prefix_edge_case() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"
        name = "Simple Motions"

        [[mode]]
        name = "insert"
        whenNoBinding = "insertCharacters"

        [[mode]]
        name = "normal"
        default = true
        highlight = "Highlight"
        cursorShape = "Block"
        whenNoBinding = "insertCharacters"

        [[bind]]
        doc.name = "normal mode"
        key = "escape"
        command = "master-key.enterNormal"
        prefixes.any = true

        [[bind]]
        doc.name = "delete"
        key = "d"
        mode = "normal"
        command = "runCommands"

        [[bind.args.commands]]
        command = "master-key.prefix"

        [[bind.args.commands]]
        command = "foo"

        [[bind]]
        doc.name = "word operation"
        key = "w"
        mode = "normal"
        prefixes.anyOf = ["d"]
        command = "biz"
        when = "editorTextFocus"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(data.as_bytes(), &mut warnings, &mut scope).unwrap();

        result.key_bind.iter().for_each(|k| match k {
            BindingOutput::Prefix {
                key,
                args:
                    crate::bind::PrefixArgs {
                        key: prefix_key, ..
                    },
                ..
            } if key == "w" && prefix_key == "d w" => {
                assert!(false)
            }
            _ => (),
        });
    }

    #[test]
    fn expression_debug_parses() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        whenNoBinding = "insertCharacters"

        [[mode]]
        name = "normal"
        default = true
        whenNoBinding = "insertCharacters"

        [[bind]]
        key = '{{show("string: ", "a b")}}'
        command = "foo"
        args.value = '{{show("sum: ", 1+2)}}'
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let _ = parse_bytes_helper(&data.as_bytes(), &mut warnings, &mut scope).unwrap();
        let report = ErrorSet { errors: warnings }.report(data.as_bytes());

        assert!(report[0].message.contains("string: "))
    }

    #[test]
    fn tags_resolve_from_default() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[define.bind]]
        id = "foo"
        tags = ["a", "b"]

        [[bind]]
        default = "{{bind.foo}}"
        key = 'ctrl+a'
        command = "foo"

        [[define.bind]]
        id = "foo_bar"
        default = "{{bind.foo}}"
        doc.name = "testing"

        [[bind]]
        default = "{{bind.foo_bar}}"
        key = 'ctrl+b'
        command = "bar"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(&data.as_bytes(), &mut warnings, &mut scope).unwrap();
        assert_eq!(result.bind[0].tags.len(), 2);
        assert_eq!(result.bind[1].tags.len(), 2);
    }

    #[test]
    fn prefix_any_and_automated_prefix_interaction_test() {
        // in an older implementation we found an edge case where including the first
        // binding (which must have prefixes.any to cause the problem), would prevent the
        // second binding from producing the automated `master-key.prefix` binding, at least
        // in some cases.
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[mode]]
        name = "insert"
        default = true
        whenNoBinding = "insertCharacters"

        [[mode]]
        name = "normal"

        # NOTE: this binding specifically had to occur *before* the bindings below
        # for the automated prefix commands to be excluded
        [[bind]]
        doc.name = "show palette"
        key = "shift+;"
        finalKey = false
        doc.hideInPalette = true
        prefixes.any = true
        mode = "normal"
        command = "master-key.commandSuggestions"

        [[bind]]
        command = "cursorMove"
        mode = "normal"
        args.value = "{{key.count}}"
        doc.name = "funny right"
        key = "r w"
        args.to = "right"
        "#;

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(&data.as_bytes(), &mut warnings, &mut scope).unwrap();
        let prefixes: Vec<_> = result
            .key_bind
            .iter()
            .filter(|x| match x {
                BindingOutput::Prefix { .. } => true,
                _ => false,
            })
            .collect();
        assert_eq!(prefixes.len(), 1);
    }

    #[test]
    fn before_after_commands() {
        let data = r#"
        #:master-keybindings

        [header]
        version = "2.0.0"

        [[define.bind]]
        id = "add_commands"

        [[define.bind.after]]
        command = "foo"

        [[define.bind.before]]
        command = "bar"

        [[bind]]
        default = "{{bind.add_commands}}"
        key = "cmd+b"
        command = "biz"
        "#;
        let result = parse_keybinding_data(&data);
        let commands = result.file.unwrap().bind[0].clone().commands;
        assert_eq!(commands[0].command, "bar");
        assert_eq!(commands[1].command, "biz");
        assert_eq!(commands[2].command, "foo");

        assert!(
            result.errors.as_ref().unwrap()[0]
                .message
                .contains("`before`")
        );
        assert!(
            result.errors.as_ref().unwrap()[1]
                .message
                .contains("`after`")
        );

        let data = r#"
        #:master-keybindings

        [header]
        version = "2.1.0"

        [[define.bind]]
        id = "add_commands"

        [[define.bind.after]]
        command = "foo"

        [[define.bind.before]]
        command = "bar"

        [[bind]]
        default = "{{bind.add_commands}}"
        key = "cmd+b"
        command = "biz"
        "#;
        let result = parse_keybinding_data(&data);
        assert_eq!(result.errors.unwrap().len(), 0)
    }

    #[test]
    fn text_doc_parsing() {
        let data = std::fs::read("src/test_files/text-docs.toml").unwrap();
        let result = parse_keybinding_data(&data);
        let output = std::fs::read("src/test_files/text-docs.md").unwrap();

        assert_eq!(
            result.text_docs().unwrap().trim(),
            str::from_utf8(&output).unwrap().trim()
        );

        assert_eq!(
            result.binding_section(0).unwrap().names,
            Vec::from([
                "Test Documentation".to_string(),
                "First Section".to_string()
            ])
        );
        assert_eq!(
            result.binding_section(1).unwrap().names,
            Vec::from([
                "Test Documentation".to_string(),
                "First Section".to_string()
            ])
        );
        assert_eq!(
            result.binding_section(2).unwrap().names,
            Vec::from([
                "Test Documentation".to_string(),
                "First Section".to_string()
            ])
        );
        assert_eq!(
            result.binding_section(51).unwrap().names,
            Vec::from([
                "Test Documentation".to_string(),
                "Second Section".to_string()
            ])
        );
        assert_eq!(
            &result.file.as_ref().unwrap().bind[0]
                .key
                .first()
                .as_ref()
                .unwrap()
                .as_str(),
            &"escape"
        );
        assert_eq!(
            &result.file.as_ref().unwrap().bind[1]
                .key
                .first()
                .as_ref()
                .unwrap()
                .as_str(),
            &"h"
        );
        assert_eq!(
            &result.file.as_ref().unwrap().bind[2]
                .key
                .first()
                .as_ref()
                .unwrap()
                .as_str(),
            &"l"
        );
        assert_eq!(
            &result.file.as_ref().unwrap().bind[51]
                .key
                .first()
                .as_ref()
                .unwrap()
                .as_str(),
            &"k"
        );
    }

    #[test]
    fn test_plural_expressions() {
        let outside_expressions = r#"
        #:master-keybindings

        [header]
        version = "2.1.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"

        [[bind]]
        key = "h"
        command = "master-key.prefix"

        [[bind]]
        key = "x"
        mode = '{{["a"]}}'
        tags = '{{["k", "h"]}}'
        prefixes.anyOf = '{{["h"]}}'
        command = "foo"

        [[bind]]
        key = "u"
        command = "biz"
        prefixes.allBut = '{{["h"]}}'
        "#;

        let inside_expressions = r#"
        #:master-keybindings

        [header]
        version = "2.1.0"

        [[mode]]
        name = "a"
        default = true
        whenNoBinding = 'insertCharacters'

        [[mode]]
        name = "b"

        [[bind]]
        key = "h"
        command = "master-key.prefix"

        [[bind]]
        key = "y"
        command = "bar"
        mode = ['{{"a"}}']
        tags = ['{{"k"}}', '{{"h"}}']
        prefixes.anyOf = ['{{"h"}}']

        [[bind]]
        key = "v"
        command = "baz"
        prefixes.allBut = ['{{"h"}}']
        "#;

        let outside_result = parse_keybinding_data(&outside_expressions);
        let bind = outside_result.file.unwrap().bind;
        assert_eq!(bind[1].mode, ["a".to_string()]);
        assert_eq!(bind[1].tags, ["k".to_string(), "h".to_string()]);
        if let Prefix::AnyOf(prefixes) = bind[1].prefixes.clone() {
            assert_eq!(prefixes, ["h".to_string()]);
        } else {
            assert!(false);
        }

        let inside_result = parse_keybinding_data(&inside_expressions);
        let bind = inside_result.file.unwrap().bind;
        assert_eq!(bind[1].mode, ["a".to_string()]);
        assert_eq!(bind[1].tags, ["k".to_string(), "h".to_string()]);
        if let Prefix::AnyOf(prefixes) = bind[1].prefixes.clone() {
            assert_eq!(prefixes, ["h".to_string()]);
        } else {
            assert!(false);
        }
    }

    #[test]
    fn larkin_test() {
        // the default presets should be parseable (also a good "integration" test to ensure
        // our parsing works at scale)
        let data = std::fs::read("../../presets/larkin.toml").unwrap();

        let mut warnings = Vec::new();
        let mut scope = Scope::new();
        let result = parse_bytes_helper(&data, &mut warnings, &mut scope).unwrap();
        assert_eq!(result.bind.len(), 309);

        assert!(FileDocSection::write_markdown(&result.docs, true).len() > 0);
        // info!(
        //     "docs: {}",
        //     FileDocSection::write_markdown(&result.docs, true)
        // )
    }
    // TODO: write unit tests for `debug` function
}
