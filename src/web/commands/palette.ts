import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { CommandResult, CommandState, recordedCommand } from '../state';
import { withState } from '../state';
import { currentKeybindings } from '../keybindings';
import { PREFIX_CODE } from './prefix';
import { MODE } from './mode';
import { IConfigKeyBinding } from '../keybindings/processing';
import { doCommandsCmd } from './do';

function hasModeAndPrefix(mode: string, prefixCode: number){
    return function filterBinding(binding_: any){
        let binding = <IConfigKeyBinding>binding_;
        if(binding.args.mode && binding.args.mode !== mode){
            return false;
        }
        if(binding.args.prefixCode && binding.args.prefixCode !== prefixCode){
            return false;
        }
        return true;
    };
}

async function contextualCommandPalette(args_: unknown): Promise<CommandResult> {
    let state = await withState(async s => s);
    if(state){
        let prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        let mode = state.get<string>(MODE, 'insert')!;
        let bindings = currentKeybindings();
        let availableBindings = <IConfigKeyBinding[]>bindings.filter(hasModeAndPrefix(mode, prefixCode));
        availableBindings.sort();

        let picks = availableBindings.map(binding => ({
            label: binding.args.name || "",
            description: binding.args.description,
            args: binding.args,
        }));

        let pick = await vscode.window.showQuickPick(picks);
        if(pick){
            await doCommandsCmd(pick.args);
            return;
        }
    }
    return;
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.contextualCommandPalette',
        recordedCommand(contextualCommandPalette)));
    // TODO: also show a full command palette that lets you search all commands
}
