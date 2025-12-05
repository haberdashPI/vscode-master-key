// TODO: reimplement
/* eslint-disable */

import * as vscode from 'vscode';
import { getRequiredMode, getRequiredPrefixCode, prettifyPrefix } from '../utils';
import { withState } from '../state';
import { bindings, onChangeBindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import { MODE } from './mode';
import {
    normalizeLayoutIndependentBindings,
    normalizeLayoutIndependentString,
} from '../keybindings/layout';
import { reverse, uniqBy, sortBy } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { KeyFileResult } from '../../rust/parsing/lib/parsing';
import { doCommandsCmd, onCommandComplete } from './do';

let paletteBindingMode = false;
let currentPicker: vscode.QuickPick<{ label: string; command_id?: number }> | undefined =
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
            mode = 'Binding mode';
        } else {
            mode = 'Search mode';
        }
        currentPicker.title = `Master Key Commands (${mode} ;^. changes mode)`;
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

interface IPaletteBinding {
    name?: string;
    description?: string;
    key?: string;
    combinedDescription?: string,
    combinedKey?: string,
    order: number;
    command_id?: number;
    prefix_id?: number;
}

let paletteEntries: Record<string, IPaletteBinding[]> = {};

function updateKeys(bindings: KeyFileResult) {
    let bindingMap: Record<string, Record<string, IPaletteBinding>> = {};
    for (let i = 0 ; i < bindings.n_bindings(); i++) {
        const binding = bindings.binding(i);
        if (binding.command === 'master-key.ignore') {
            continue;
        }
        let docs = bindings.docs(i);
        if (docs?.hideInPalette) {
            continue;
        }
        let paletteEntry = {
            key: docs?.combined?.key || binding.key,
            name: docs?.combined?.name || binding.args.name,
            description: docs?.combined?.description || binding.args.description,
            combinedKey: docs?.combined?.key,
            combinedDescription: docs?.combined?.description,
            order: binding.command === 'master-key.do' ? i : bindings.n_bindings() + 1,
        }
        let key = prettifyPrefix(paletteEntry.key);
        key = normalizeLayoutIndependentString(key, { noBrackets: true });
        let combinedKey = prettifyPrefix(paletteEntry.combinedKey || '');
        combinedKey = normalizeLayoutIndependentString(combinedKey, { noBrackets: true });


        const prefixCode = getRequiredPrefixCode(binding.when);
        const mode = getRequiredMode(binding.when);
        const context = `${prefixCode}:${mode}`;
        const mapping = bindingMap[context] || {};
        const name = paletteEntry.name;
        const oldEntry = mapping[name] || {};
        mapping[name] = {
            key: key || oldEntry.key,
            name,
            description: paletteEntry.description || oldEntry.description,
            combinedKey: combinedKey || oldEntry.combinedKey,
            combinedDescription: paletteEntry.combinedDescription || oldEntry.combinedDescription,
            order: Math.max(paletteEntry.order || -1, oldEntry.order || -1),
            command_id: binding.args.command_id || oldEntry.command_id,
            prefix_id: binding.args.prefix_id || oldEntry.prefix_id,
        };
        bindingMap[context] = mapping;
    }

    for (const [key, bindings] of Object.entries(bindingMap)) {
        let entries = Object.values(bindings);
        entries.sort((x, y) => x.order - y.order);
        paletteEntries[key] = entries;
    }
}

export async function commandPalette(_args: unknown, opt: { useKey?: boolean } = {}) {
    const useKey = opt.useKey || false;

    const state = await withState(async s => s);
    if (state) {
        const prefixCode = state.get<number>(PREFIX_CODE, 0)!;
        const mode = state.get<string>(MODE, bindings.default_mode())!;
        const key = `${prefixCode}:${mode}`;

        paletteBindingMode = useKey;
        vscode.commands.executeCommand(
            'setContext',
            'master-key.keybindingPaletteBindingMode',
            paletteBindingMode,
        );
        let picks = paletteEntries[key].map((binding) => {
            const key = binding.combinedKey || binding.key || '';
            const name = binding.name || '';
            let description = binding.combinedDescription || binding.description || '';
            return {
                label: key,
                description: name + (/\[.+\]/.test(key) ? LAYOUT_MARKER : ''),
                detail: replaceAll(description || '', /\n/g, ' '),
                command_id: binding.command_id,
                prefix_id: binding.prefix_id,
            };
        });

        if (picks.length === 0) {
            vscode.window.showErrorMessage(
                `Palette cannot be shown for mode '${mode}', there are no bindings.`,
            );
            return;
        }

        const picker = vscode.window.createQuickPick<{
            label: string;
            command_id?: number;
            prefix_id?: number;
        }>();
        picker
        currentPicker = picker;
        let accepted = false;
        setPickerText();
        picker.items = picks;
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;
        picker.onDidAccept(async (_) => {
            const pick = picker.selectedItems[0];
            if (pick) {
                accepted = true;
                picker.dispose();
                await doCommandsCmd(pick);
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
        picker.show();

        vscode.commands.executeCommand(
            'setContext',
            'master-key.keybindingPaletteOpen',
            true,
        );

        // when this palette accepts keybinding presses (rather than searching bindings),
        // dispose of the palette any time a normal key binding key is pressed the effect of
        // a normal key is normally to complete command, however if a command failed but
        // updates the mode or prefix code this is also sufficient to clear the palette
        let commandsFinished = 0;
        await withState(async (state) => {
            if (paletteBindingMode) {
                state = state.onSet(PREFIX_CODE, (_) => {
                    accepted = true;
                    picker.dispose();
                    return false;
                });
                state = state.onSet(MODE, (_) => {
                    accepted = true;
                    picker.dispose();
                    return false;
                });
                onCommandComplete(async () => {
                    commandsFinished += 1;
                    if (commandsFinished > 1) {
                        accepted = true;
                        picker.dispose();
                        return false;
                    }
                    return true;
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

    onChangeBindings(async (x) => updateKeys(x));

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
