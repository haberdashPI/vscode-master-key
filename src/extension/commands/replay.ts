import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { state, CommandResult, recordedCommand } from '../state';
import { bindings } from '../keybindings/config';
import { documentIdentifiers } from './do';
import { ReifiedBinding } from '../../rust/parsing/lib/parsing';

const selectHistoryArgs = z.
    object({
        range: z.object({ from: z.number(), to: z.number() }).optional(),
        index: z.number().optional(),
        value: z.unknown(), // always a ReifiedBinding[], but we bypass validation
        register: z.string().optional(),
    }).
    strict().
    refine(x =>
        (x.index != undefined ? 1 : 0) +
        (x.range != undefined ? 1 : 0) +
        (x.value != undefined ? 1 : 0) == 1, {
        message:
            'Exactly one of `index`, `range` or `value` must be non null',
    });

function commandsFromHistory(command: string, args_: unknown) {
    const args = validateInput(command, args_, selectHistoryArgs);
    if (args) {
        let value;
        // extract this into a function for anything wanting to process `selectHistoryArgs`
        if (args.value) {
            value = <ReifiedBinding[]>args.value;
        } else {
            let from;
            let to;
            if (args.index) {
                from = args.index;
                to = args.index;
            } else {
                from = args.range?.from;
                to = args.range?.to;
            }
            // `!` is safe given XOR constraint for `selectHistoryArgs`
            value = bindings.history_at(from!, to!);
        }
        return { value, register: args.register };
    }
    return;
}

function cleanupEdit(edit: vscode.TextDocumentChangeEvent) {
    let result = '';
    const strings = edit.contentChanges.map(x => x.text);
    // NOTE: if there are multiple locations where edits happened, this implies we'd need to
    // infer how insertion with a new set of text should "move the cursor" between edits
    // "like before". It's not clear how to do this, in general, so these kind of edit
    // events are simply ignored. Such non-trivial situations in the edit events are
    // avoidable for many uses cases we intend to cover here. The way the multiple edit
    // locations would arise would normally would be via calls to multiple commands that
    // each run `master-key.do` for which we would not see these multiple edit locations in
    // a single event recorded by the same command)
    if (strings.length === 1) {
        result += strings[0];
    }
    return result;
}

const REPLAY_DELAY = 50;
// TODO: does `commands` require the `RunCommandsArgs` type?
export async function runCommands(
    macro: ReifiedBinding[],
): Promise<void> {
    for (const binding of macro) {
        for (let i = 0; i < binding.repeat + 1; i++) {
            for (const command of binding.commands) {
                if (command.command !== 'master-key.ignore') {
                    await vscode.commands.executeCommand(command.command, command.args);
                }
                const editor = vscode.window.activeTextEditor;
                const edits = binding.edit_text;
                if (edits && editor) {
                    const ed = editor;
                    editor.edit((e) => {
                        for (const sel of ed.selections) {
                            e.insert(sel.anchor, edits);
                        }
                    });
                } else if (edits) {
                    vscode.window.showErrorMessage(`Command includes edits to the
                        active text editor, but there is currently no active editor.`);
                }
            }
        }
        await new Promise(res => setTimeout(res, REPLAY_DELAY));
    }
}

/**
 * @command replayFromHistory
 * @section Recording and Replaying Commands
 * @order 150
 *
 * Replay both previously run commands via master keybindings as well simple textual edits
 * to a buffer.
 *
 * > [!WARNING] Recording Limitations
 * > API limitations mean this command cannot replay
 * > everything. Master key has no knowledge of commands or keybindings outside of master
 * > key. This is because `replay` uses a history of commands updated when calling into
 * > commands like [`master-key.do`](/commands/do). Furthermore while Master Key records
 * > text edits for modes where `whenNoBinding = 'insertCharacters'` these textual edits are
 * > limited. A maximum number of characters are stored between each call to a master-key
 * > command (determined by the setting `Text History Maximum`) and only simple insertion of
 * > text is handled. Given the limits of the VSCode API for observing edits, this will miss
 * > some automated insertions such as code completion and automated parentheses insertion.
 * > Also note that any edits that occur *before* the extension is activated are not
 * > recorded.
 *
 * Excluding the aforementioned limitations, both commands and textual edits are recorded,
 * up until the the history limit (defined by the `Command History Maximum`). When selecting
 * command history to replay, you use one or more [`expressions`](/expressions/index).
 *
 * **Arguments**
 *
 * There are two ways the history can be selected:
 *
 * - `range.from`: an expression specifying the index of the first command in the history
 * - `range.to`: an expression specifying the index of the last command in the history
 *
 * OR
 *
 * - `index`: an expression specifying a single index from the command history
 *
 * ## Expression evaluation for History
 *
 * Expressions have access to a variable called `history` which is an indexable container of
 * previously run commands. On this container you can
 *
 * - call `history.len()` to get the number of available commands
 * - index values via `history[0]`; values range from 0 to `history.len()-1` and indexing
 *   outside this range returns a null value. The most recently run commands are at the
 *   largest indices.
 * - use `last_history_index()` to call a predicate function for each index from
 *   `history.len()-1` to `0` and return the first index that is found to be true for this
 *   predicate.
 *
 * Each element of this history contains the following properties
 *
 * - `commands`: an array of objects with the `command` field from each run command. All
 *   commands are regularized to be objects here: e.g. ["a", "b"] will be regularized to
 *   `[{command = "a"}, {command = "b"}]`.
 * - `mode`: the mode the command was executed from
 * - `repeat`: the number of times the command was repeated
 * - `tags`: the tags defined by the `[[bind]]` entry
 * - `doc`: all documentation fields as defined in `[[bind]]`
 *
 * ## Example
 *
 * As an example, here's how Larkin runs the most recent action.
 *
 * ```toml
 * [[bind]]
 * default = "{{bind.edit_action_history}}"
 * doc.name = "repeat action"
 * doc.description = """
 * Repeat the last action command. Actions usually modify the text of a document in one
 * way or another. (But, e.g. sending text to the REPL is also considered an editor action).
 * See also `,` which repeats the last "subject" of an action (the selection preceding an
 * action).
 * """
 * key = "."
 * command = "runCommands"
 * repeat = "{{key.count}}"
 *
 * [[bind.args.commands]]
 * command = "master-key.replayFromHistory"
 * # we can repeat any action but history-related actions; we make an exception for
 * # replaying macros, which *can* be repeated
 * args.index = """{{
 * last_history_index(|x|
 *     x.tags.contains("action") &&
 *     !(x.tags.contains("history") && !x.docs.name == "replay")
 * }}"""
 *
 * [[bind.args.commands]]
 * command = "master-key.enterNormal"
 * ```
 *
 * The key argument of relevance here is the expression defined in `args.index` where we
 * select the most recent command that has the tag `"action"`, excluding those actions that
 * are related to manipulating the history of commands.
 */
