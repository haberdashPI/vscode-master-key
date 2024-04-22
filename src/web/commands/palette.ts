import * as vscode from 'vscode';
import z from 'zod';
import { validateInput, prettifyPrefix } from '../utils';
import { CommandResult, CommandState, recordedCommand } from '../state';
import { withState } from '../state';
import { currentKeybindings } from '../keybindings';
import { PREFIX_CODE, prefixCodes } from './prefix';
import { MODE } from './mode';
import { IConfigKeyBinding, PrefixCodes } from '../keybindings/processing';
import { RunCommandsArgs, doCommandsCmd } from './do';
import { isSingleCommand } from '../keybindings/processing';
import { bind, uniqBy } from 'lodash';
import { QuickPickItem } from 'vscode-extension-tester';
import { DoArgs } from '../keybindings/parsing';

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
        if (mode === undefined && prefixCode === undefined){
            if(!binding.args.do.every(c => c.computedArgs === undefined)){
                return false;
            }
        }
        return true;
    };
}

export async function commandPalette(args_: unknown,
    opt: {context?: boolean, useKey?: boolean} = {}): Promise<CommandResult> {

    let context = opt.context === undefined ? true : opt.context;
    let useKey = opt.useKey || false;

    let state = await withState(async s => s);
    if(state){
        let bindings = currentKeybindings();
        let availableBindings: IConfigKeyBinding[];
        let codes: PrefixCodes | undefined = undefined;
        let prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        let mode = state.get<string>(MODE, 'insert')!;
        if(useKey){
            vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', true);
        }
        if(context){
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
            (b.args.name || "")+(b.args.kind || "")+(b.args.prefixCode));

        let picks = availableBindings.map(binding => {
            let key = binding.args.key;
            if(!context && codes){
                let seq = codes.nameFor(binding.args.prefixCode || 0);
                if(seq && seq.length > 0){
                    key = seq + " " + key;
                }
                if(binding.args.mode){
                    key = binding.args.mode.toLocaleLowerCase() + ": " + prettifyPrefix(key);
                }
            }

            return {
                label: key,
                description: (binding.args.name || "") + " — " + (binding.args.description || ""),
                args: binding.args,
            };
        });

        let picker = vscode.window.createQuickPick<{label: string, args: RunCommandsArgs}>();
        picker.items = picks;
        picker.matchOnDescription = true;
        picker.onDidAccept(async _ => {
            vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', false);
            let pick = picker.selectedItems[0];
            if(pick){
                await doCommandsCmd(pick.args);
            }
        });
        picker.show();
        // when this is a palette that shows up during key pressing, dispose of the palette
        // any time a normal key binding key is pressed (e.g. ones that add to the prefix or
        // execute a command)
        if(useKey){
            await withState(async state => {
                state = state.onSet(PREFIX_CODE, values => {
                    picker.dispose();
                    return false;
                });
                state = state.onResolve('keybindingPalette', values => {
                    picker.dispose();
                    return false;
                });
                return state;
            });
        }else{
            // TODO: do we need to await on the selection in this case?? (I don't think so...)
        }
    }
    return;
}

export function activate(context: vscode.ExtensionContext){
    vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', false);
    context.subscriptions.push(vscode.commands.registerCommand('master-key.contextualCommandPalette',
        recordedCommand(x => commandPalette(x, {context: true}))));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.commandPalette',
        recordedCommand(x => commandPalette(x, {context: false}))));
    // TODO: also show a full command palette that lets you search all commands
}
