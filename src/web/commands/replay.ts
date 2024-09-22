import * as vscode from 'vscode';
import z from 'zod';
import {validateInput} from '../utils';
import {EvalContext} from '../expressions';
import {withState, CommandResult, recordedCommand} from '../state';
import {doCommands, RecordedCommandArgs, RunCommandsArgs, COMMAND_HISTORY} from './do';
import {uniq} from 'lodash';
import {List} from 'immutable';

const selectHistoryArgs = z
    .object({
        range: z.object({from: z.string(), to: z.string()}).optional(),
        at: z.string().optional(),
        value: z.object({}).passthrough().array().optional(),
        register: z.string().optional(),
    })
    .strict()
    .refine(x => x.at || x.range || x.value, {
        message: 'Either `at`, `range` or `value` is required.',
    });

const evalContext = new EvalContext();

async function evalMatcher(matcher: string, i: number) {
    let result_;
    await withState(async state => {
        result_ = evalContext.evalStr(matcher, {...state.values, i});
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
            const toMatcher = args.range?.to || args.at;
            const fromMatcher = args.range?.from;
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
                    if (args.at) {
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
    commands: (RunCommandsArgs | RecordedCommandArgs)[]
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
                editor.edit(e => {
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

async function pushHistoryToStack(args: unknown): Promise<CommandResult> {
    const commands = await selectHistoryCommand('master-key.pushHistoryToStack', args);
    if (commands) {
        const cs = commands;
        await withState(async state => {
            return state.update<List<RecordedCommandArgs[]>>(
                MACRO,
                {notSetValue: List()},
                macro => macro.push(cs)
            );
        });
    }
    return;
}

async function replayFromHistory(args: unknown): Promise<CommandResult> {
    const commands = await selectHistoryCommand('master-key.replayFromHistory', args);
    if (commands) {
        await runCommandHistory(commands);
        return {...(<object>args), value: commands};
    }
    return;
}

const replayFromStackArgs = z
    .object({
        index: z.number().min(0).optional().default(0),
        register: z.string().optional(),
    })
    .strict();

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
const recordArgs = z
    .object({
        on: z.boolean(),
    })
    .strict();

async function record(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.record', args_, recordArgs);
    if (args) {
        const a = args;
        await withState(async state => {
            return state.set(RECORD, {public: true}, a.on);
        });
    }
    return;
}

const MACRO = 'macro';
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.pushHistoryToStack',
            recordedCommand(pushHistoryToStack)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.replayFromHistory',
            recordedCommand(replayFromHistory)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.replayFromStack',
            recordedCommand(replayFromStack)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.record', recordedCommand(record))
    );

    vscode.workspace.onDidChangeTextDocument(async e => {
        await withState(async state => {
            // TODO: handle the empty history case
            const opts = {notSetValue: List<object>()};
            return state.update<List<object>>(COMMAND_HISTORY, opts, history => {
                const len = history.count();

                return history.update(len - 1, lastCommand_ => {
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
