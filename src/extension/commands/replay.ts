import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { EvalContext } from '../expressions';
import { withState, CommandResult, recordedCommand } from '../state';
import { doCommands, RecordedCommandArgs, RunCommandsArgs, COMMAND_HISTORY } from './do';
import { uniq } from 'lodash';
import { List } from 'immutable';

const selectHistoryArgs = z.
    object({
        whereComputedRangeIs: z.object({ from: z.string(), to: z.string() }).optional(),
        whereComputedIndexIs: z.string().optional(),
        value: z.object({}).passthrough().array().optional(),
        register: z.string().optional(),
    }).
    strict().
    refine(x => x.whereComputedIndexIs || x.whereComputedRangeIs || x.value, {
        message:
            'Either `whereComputedIndexIs`, `whereComputedRangeIs` or `value` is required.',
    });

const evalContext = new EvalContext();

async function evalMatcher(matcher: string, i: number) {
    let result_;
    await withState(async (state) => {
        result_ = evalContext.evalStr(matcher, { ...state.values, index: i });
        return state;
    });
    if (typeof result_ !== 'number') {
        if (result_) {
            return i;
        } else {
            return -1;
        }
    } else {
        return result_;
    }
}

async function selectHistoryCommand(cmd: string, args_: unknown) {
    const args = validateInput(cmd, args_, selectHistoryArgs);
    if (args) {
        let value: RecordedCommandArgs[] | undefined = undefined;
        if (args.value) {
            value = <RecordedCommandArgs[]>args.value;
        } else {
            // find the range of commands we want to replay
            const state = await withState(async x => x);
            if (!state) {
                return;
            }
            const history_ = state.get<List<RecordedCommandArgs>>(COMMAND_HISTORY, List())!;
            const history = history_.toArray();
            let from = -1;
            let to = -1;
            const toMatcher = args.whereComputedRangeIs?.to || args.whereComputedIndexIs;
            const fromMatcher = args.whereComputedRangeIs?.from;
            // TODO: the problem here is that we're treating history as an array but its a
            // `immutablejs.List`. Don't really want to expose that to the user... also
            // sounds expensive to convert to javascript array every time a repeat is
            // performed
            for (let i = history.length - 1; i >= 0; i--) {
                // NOTE: remember that `selectHistoryArgs` cannot leave both `range` and
                // `at` undefined, so at least one of `toMatcher` and `fromMatcher` are not
                // undefined
                if (to < 0 && toMatcher) {
                    to = await evalMatcher(toMatcher, i);
                    if (args.whereComputedIndexIs) {
                        from = to;
                    }
                }
                if (from < 0 && fromMatcher) {
                    from = await evalMatcher(fromMatcher, i);
                }
                if (from > 0 && to > 0) {
                    value = history.slice(from, to + 1);
                    break;
                }
            }
        }
        return value;
    }
    return undefined;
}

function cleanupEdits(edits: vscode.TextDocumentChangeEvent[] | string) {
    if (typeof edits === 'string') {
        return edits;
    } else {
        let result = '';
        for (const edit of edits) {
            const strings = uniq(edit.contentChanges.map(x => x.text));
            if (strings.length === 1) {
                result += strings[0];
            }
        }
        return result;
    }
}

const REPLAY_DELAY = 50;
// TODO: does `commands` require the `RunCommandsArgs` type?
async function runCommandHistory(
    commands: (RunCommandsArgs | RecordedCommandArgs)[],
): Promise<CommandResult> {
    for (const cmd of commands) {
        await doCommands(cmd);

        if ((<RecordedCommandArgs>cmd).edits) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const ed = editor;
                const recorded = <RecordedCommandArgs>cmd;
                const edits = cleanupEdits(recorded.edits);
                recorded.edits = edits;
                editor.edit((e) => {
                    for (const sel of ed.selections) {
                        e.insert(sel.anchor, edits);
                    }
                });
            } else {
                vscode.window.showErrorMessage(`Command includes edits to the active text
                    editor, but there is currently no active editor.`);
            }
        }
        // replaying actions too fast messes up selection
        await new Promise(res => setTimeout(res, REPLAY_DELAY));
    }
    return;
}

