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
    opt: {context: boolean} = {context: true}): Promise<CommandResult> {

    let state = await withState(async s => s);
    if(state){
        let bindings = currentKeybindings();
        let availableBindings: IConfigKeyBinding[];
        let codes: PrefixCodes | undefined = undefined;
        if(opt.context){
            let mode = state.get<string>(MODE, 'insert')!;
            let prefixCode = state.get<number>(PREFIX_CODE, 0)!;
            availableBindings = <IConfigKeyBinding[]>bindings.filter(filterBindingFn(mode, prefixCode));
        }else{
            await withState(async state => {
                [state, codes] = prefixCodes(state);
                return state;
            });
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
            // TODO: we want to be able to setup state (e.g. set the prefix properly) before
            // running the command so that running it does the right thing COMPLICATION: we
            // allow `flag` options for prefixes, so this is sort of non-trivial; the
            // obvious solution of removing this flag and requiring a check on the prefix
            // has non-trivial performance implications (we could also remove the flag and
            // require the command to be duplicated with a different option) OR we could
            // have a `hasPrefix` function that can translate to a proper prefixCode check
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
