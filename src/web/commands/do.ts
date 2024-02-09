import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { BindingCommand, doArgs } from '../keybindingParsing';
import { CommandState, wrapStateful } from '../state';
import { cloneDeep, merge } from 'lodash';
import { evalContext, reifyStrings } from '../expressions';
import { keySuffix } from './keySequence';
import { isSingleCommand } from '../keybindingProcessing';

async function doCommand(state: CommandState, command: BindingCommand):
    Promise<[BindingCommand, CommandState]> {

    let reifiedCommand = cloneDeep(command);
    if (command.if !== undefined) {
        let doRun: unknown = undefined;
        if (typeof command.if === 'boolean') { doRun = command.if; }
        else {
            doRun = evalContext.evalStr(command.if, state.evalContext());
        }
        reifiedCommand.if = !!doRun;
        if (!doRun) {
            reifiedCommand.computedArgs = undefined;
            return [reifiedCommand, state]; // if the if check fails, don't run the command
        }
    }

    let reifyArgs: Record<string, any> = command.args || {};
    if (command.computedArgs !== undefined) {
        let computed = reifyStrings(command.computedArgs,
            str => evalContext.evalStr(str, state.evalContext()));
        reifyArgs = merge(reifyArgs, computed);
        reifiedCommand.args = reifyArgs;
        reifiedCommand.computedArgs = undefined;
    }

    let possibleState = await vscode.commands.executeCommand<void | CommandState>(
        command.command, reifyArgs);
    state = possibleState instanceof CommandState ? possibleState : state;
    return [reifiedCommand, state];
}

const runCommandArgs = z.object({
    do: doArgs,
    key: z.string().optional(),
    resetTransient: z.boolean().optional().default(true),
    repeat: z.number().min(0).optional(),
    kind: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
}).strict();
export type RunCommandsArgs = z.input<typeof runCommandArgs>;

export type RecordedCommandArgs = RunCommandsArgs & {
    recordEdits: boolean,
    edits: vscode.TextDocumentChangeEvent[] | string
};

// TODO: handle search usage functions
// they should become part of state listeners in `search` file
export async function doCommands(state: CommandState, args: RunCommandsArgs):
    Promise<[CommandState, RunCommandsArgs]>{

    // run the commands

    // trackSearchUsage();
    let reifiedCommands: BindingCommand[] | undefined = undefined;
    try{
        reifiedCommands = [];
        for(const cmd of args.do){
            let command;
            [command, state] = await doCommand(state, cmd);
            reifiedCommands.push(command);
        }
        let repeat = args.repeat || 0;
        if(repeat > 0){
            for(let i = 0; i < repeat; i++){
                for(const cmd of args.do){
                    [, state] = await doCommand(state, cmd);
                }
            }
        }
    }finally{
        if(args.resetTransient){
            // this will be immediately cleared by `reset` but
            // its display will persist in the status bar for a little bit
            // (see `updateStatusBar`)
            if(args.key){ keySuffix(state, args.key); }
            // TODO: maybe here we specify a delayed updae of the status???
            state.reset();
            // if(!wasSearchUsed() && vscode.window.activeTextEditor){
            //     clearSearchDecorations(vscode.window.activeTextEditor) ;
            // }
        }
    }
    evalContext.reportErrors();
    return [state, { ...args, do: reifiedCommands }];
}

export const COMMAND_HISTORY = 'commandHistory';
const MODE = 'mode';

let maxHistory = 0;

async function doCommandsCmd(state: CommandState, args_: unknown){
    let args = validateInput('master-key.do', args_, runCommandArgs);
    if(args){
        let command;
        [state, command] = await doCommands(state, args);
        if(!isSingleCommand(args.do, 'master-key.prefix')){
            let history = state.get<RecordedCommandArgs[]>(COMMAND_HISTORY, [])!;
            let recordEdits = state.get<string>(MODE, 'insert') === 'insert';
            history.push({ ...command, edits: [], recordEdits });
            state.set(COMMAND_HISTORY, history);
        }
    }
    return state;
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        maxHistory = (config.get<number>('maxCommandHistory') || 1024);
    }
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.do',
        wrapStateful(doCommandsCmd)));
}
