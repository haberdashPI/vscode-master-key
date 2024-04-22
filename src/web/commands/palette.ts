import * as vscode from 'vscode';
import z from 'zod';
import { validateInput, prettifyPrefix } from '../utils';
import { CommandResult, CommandState, recordedCommand } from '../state';
import { withState } from '../state';
import { currentKeybindings } from '../keybindings';
import { PREFIX_CODE, prefixCodes } from './prefix';
import { MODE } from './mode';
import { IConfigKeyBinding, PrefixCodes } from '../keybindings/processing';
import { doCommandsCmd } from './do';
import { isSingleCommand } from '../keybindings/processing';
import { bind, uniqBy } from 'lodash';

function filterBindingFn(mode?: string, prefixCode?: number) {
    return function filterBinding(binding_: any) {
        let binding = <IConfigKeyBinding>binding_;
        if (isSingleCommand(binding.args.do, 'master-key.ignore')) {
            return false;
        }
        if (mode !== undefined && binding.args.mode !== undefined && binding.args.mode !== mode) {
            return false;
        }
        if (prefixCode !== undefined && binding.args.prefixCode !== undefined &&
            binding.args.prefixCode !== prefixCode) {
            return false;
        }
        return true;
    };
}

async function commandPalette(args_: unknown,
    opt: {context: boolean, useKey: boolean} = {context: true, useKey: false}): Promise<CommandResult> {

    let state = await withState(async s => s);
    if(state){
        let bindings = currentKeybindings();
        let availableBindings: IConfigKeyBinding[];
        let codes: PrefixCodes | undefined = undefined;
        let prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        let mode = state.get<string>(MODE, 'insert')!;
        if(opt.context){
            availableBindings = <IConfigKeyBinding[]>bindings.filter(filterBindingFn(mode, prefixCode));
        }else{
            await withState(async state => {
                [state, codes] = prefixCodes(state);
                return state;
            });
            // TODO: filter to commands that are actually usable in the command palette
            // (atlernatively, commands can set their own state somehow)
            availableBindings = <IConfigKeyBinding[]>bindings.filter(filterBindingFn());
        }
        availableBindings = uniqBy(availableBindings, b =>
            (b.args.name || "")+(b.args.mode || "")+(b.args.kind || "")+(b.args.prefixCode));



        let picks = availableBindings.map(binding => {
            let key = binding.args.key;
            if(!opt.context && codes){
                let seq: string | undefined;
                if(seq && seq.length > 0){
                    key = seq + " " + key;
                }
            }

            return {
                label: prettifyPrefix(key),
                description: (binding.args.name || "") + " — " + (binding.args.description || ""),
                args: binding.args,
            };
        });

        let pick = await vscode.window.showQuickPick(picks, {matchOnDescription: true});
        if(pick){
            await doCommandsCmd(pick.args);
            return;
        }
    }
    return;
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.contextualCommandPalette',
        recordedCommand(x => commandPalette(x, {context: true}))));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.commandPalette',
        recordedCommand(x => commandPalette(x, {context: false}))));
    // TODO: also show a full command palette that lets you search all commands
}
