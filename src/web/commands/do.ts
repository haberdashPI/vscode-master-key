import * as vscode from 'vscode';
import z, { record } from 'zod';
import { validateInput } from '../utils';
import { BindingCommand, DoArgs, doArgs } from '../keybindings/parsing';
import { withState, CommandResult, CommandState, WrappedCommandResult, commandArgs, recordedCommand } from '../state';
import { cloneDeep, merge } from 'lodash';
import { evalContext, reifyStrings } from '../expressions';
import { PREFIX_CODE, keySuffix } from './prefix';
import { isSingleCommand } from '../keybindings/processing';
import { MODE, defaultMode, modeSpecs } from './mode';
import { List } from 'immutable';
import { commandPalette } from './palette';

async function doCommand(command: BindingCommand):
    Promise<BindingCommand | undefined> {

    let reifiedCommand = cloneDeep(command);
    console.log('[DEBUG]: reifiedCommand.command - '+reifiedCommand.command);
    if (command.if !== undefined) {
        let doRun: unknown = undefined;
        if (typeof command.if === 'boolean') { doRun = command.if; }
        else {
            let cif = command.if;
            await withState(async state => {
                // TODO: ideally we would move string compilation outside
                // of this function, and only have evaluation of the compiled result
                // inside this call to `withState`
                doRun = evalContext.evalStr(cif, state.values);
                return state;
            });
        }
        reifiedCommand.if = !!doRun;
        if (!doRun) {
            reifiedCommand.computedArgs = undefined;
            return reifiedCommand; // if the if check fails, don't run the command
        }
    }

    let reifyArgs: Record<string, any> = command.args || {};
    if (command.computedArgs !== undefined) {
        let computed;
        await withState(async state => {
            computed = reifyStrings(command.computedArgs,
                str => evalContext.evalStr(str, state.values));
            return state;
        });
        reifyArgs = merge(reifyArgs, computed);
        reifiedCommand.args = reifyArgs;
        reifiedCommand.computedArgs = undefined;
    }

    // sometime, based on user input, a command can change its final argument values we need
    // to capture this result and save it as part of the `reifiedCommand` (for example, see
    // `replaceChar` in `capture.ts`)
    console.log("[DEBUG]: run command "+command.command);
    console.dir(reifyArgs);

    let result = await vscode.commands.executeCommand<WrappedCommandResult | void>(command.command, reifyArgs);
    let args = commandArgs(result);
    if(args === "cancel"){ return undefined; }
    if(args){ reifiedCommand.args = args; }
    return reifiedCommand;
}

const runCommandArgs = z.object({
    do: doArgs,
    key: z.string().optional(),
    resetTransient: z.boolean().optional().default(true),
    repeat: z.number().min(0).or(z.string()).optional(),
    hideInPalette: z.boolean().default(false).optional(),
    priority: z.number().optional(),
    combinedKey: z.string().optional(),
    combinedName: z.string().optional(),
    combinedDescription: z.string().optional(),
    kind: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    prefixCode: z.number().optional(),
    mode: z.string().optional()
}).strict();
export type RunCommandsArgs = z.input<typeof runCommandArgs>;

export type RecordedCommandArgs = RunCommandsArgs & {
    recordEdits: vscode.TextDocument | undefined, // if editing is being recorded, the text document where those edits are happening
    edits: vscode.TextDocumentChangeEvent[] | string
};

async function resolveRepeat(args: RunCommandsArgs): Promise<number> {
    if(typeof args.repeat === 'string'){
        let repeatEval;
        let repeatStr = args.repeat;
        await withState(async state => {
            repeatEval = evalContext.evalStr(repeatStr, state.values);
            return state;
        });
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

const PALETTE_DELAY_DEFAULT = process.env.TESTING ? 0 : 500;
let paletteDelay: number = PALETTE_DELAY_DEFAULT;
let paletteUpdate = Number.MIN_SAFE_INTEGER;

function registerPaletteUpdate(){
    if(paletteUpdate < Number.MAX_SAFE_INTEGER){
        paletteUpdate += 1;
    }else{
        paletteUpdate = Number.MIN_SAFE_INTEGER;
    }
}

export async function doCommands(args: RunCommandsArgs): Promise<CommandResult>{
    registerPaletteUpdate();

    // run the commands
    let reifiedCommands: BindingCommand[] | undefined = undefined;
    let repeat = 0;
    try{
        // `doCommand` can call a command that calls `doCommandsCmd` and will therefore
        // clear transient values; thus we have to compute the value of `repeat` *before*
        // running `doCommand` or the value of any transient variables (e.g. `count`) will
        // be cleared
        console.log('[DEBUG]: resolveRepeat');
        repeat = await resolveRepeat(args);

        reifiedCommands = [];
        for(const cmd of args.do){
            console.log('[DEBUG]: doCommand');
            let command = await doCommand(cmd);
            if(command){ reifiedCommands.push(command); }
        }
        if(repeat > 0){
            for(let i = 0; i < repeat; i++){
                for(const cmd of reifiedCommands){
                    await doCommand(cmd);
                }
            }
        }
        if(!args.resetTransient && paletteDelay > 0){
            let currentPaletteUpdate = paletteUpdate;
            setTimeout(async () => {
                if(currentPaletteUpdate === paletteUpdate){
                    registerPaletteUpdate();
                    commandPalette(undefined, {context: true, useKey: true});
                }
            }, paletteDelay);
        }
    }finally{
        if(args.resetTransient){
            // this will be immediately cleared by `reset` but
            // its display will persist in the status bar for a little bit
            // (see `status/keyseq.ts`)
            if(args.key){ await keySuffix(args.key); }
            await withState(async state => { return state.reset().resolve(); });
        }else{
            await withState(async state => state.resolve());
        }
    }
    evalContext.reportErrors();
    return { ...args, do: reifiedCommands, repeat };
}

export const COMMAND_HISTORY = 'commandHistory';

let maxHistory = 0;

export async function doCommandsCmd(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.do', args_, runCommandArgs);
    if(args){
        let command: any;
        command = await doCommands(args);
        if(!isSingleCommand(args.do, 'master-key.prefix')){
            await withState(async state => {
                return state.update<List<unknown>>(COMMAND_HISTORY,
                    { notSetValue: List() },
                    history => {
                        let recordEdits = undefined;
                        if((modeSpecs[state.get(MODE, defaultMode) || ""] || {})?.recordEdits){
                            recordEdits = vscode.window.activeTextEditor?.document;
                        }
                        history = history.push({ ...command, edits: [], recordEdits });
                        if(history.count() > maxHistory){
                            history = history.shift();
                        }
                        return history;
                    }
                );
            });
        }
    }
    // TODO: think about whether it is cool to nest `do` commands
    return args;
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if((!event && !process.env.TESTING) || event?.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        maxHistory = (config.get<number>('maxCommandHistory') || 1024);
        paletteDelay = config.get<number>('suggestionDelay') || PALETTE_DELAY_DEFAULT;
    }
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.do',
        recordedCommand(doCommandsCmd)));

    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);
}
