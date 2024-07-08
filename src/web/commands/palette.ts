import * as vscode from 'vscode';
import { prettifyPrefix } from '../utils';
import { withState } from '../state';
import { filterBindingFn } from '../keybindings';
import { bindings } from '../keybindings/config';
import { PREFIX_CODE, prefixCodes } from './prefix';
import { MODE, defaultMode, modeSpecs } from './mode';
import { IConfigKeyBinding, PrefixCodes } from '../keybindings/processing';
import { COMMAND_HISTORY, RecordedCommandArgs, RunCommandsArgs, doCommandsCmd } from './do';
import { reverse, uniqBy, sortBy } from 'lodash';
import { List } from 'immutable';
import replaceAll from 'string.prototype.replaceall';
import { TypeOf } from 'zod';

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
            mode = "Keybinding mode";
        }else{
            mode = "Search mode";
        }
        let context = "";
        if(paletteBindingContext){
            context = "Context Specific ";
        }
        currentPicker.title = `Master Key ${context}Palette: ${mode} (^. changes mode)`;
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
        let availableBindings: IConfigKeyBinding[];
        let codes: PrefixCodes | undefined = undefined;
        let prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        let mode = state.get<string>(MODE, defaultMode)!;
        paletteBindingMode = useKey;
        vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteBindingMode', paletteBindingMode);
        if(context){
            availableBindings = <IConfigKeyBinding[]>(bindings?.bind || []).filter(filterBindingFn(mode, prefixCode));
        }else{
            await withState(async state => {
                [state, codes] = prefixCodes(state);
                return state;
            });
            // TODO: filter to commands that are actually usable in the command palette
            // (atlernatively, commands can set their own state somehow)
            availableBindings = <IConfigKeyBinding[]>(bindings?.bind || []).filter(filterBindingFn());
        }
        availableBindings = reverse(uniqBy(reverse(availableBindings), b =>
            (b.args.key || "")+(b.args.prefixCode)));

        let picks = availableBindings.map(binding => {
            let key = binding.args.key;
            if(!context && codes){
                let seq = codes.nameFor(binding.args.prefixCode || 0);
                if(seq && seq.length > 0){
                    key = seq + " " + key;
                }
                key = prettifyPrefix(key);
            }else{
                key = prettifyPrefix(key);
            }

            return {
                label: key,
                description: binding.args.name,
                detail: replaceAll(binding.args.description || "", /\n/g, ' '),
                args: binding.args,
            };
        });

        picks = sortBy(picks, x => -x.args.priority);
        let filteredPicks: typeof picks = [];

        if(picks.length === 0){
            vscode.window.showErrorMessage(`Palette cannot be shown for mode '${mode}', there are no bindings.`);
            return;
        }

        let lastPick = picks[0];
        filteredPicks.push(lastPick);
        for(let pick of picks.slice(1)){
            if(lastPick.args.combinedName && lastPick.args.combinedName === pick.args.combinedName){
                lastPick.label = prettifyPrefix(lastPick.args.combinedKey);
                lastPick.description = lastPick.args.combinedName;
                lastPick.detail = lastPick.args.combinedDescription || "";
            }else{
                filteredPicks.push(pick);
                lastPick = pick;
            }
        }

        let picker = vscode.window.createQuickPick<{label: string, args: RunCommandsArgs}>();
        currentPicker = picker;
        let accepted = false;
        paletteBindingContext = context;
        setPickerText();
        picker.items = filteredPicks;
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;
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
        picker.onDidHide(() => {
            vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteBindingMode', false);
            vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', false);
            if(!accepted){
                return withState(async s => s.reset().resolve());
            }
            return Promise.resolve();
        });
        vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', true);
        picker.show();
        // when this palette accepts keybinding presses (rather than searching
        // bindings), dispose of the palette any time a normal key binding key is pressed
        // the effect of a normal key is either 1.) to add update the current prefix
        // 2.) complete a command, thereby updating the command history
        // 3.) enter capture mode
        let commandsFinished = 0;
        await withState(async state => {
            if(paletteBindingMode){
                state = state.onSet(PREFIX_CODE, _ => {
                    accepted = true;
                    picker.dispose();
                    return false;
                });
                state = state.onSet(COMMAND_HISTORY, _ => {
                    commandsFinished += 1;
                    if(commandsFinished > 1){
                        accepted = true;
                        picker.dispose();
                        return false;
                    }
                    return true;
                });
                state = state.onSet(MODE, _ => {
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
    vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', false);
    vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteBindingMode', false);
    context.subscriptions.push(vscode.commands.registerCommand('master-key.togglePaletteMode',
        togglePaletteMode));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.commandPalette',
        x => commandPalette(x, {context: false})));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.commandSuggestions',
        x => commandPalette(x, {context: true, useKey: true})));
}
