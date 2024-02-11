import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { EvalContext } from '../expressions';
import { onResolve, CommandResult, CommandState, wrapStateful } from '../state';
import { doCommands, RecordedCommandArgs, RunCommandsArgs, COMMAND_HISTORY } from './do';
import { uniq } from 'lodash';

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

async function evalMatcher(state: CommandState, matcher: string, i: number) {
    let result_ = await evalContext.evalStr(matcher, state.evalContext({i}));
    if(typeof result_ !== 'number'){
        if(result_){ return i; }
        else{ return -1; }
    }else{
        return result_;
    }
}

async function selectHistoryCommand<T>(state: CommandState, cmd: string, args_: unknown){
    let args = validateInput(cmd, args_, selectHistoryArgs);
    if(args){
        let value: RecordedCommandArgs[] | undefined = undefined;
        if(args.value){ value = <RecordedCommandArgs[]>args.value; }
        else{
            // find the range of commands we want to replay
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
                    to = await evalMatcher(state, toMatcher, i);
                    if(args.at){ from = to; }
                }
                if(from < 0 && fromMatcher){ from = await evalMatcher(state, fromMatcher, i); }
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
async function runCommandHistory(state: CommandState,
    commands: (RunCommandsArgs | RecordedCommandArgs)[]): Promise<CommandResult> {

    for(let cmd of commands){
        [state, ] = await doCommands(state, cmd);

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
    return [undefined, state];
}

async function pushHistoryToStack(state: CommandState, args: unknown): Promise<CommandResult> {
    let commands = await selectHistoryCommand(state, 'master-key.pushHistoryToStack', args);
    if(commands){
        let macro = state.get<RecordedCommandArgs[][]>(MACRO, [])!;
        macro.push(commands);
        state.set(MACRO, macro);
    }
    return [undefined, state];
};

async function replayFromHistory(state: CommandState, args: unknown): Promise<CommandResult> {
    let commands = await selectHistoryCommand(state, 'master-key.replayFromHistory', args);
    if(commands){
        [, state] = await runCommandHistory(state, commands);
    }
    return [undefined, state];
};

const replayFromStackArgs = z.object({
    index: z.number().min(0).optional().default(0),
    register: z.string().optional()
}).strict();

async function replayFromStack(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.replayFromStack', args_, replayFromStackArgs);
    if(args){
        let macros = state.get<RecordedCommandArgs[][]>(MACRO, [])!;
        let commands = macros[macros.length-args.index-1];
        if(commands){
            [, state] = await runCommandHistory(state, commands);
        }
    }
    return [undefined, state];
};

export const RECORD = 'record';
const recordArgs = z.object({
    on: z.boolean()
}).strict();

async function record(state: CommandState, args_: unknown): Promise<CommandResult>{
    let args = validateInput('master-key.record', args_, recordArgs);
    if(args){
        state.set(RECORD, args.on);
    }
    return [undefined, state];
}

const MACRO = 'macro';
let commandHistory: RecordedCommandArgs[] = [];
export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.pushHistoryToStack',
        wrapStateful(pushHistoryToStack)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.replayFromHistory',
        wrapStateful(replayFromHistory)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.replayFromStack',
        wrapStateful(replayFromStack)));

     context.subscriptions.push(vscode.commands.registerCommand('master-key.record',
        wrapStateful(record)));

    // TODO: this still feels kind of hacky, maybe think about
    // how state is handled in events more carefully
    onResolve('commandHistory', async (state: CommandState) => {
        commandHistory = state.get<RecordedCommandArgs[]>(COMMAND_HISTORY, [])!;
        return true;
    });

    vscode.workspace.onDidChangeTextDocument(e => {
        let lastCommand = commandHistory[commandHistory.length-1];
        if(lastCommand && typeof lastCommand.edits !== 'string' && lastCommand.recordEdits){
            lastCommand.edits = lastCommand.edits.concat(e);
        }
    });
}
