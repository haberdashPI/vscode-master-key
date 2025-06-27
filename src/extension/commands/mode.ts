import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { updateCursorAppearance, validateInput } from '../utils';
import { withState, recordedCommand, CommandResult } from '../state';
import { ModeSpec } from '../keybindings/parsing';
import { runCommandOnKeys } from './capture';
import { onChangeBindings } from '../keybindings/config';
import { Bindings } from '../keybindings/processing';

export const MODE = 'mode';

async function updateModeKeyCapture(mode: string, modeSpec: Record<string, ModeSpec>) {
    runCommandOnKeys(modeSpec[mode]?.onType, mode);
}

/**
 * @command setMode
 * @section Set Mode
 * @order 140
 *
 * Sets the key mode. This shows up in the lower left corner, and determines which
 * keybindings are active (see also [`bind`](/bindings/bind) and [`mode`](/bindings/mode)).
 *
 * **Arguments**
 * - `value`: The mode to set, a string
 */
const setModeArgs = z.object({ value: z.string() }).strict();
async function setMode(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.setMode', args_, setModeArgs);
    if (args) {
        const a = args;
        await withState(async state => state.set(MODE, { public: true }, a.value));
    }
    return args;
}
export let modeSpecs: Record<string, ModeSpec> = {};
export let defaultMode: string = 'default';
async function updateModeSpecs(bindings: Bindings | undefined) {
    modeSpecs = bindings?.mode || {};
    defaultMode = (Object.values(modeSpecs).
        filter(x => x.default)[0] || { name: 'default' }).
        name;
    await withState(async (state) => {
        return state.set(MODE, { public: true }, defaultMode).resolve();
    });
}
export function restoreModesCursorState() {
    const shape = modeSpecs[currentMode]?.cursorShape || 'Line';
    updateCursorAppearance(vscode.window.activeTextEditor, shape);
}

let currentMode = 'default';
export async function activate(context: vscode.ExtensionContext) {
    onChangeBindings(updateModeSpecs);

    vscode.window.onDidChangeActiveTextEditor((e) => {
        const shape = modeSpecs[currentMode]?.cursorShape || 'Line';
        updateCursorAppearance(e, shape);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setMode', recordedCommand(setMode)),
    );
    /**
     * @command enterInsert
     * @order 140
     *
     * Short-hand command for [`master-key.setMode`](/commands/setMode) with `value`
     * set to 'insert'.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.enterInsert',
            recordedCommand(() => setMode({ value: 'insert' })),
        ),
    );
    /**
     * @command enterNormal
     * @order 140
     *
     * Short-hand command for [`master-key.setMode`](/commands/setMode) with `value`
     * set to `'normal'`.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.enterNormal',
            recordedCommand(() => setMode({ value: 'normal' })),
        ),
    );

    await withState(async (state) => {
        return state.set(MODE, { public: true }, defaultMode).resolve();
    });
    await onResolve('mode', (values) => {
        const cmode = currentMode; // NOTE: I don't really know why I to declare `cmode`
        // instead of using `currentMode` directly but not doing it prevents this function
        // from detecting changes to the mode state (something about how closures interact
        // with scopes and async that I don't understand???)
        const newMode = <string>values.get(MODE, defaultMode);
        if (cmode !== newMode) {
            const shape = (modeSpecs || {})[newMode]?.cursorShape || 'Line';
            updateCursorAppearance(vscode.window.activeTextEditor, shape);
            updateModeKeyCapture(newMode, modeSpecs || {});
            currentMode = newMode;
        }
        return true;
    });
}
