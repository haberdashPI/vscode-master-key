import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { BindingCommand, DoArgs, doArgs } from '../keybindings/parsing';
import { withState, CommandResult, CommandState, WrappedCommandResult, commandArgs, recordedCommand } from '../state';
import { cloneDeep, merge } from 'lodash';
import { evalContext, reifyStrings } from '../expressions';
import { keySuffix } from './prefix';
import { isSingleCommand } from '../keybindings/processing';
import { MODE } from './mode';

async function doCommand(command: BindingCommand):
    Promise<[BindingCommand | undefined, CommandState]> {

    let reifiedCommand = cloneDeep(command);
    if (command.if !== undefined) {
        let doRun: unknown = undefined;
        if (typeof command.if === 'boolean') { doRun = command.if; }
        else {
            let cif = command.if;
            await withState(async state => {
                doRun = evalContext.evalStr(cif, state.values);
                return state;
            });
            // TODO: stopped here
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
            str => evalContext.evalStr(str, state.values));
        reifyArgs = merge(reifyArgs, computed);
        reifiedCommand.args = reifyArgs;
        reifiedCommand.computedArgs = undefined;
    }

    // sometime, based on user input, a command can change its final argument values we need
    // to capture this result and save it as part of the `reifiedCommand` (for example, see
    // `replaceChar` in `capture.ts`)
    let result = await vscode.commands.executeCommand<WrappedCommandResult | void>(command.command, reifyArgs, state);
    let args = commandArgs(result);
    if(args === "cancel"){ return [undefined, state]; }
    if(args){ reifiedCommand.args = args; }
    let newState = commandState(result);
    if(newState){ state = newState; }
    return [reifiedCommand, state];
}

const runCommandArgs = z.object({
    do: doArgs,
    key: z.string().optional(),
    resetTransient: z.boolean().optional().default(true),
    repeat: z.number().min(0).or(z.string()).optional(),
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

function resolveRepeat(state: CommandState, args: RunCommandsArgs): number {
    if(typeof args.repeat === 'string'){
        let repeatEval = evalContext.evalStr(args.repeat, state.values);
        let repeatNum = z.number().safeParse(repeatEval);
        if(repeatNum.success){
            return repeatNum.data;
        }else{
            vscode.window.showErrorMessage(`The expression '${args.repeat}' did not
                evaluate to a number`);
            return 0;
        }
    }else{
        return args.repeat || 0;
    }
}

// TODO: handle search usage functions
// they should become part of state listeners in `search` file
export async function doCommands(args: RunCommandsArgs): Promise<CommandResult>{

    // run the commands

    // trackSearchUsage();
    let reifiedCommands: BindingCommand[] | undefined = undefined;
    let repeat = 0;
    try{
        reifiedCommands = [];
        for(const cmd of args.do){
            let command;
            [command, state] = await doCommand(state, cmd);
            if(command){ reifiedCommands.push(command); }
        }
        repeat = resolveRepeat(state, args);
        if(repeat > 0){
            for(let i = 0; i < repeat; i++){
                for(const cmd of reifiedCommands){
                    [, state] = await doCommand(state, cmd);
                }
            }
        }
    }finally{
        if(args.resetTransient){
            // this will be immediately cleared by `reset` but
            // its display will persist in the status bar for a little bit
            // (see `status/keyseq.ts`)
            if(args.key){ keySuffix(state, args.key); }
            state.resolve();
            state.reset();
            // if(!wasSearchUsed() && vscode.window.activeTextEditor){
            //     clearSearchDecorations(vscode.window.activeTextEditor) ;
            // }
        }
    }
    evalContext.reportErrors();
    return [state, { ...args, do: reifiedCommands, repeat }];
}

export const COMMAND_HISTORY = 'commandHistory';

let maxHistory = 0;

async function doCommandsCmd(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.do', args_, runCommandArgs);
    if(args){
        let command;
        [state, command] = await doCommands(state, args);
        if(!isSingleCommand(args.do, 'master-key.prefix')){
            let history = state.get<RecordedCommandArgs[]>(COMMAND_HISTORY, [])!;
            let recordEdits = state.get<string>(MODE, 'insert') === 'insert';
            history.push({ ...command, edits: [], recordEdits });
            state.set(COMMAND_HISTORY, history, {});
        }
    }
    return [undefined, state];
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        maxHistory = (config.get<number>('maxCommandHistory') || 1024);
    }
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.do',
        recordedCommand(doCommandsCmd)));

    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);
}
