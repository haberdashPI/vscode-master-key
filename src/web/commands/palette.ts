import * as vscode from 'vscode';
import { prettifyPrefix } from '../utils';
import { withState } from '../state';
import { currentKeybindings, filterBindingFn } from '../keybindings';
import { PREFIX_CODE, prefixCodes } from './prefix';
import { MODE } from './mode';
import { IConfigKeyBinding, PrefixCodes } from '../keybindings/processing';
import { RunCommandsArgs, doCommandsCmd } from './do';
import { uniqBy } from 'lodash';

let paletteBindingMode = false;
let paletteBindingContext = false;
let currentPicker: vscode.QuickPick<{label: string, args: RunCommandsArgs}> | undefined = undefined;
function setPickerText(){
    if(currentPicker){
        if(paletteBindingMode){
            currentPicker.placeholder = `Run a command by pressing its keybinding.`;
        }else{
            currentPicker.placeholder = `Search the command by their description.`;
        }
        let mode;
        if(paletteBindingMode){
            mode = "Press a Binding";
        }else{
            mode = "Search";
        }
        let context = "";
        if(paletteBindingContext){
            context = "Context Specific ";
        }
        currentPicker.title = `Master Key ${context}Palette: ${mode} (use ^. to change mode)`;
    }
}

function togglePaletteMode(){
    paletteBindingMode = !paletteBindingMode;
    vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteBindingMode', paletteBindingMode);
    setPickerText();
}

export async function commandPalette(args_: unknown,
    opt: {context?: boolean, useKey?: boolean} = {}) {

    let context = opt.context === undefined ? true : opt.context;
    let useKey = opt.useKey || false;

    let state = await withState(async s => s);
    if(state){
        let bindings = currentKeybindings();
        let availableBindings: IConfigKeyBinding[];
        let codes: PrefixCodes | undefined = undefined;
        let prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        let mode = state.get<string>(MODE, 'insert')!;
        vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', true);
        paletteBindingMode = useKey;
        vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteBindingMode', paletteBindingMode);
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
                key = prettifyPrefix(key);
                if(binding.args.mode){
                    key = binding.args.mode.toLocaleLowerCase() + ": " + key;
                }
            }else{
                key = prettifyPrefix(key);
            }

            return {
                label: key,
                description: (binding.args.name || "") + " — " + (binding.args.description || ""),
                args: binding.args,
            };
        });

        let picker = vscode.window.createQuickPick<{label: string, args: RunCommandsArgs}>();
        currentPicker = picker;
        let accepted = false;
        paletteBindingContext = context;
        setPickerText();
        picker.items = picks;
        picker.matchOnDescription = true;
        picker.onDidAccept(async _ => {
            let pick = picker.selectedItems[0];
            if(pick){
                accepted = true;
                picker.dispose();
                await doCommandsCmd(pick.args);
            }else{
                picker.dispose();
            }
        });
        picker.onDidHide(async _ => {
            vscode.commands.executeCommand('setContext', 'master-key.keybindingBindingMode', false);
            if(!accepted){
                await withState(async s => s.reset().resolve());
            }
        });
        picker.show();
        // when this the palette accepts keybinding presses (rather than searchbing
        // bindings), dispose of the palette any time a normal key binding key is pressed
        // (e.g. ones that add to the prefix or execute a command)
        await withState(async state => {
            if(paletteBindingMode){
                state = state.onSet(PREFIX_CODE, _ => {
                    accepted = true;
                    picker.dispose();
                    return false;
                });
                state = state.onResolve('keybindingPalette', _ => {
                    accepted = true;
                    picker.dispose();
                    return false;
                });
            }
            return state;
        });
    }
    return;
}

export function activate(context: vscode.ExtensionContext){
    vscode.commands.executeCommand('setContext', 'master-key.keybindingBindingMode', false);
    vscode.commands.executeCommand('setContext', 'master-key.keybindingOpen', false);
    context.subscriptions.push(vscode.commands.registerCommand('master-key.togglePaletteMode',
        togglePaletteMode));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.commandPalette',
        x => commandPalette(x, {context: false})));
    // TODO: also show a full command palette that lets you search all commands
}
