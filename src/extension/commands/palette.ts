import * as vscode from 'vscode';
import { prettifyPrefix } from '../utils';
import { withState } from '../state';
import { filterBindingFn } from '../keybindings';
import { bindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import { MODE, defaultMode } from './mode';
import { IConfigKeyBinding } from '../keybindings/parsing';
import {
    normalizeLayoutIndependentBindings,
    normalizeLayoutIndependentString,
} from '../keybindings/layout';
import { COMMAND_HISTORY, RunCommandsArgs, doCommandsCmd } from './do';
import { reverse, uniqBy, sortBy } from 'lodash';
import replaceAll from 'string.prototype.replaceall';

let paletteBindingMode = false;
let currentPicker: vscode.QuickPick<{ label: string; args: RunCommandsArgs }> | undefined =
    undefined;
function setPickerText() {
    if (currentPicker) {
        if (paletteBindingMode) {
            currentPicker.placeholder = 'Run a command by pressing its keybinding.';
        } else {
            currentPicker.placeholder = 'Search the commands by their description.';
        }
        let mode;
        if (paletteBindingMode) {
            mode = 'Keybinding mode';
        } else {
            mode = 'Search mode';
        }
        const context = 'Context Specific ';
        currentPicker.title = `Master Key ${context}Palette: ${mode} (^. changes mode)`;
    }
}

function togglePaletteMode() {
    paletteBindingMode = !paletteBindingMode;
    vscode.commands.executeCommand(
        'setContext',
        'master-key.keybindingPaletteBindingMode',
        paletteBindingMode,
    );
    setPickerText();
}

const LAYOUT_MARKER = ' (U.S. layout)';

export async function commandPalette(_args: unknown, opt: { useKey?: boolean } = {}) {
    const useKey = opt.useKey || false;

    const state = await withState(async s => s);
    if (state) {
        let availableBindings: IConfigKeyBinding[];
        const prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        const mode = state.get<string>(MODE, defaultMode)!;
        paletteBindingMode = useKey;
        vscode.commands.executeCommand(
            'setContext',
            'master-key.keybindingPaletteBindingMode',
            paletteBindingMode,
        );
        availableBindings = <IConfigKeyBinding[]>(
            (bindings?.bind || []).filter(filterBindingFn(mode, prefixCode))
        );
        availableBindings = normalizeLayoutIndependentBindings(availableBindings);
        availableBindings = reverse(
            uniqBy(reverse(availableBindings), b => (b.args.key || '') + b.args.prefixCode),
        );

        let picks = availableBindings.map((binding) => {
            let key = binding.args.key;
            key = prettifyPrefix(key);

            return {
                label: key,
                description: binding.args.name + (/\[.+\]/.test(key) ? LAYOUT_MARKER : ''),
                detail: replaceAll(binding.args.description || '', /\n/g, ' '),
                args: binding.args,
            };
        });

        picks = sortBy(picks, x => -x.args.priority);
        const filteredPicks: typeof picks = [];

        if (picks.length === 0) {
            vscode.window.showErrorMessage(
                `Palette cannot be shown for mode '${mode}', there are no bindings.`,
            );
            return;
        }

        let lastPick = picks[0];
        filteredPicks.push(lastPick);
        for (const pick of picks.slice(1)) {
            if (
                lastPick.args.combinedName &&
                lastPick.args.combinedName === pick.args.combinedName
            ) {
                const combinedKey = normalizeLayoutIndependentString(
                    lastPick.args.combinedKey,
                );
                lastPick.label = prettifyPrefix(combinedKey);
                lastPick.description =
                    lastPick.args.combinedName +
                    (/\[.+\]/.test(combinedKey) ? LAYOUT_MARKER : '');
                lastPick.detail = lastPick.args.combinedDescription || '';
            } else {
                filteredPicks.push(pick);
                lastPick = pick;
            }
        }

        const picker = vscode.window.createQuickPick<{
            label: string;
            args: RunCommandsArgs;
        }>();
        currentPicker = picker;
        let accepted = false;
        setPickerText();
        picker.items = filteredPicks;
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;
        picker.onDidAccept(async (_) => {
            const pick = picker.selectedItems[0];
            if (pick) {
                accepted = true;
                picker.dispose();
                await doCommandsCmd(pick.args);
            } else {
                picker.dispose();
            }
        });
        picker.onDidHide(() => {
            vscode.commands.executeCommand(
                'setContext',
                'master-key.keybindingPaletteBindingMode',
                false,
            );
            vscode.commands.executeCommand(
                'setContext',
                'master-key.keybindingPaletteOpen',
                false,
            );
            if (!accepted) {
                return withState(async s => s.reset().resolve());
            }
            return Promise.resolve();
        });
        vscode.commands.executeCommand(
            'setContext',
            'master-key.keybindingPaletteOpen',
            true,
        );
        picker.show();
        // when this palette accepts keybinding presses (rather than searching
        // bindings), dispose of the palette any time a normal key binding key is pressed
        // the effect of a normal key is either 1.) to add update the current prefix
        // 2.) complete a command, thereby updating the command history
        // 3.) enter capture mode
        let commandsFinished = 0;
        await withState(async (state) => {
            if (paletteBindingMode) {
                state = state.onSet(PREFIX_CODE, (_) => {
                    accepted = true;
                    picker.dispose();
                    return false;
                });
                state = state.onSet(COMMAND_HISTORY, (_) => {
                    commandsFinished += 1;
                    if (commandsFinished > 1) {
                        accepted = true;
                        picker.dispose();
                        return false;
                    }
                    return true;
                });
                state = state.onSet(MODE, (_) => {
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

export function activate(context: vscode.ExtensionContext) {
    vscode.commands.executeCommand('setContext', 'master-key.keybindingPaletteOpen', false);
    vscode.commands.executeCommand(
        'setContext',
        'master-key.keybindingPaletteBindingMode',
        false,
    );
    /**
     * @userCommand togglePaletteMode
     * @name Toggle palette input mode
     *
     * Toggle between accepting command keybindings and searching for commands in the
     * `Key Suggestions...` palette.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.togglePaletteMode', togglePaletteMode),
    );
    /**
     * @userCommand commandSuggestions
     * @name Key Suggestions...
     *
     * Display a list of possible key presses that follow after the current prefix of
     * keys that have been pressed so far.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.commandSuggestions', x =>
            commandPalette(x, { useKey: true }),
        ),
    );
}
