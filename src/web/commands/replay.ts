import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { EvalContext } from '../expressions';
import { withState, CommandResult, recordedCommand } from '../state';
import { doCommands, RecordedCommandArgs, RunCommandsArgs, COMMAND_HISTORY } from './do';
import { uniq } from 'lodash';
import { List } from 'immutable';

const selectHistoryArgs = z.object({
    range: z.object({
        from: z.string(),
        to: z.string(),
    }).optional(),
    at: z.string().optional(),
    value: z.object({}).array().optional(),
    register: z.string().optional(),
}).strict().refine(x => x.at || x.range, ({
    message: "Either `at` or `range` is required."
}));

let evalContext = new EvalContext();

async function evalMatcher(matcher: string, i: number) {
    let result_;
    await withState(async state => {
        result_ = evalContext.evalStr(matcher, {...state.values, i});
        return state;
    });
    if(typeof result_ !== 'number'){
        if(result_){ return i; }
        else{ return -1; }
    }else{
        return result_;
    }
}

async function selectHistoryCommand<T>(cmd: string, args_: unknown){
    let args = validateInput(cmd, args_, selectHistoryArgs);
    if(args){
        let value: RecordedCommandArgs[] | undefined = undefined;
        if(args.value){ value = <RecordedCommandArgs[]>args.value; }
        else{
            // find the range of commands we want to replay
            let state = await withState(async x => x);
            if(!state){ return; }
            let history = state.get<RecordedCommandArgs[]>(COMMAND_HISTORY, [])!;
            let from = -1;
            let to = -1;
            let toMatcher = args.range?.to || args.at;
            let fromMatcher = args.range?.from;
            for(let i=history.length-1;i>=0;i--){
                // NOTE: remember that `selectHistoryArgs` cannot leave both `range` and
                // `at` undefined, so at least one of `toMatcher` and `fromMatcher` are not
                // undefined
                if(to < 0 && toMatcher){
                    to = await evalMatcher(toMatcher, i);
                    if(args.at){ from = to; }
                }
                if(from < 0 && fromMatcher){ from = await evalMatcher(fromMatcher, i); }
                if(from > 0 && to > 0){
                    value = history.slice(from, to+1);
                    break;
                }
            }
        }
        return value;
    }
    return undefined;
}

function cleanupEdits(edits: vscode.TextDocumentChangeEvent[] | string){
    if(typeof edits === 'string'){
        return edits;
    }else{
        let result = "";
        for(let edit of edits){
            let strings = uniq(edit.contentChanges.map(x => x.text));
            if(strings.length === 1){
                result += strings[0];
            }
        }
        return result;
    }
}

const REPLAY_DELAY = 50;
// TODO: does `commands` require the `RunCommandsArgs` type?
async function runCommandHistory(commands: (RunCommandsArgs | RecordedCommandArgs)[]): Promise<CommandResult> {

    for(let cmd of commands){
        await doCommands(cmd);

        if((<any>cmd).edits){
            let editor = vscode.window.activeTextEditor;
            if(editor){
                let ed = editor;
                let recorded = <RecordedCommandArgs>cmd;
                let edits = cleanupEdits(recorded.edits);
                recorded.edits = edits;
                editor.edit(e => {
                    for(let sel of ed.selections){ e.insert(sel.anchor, edits); }
                });
            }else{
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
    let commands = await selectHistoryCommand('master-key.pushHistoryToStack', args);
    if(commands){
        let cs = commands;
        await withState(async state => {
            return state.update<List<RecordedCommandArgs[]>>(MACRO, { notSetValue: List() },
                macro => macro.push(cs));
        });
    }
    return;
};

async function replayFromHistory(args: unknown): Promise<CommandResult> {
    let commands = await selectHistoryCommand('master-key.replayFromHistory', args);
    if(commands){
        await runCommandHistory(commands);
    }
    return;
};

const replayFromStackArgs = z.object({
    index: z.number().min(0).optional().default(0),
    register: z.string().optional()
}).strict();

async function replayFromStack(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.replayFromStack', args_, replayFromStackArgs);
    if(args){
        let state = (await withState(async s => s));
        if(!state){ return; }
        let macros = state.get<List<RecordedCommandArgs[]>>(MACRO, List())!;
        let commands = macros.last();
        if(commands){
            await runCommandHistory(commands);
        }
    }
    return;
};

export const RECORD = 'record';
const recordArgs = z.object({
    on: z.boolean()
}).strict();

async function record(args_: unknown): Promise<CommandResult>{
    let args = validateInput('master-key.record', args_, recordArgs);
    if(args){
        let a = args;
        await withState(async state => {
            return state.set(RECORD, {public: true}, a.on);
        });
    }
    return;
}

const MACRO = 'macro';
export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.pushHistoryToStack',
        recordedCommand(pushHistoryToStack)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.replayFromHistory',
        recordedCommand(replayFromHistory)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.replayFromStack',
        recordedCommand(replayFromStack)));

     context.subscriptions.push(vscode.commands.registerCommand('master-key.record',
        recordedCommand(record)));

    vscode.workspace.onDidChangeTextDocument(async e => {
        await withState(async state => {
            // TODO: handle the empty history case
            let opts = { notSetValue: List<object>() }
            return state.update<List<object>>(COMMAND_HISTORY, opts, history => {
                let len = history.count();

                return history.update(len-1, lastCommand_ => {
                    let lastCommand = <RecordedCommandArgs>lastCommand_;
                    if (lastCommand && typeof lastCommand.edits !== 'string' &&
                        lastCommand.recordEdits) {
                        lastCommand.edits = lastCommand.edits.concat(e);
                    }
                    return lastCommand;
                });
            });
        });
    });
}