async function replayFromHistory(args_: unknown): Promise<CommandResult> {
    const result = commandsFromHistory('master-key.replayFromHistory', args_);
    const commands = result?.value;
    if (commands) {
        await runCommands(commands);
    }
    // return commands;
    return;
}

/**
 * @command pushHistoryToStack
 * @order 150
 *
 * Store a set of previously typed keybindings defined by master key to a stack. Refer to
 * [`replayFromHistory`](/commands/replayFromHistory) for details on how to use the
 * `range` and `index` arguments.
 *
 * **Arguments**
 * - `range.from`: an expression specifying the first command to push to the
 *   stack
 * - `range.to`: an expression specifying the last command to push to the stack
 * - `index`: an expression specifying the single command to push to the stack
 */
async function pushHistoryToStack(args: unknown): Promise<CommandResult> {
    const value = commandsFromHistory('master-key.pushHistoryToStack', args);
    const commands = value?.value;
    if (commands) {
        bindings.push_macro(commands);
        return commands;
    }
    return;
}

/**
 * @command replayFromStack
 * @order 150
 *
 * Reply a command stored on the stack.
 *
 * **Arguments**
 * - `index`: (defaults to 0) the position on the stack to replay from, with 0 being the
 *   most recently added item to the stack.
 *
 * You can add commands to this stack using
 * [`pushHistoryToStack`](/commands/pushHistoryToStack).
 */
const replayFromStackArgs = z.
    object({
        index: z.number().min(0).optional().default(0),
    }).
    strict();

async function replayFromStack(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.replayFromStack', args_, replayFromStackArgs);
    if (args) {
        const commands = bindings.get_macro(args.index);
        if (commands) {
            await runCommands(commands);
        }
    }
    return args;
}

export const RECORD = 'record';
const recordArgs = z.
    object({
        on: z.boolean(),
    }).
    strict();

/**
 * @command record
 * @order 150
 *
 * Turns a recording marker on or off. Note that all commands are always recorded,
 * regardless of this value. This flag is to make it easy to select past history, by looking
 * for `master-key.record` entries in the command history.
 *
 * Furthermore, when record is on, Master Key will change the status bar `mode` to signal
 * that keys are being recorded.
 *
 * **Arguments**
 * - `on`: boolean indicating if the recording flag should be set on (true) or off (false).
 *
 * ## Example
 *
 * Larkin uses the record flag to store command sequences for future replay.
 *
 * ```toml
 * [[bind]]
 * defaults = "edit.action.history"
 * name = "record"
 * description = "Start/stop recording Master Key commands"
 * key = "shift+q"
 * when = "!master-key.record"
 * command = "master-key.record"
 * args.on = true
 *
 * [[bind]]
 * defaults = "edit.action.history"
 * name = "record"
 * description = """
 * Start/stop recording key presses defined by Master Key pushing it to the
 * top of the `history` stack once recording finishes."
 * """
 * key = "shift+q"
 * when = "master-key.record"
 * command = "runCommands"
 *
 * [[bind.args.commands]]
 * command = "master-key.record"
 * args.on = false
 *
 * [[bind.args.commands]]
 * command = "master-key.pushHistoryToStack"
 * args.range.from = '{{last_history_index(|i| history[i-1]?.doc?.name == "record")}}'
 * args.range.to = '{{history.len()-1}}'
 * ```
 */
async function record(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.record', args_, recordArgs);
    if (args) {
        const a = args;
        state.set(RECORD, a.on);
    }
    return;
}

let maxTextHistory = 1024;
function updateConfig(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event?.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        let configMaxHistory = config.get<number>('maxTextHistory');
        if (configMaxHistory === undefined) {
            configMaxHistory = 1024;
        } else {
            maxTextHistory = configMaxHistory;
        }
    }
}

export function defineState() {
    state.define(RECORD, false);
}

export async function activate(_context: vscode.ExtensionContext) {
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    vscode.workspace.onDidChangeTextDocument(async (e) => {
        const id = documentIdentifiers.get(e.document.uri);
        if (id && bindings.is_recording_edits_for(id, maxTextHistory)) {
            bindings.store_edit(cleanupEdit(e), maxTextHistory);
        }
    });
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.pushHistoryToStack',
            recordedCommand(pushHistoryToStack),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.replayFromHistory',
            recordedCommand(replayFromHistory),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.replayFromStack',
            recordedCommand(replayFromStack),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.record', recordedCommand(record)),
    );
}