/**
 * @command replayFromHistory
 * @section Recording and Replaying Commands
 * @order 150
 *
 * Replay previously typed master keybindings.
 *
 * > [!NOTE] Master key has no knowledge of commands or keybindings that were not run from a
 * > keybinding defined in a master keybinding file. This is because the command history is
 * > implemented by pushing each command called with [`master-key.do`](/commands/do) to an
 * > array. Commands that *only* call `master-key.prefix` are not recorded, since they do
 * > not need to be replayed to reproduce the ultimate effect of a keybinding.
 *
 * All commands are recorded, up until the the history limit (defined by the `Command
 * History Maximum`). When selecting command history to replay, you use one or more
 * [`expressions`](/expressions/index) An expression is evaluated at each valid
 * `index` of `commandHistory`. Evaluation occurs from most recent command (largest index)
 * to least recent command (smallest indx), selecting the first index where the expression
 * evaluates to a truthy value. The structure of each command in `commandHistory` is exactly
 * the format used to represent the commands in a master keybinding file.
 *
 * **Arguments**
 *
 * There are two ways the history can be selected:
 *
 * - `whereComputedRangeIs.from`: an expression specifying the first command to push to the
 *   stack
 * - `whereComputedRangeIs.to`: an expression specifying the last command to push to the
 *   stack
 *
 * OR
 *
 * - `whereComputedIndexIs`: an expression specifying the single command to push to the
 *   stack
 *
 * ## Example
 *
 * As an example, here's how Larkin runs the most recently run action.
 *
 * ```toml
 * [[bind]]
 * defaults = "edit.action.history"
 * name = "repeat action"
 * key = "."
 * command = "runCommands"
 * computedRepeat = "count"
 *
 * [[bind.args.commands]]
 * command = "master-key.replayFromHistory"
 * args.whereComputedIndexIs = """
 * commandHistory[index].defaults.startsWith('edit.action') &&
 * (!commandHistory[index].defaults.startsWith('edit.action.history') ||
 *  commandHistory[index].name == 'replay')
 * """
 *
 * [[bind.args.commands]]
 * command = "master-key.enterNormal"
 * ```
 *
 * The key argument of relevance here is the expression defined in
 * `args.whereComputedIndexIs` where we select the most recent command that is an
 * `edit.action`, excluding those actions that are used to replay actions themselves.
 */
async function replayFromHistory(args: unknown): Promise<CommandResult> {
    const commands = await selectHistoryCommand('master-key.replayFromHistory', args);
    if (commands) {
        await runCommandHistory(commands);
        return { ...(<object>args), value: commands };
    }
    return;
}

/**
 * @command pushHistoryToStack
 * @order 150
 *
 * Store a set of previously typed keybindings defined by master key to a stack. Refer to
 * [`replayFromHistory`](/commands/replayFromHistory) for details on how to use the
 * `whenComputedRange` and `whenComputedIndex` arguments.
 *
 * **Arguments**
 * - `whenComputedRange.from`: an expression specifying the first command to push to the
 *   stack
 * - `whenComputedRange.to`: an expression specifying the last command to push to the stack
 * - `whenComputedIndex`: an expression specifying the single command to push to the stack
 * - `register`: (defaults to "") the specific, named stack where commands will be stored.
 */
async function pushHistoryToStack(args: unknown): Promise<CommandResult> {
    const commands = await selectHistoryCommand('master-key.pushHistoryToStack', args);
    if (commands) {
        const cs = commands;
        await withState(async (state) => {
            return state.update<List<RecordedCommandArgs[]>>(
                MACRO,
                { notSetValue: List() },
                macro => macro.push(cs),
            );
        });
    }
    return;
}

/**
 * @command replayFromStack
 * @order 150
 *
 * Reply a command stored on the given stack.
 *
 * **Arguments**
 * - `register`: (defaults "") the named stack to replay from
 * - `index`: (defaults to 0) the position on the stack to replay from, with 0 being the
 *   most recently added item to the stack.
 *
 * You can add commands to this stack using
 * [`pushHistoryToStack`](/commands/pushHistoryToStack).
 */
const replayFromStackArgs = z.
    object({
        index: z.number().min(0).optional().default(0),
        register: z.string().optional(),
    }).
    strict();

async function replayFromStack(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.replayFromStack', args_, replayFromStackArgs);
    if (args) {
        const state = await withState(async s => s);
        if (!state) {
            return;
        }
        const macros = state.get<List<RecordedCommandArgs[]>>(MACRO, List())!;
        const commands = macros.last();
        if (commands) {
            await runCommandHistory(commands);
        }
    }
    return;
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
 * args.whereComputedRangeIs.from = 'commandHistory[index-1].name === "record"'
 * args.whereComputedRangeIs.to = "index"
 * ```
 */
async function record(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.record', args_, recordArgs);
    if (args) {
        const a = args;
        await withState(async (state) => {
            return state.set(RECORD, { public: true }, a.on);
        });
    }
    return;
}

const MACRO = 'macro';
export function activate(context: vscode.ExtensionContext) {
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

    vscode.workspace.onDidChangeTextDocument(async (e) => {
        await withState(async (state) => {
            // TODO: handle the empty history case
            const opts = { notSetValue: List<object>() };
            return state.update<List<object>>(COMMAND_HISTORY, opts, (history) => {
                const len = history.count();

                return history.update(len - 1, (lastCommand_) => {
                    const lastCommand = <RecordedCommandArgs>lastCommand_;
                    if (
                        lastCommand &&
                        typeof lastCommand.edits !== 'string' &&
                        lastCommand.recordEdits === e.document
                    ) {
                        lastCommand.edits = lastCommand.edits.concat(e);
                    }
                    return lastCommand;
                });
            });
        });
    });
}
