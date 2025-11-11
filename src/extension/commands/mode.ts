import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { updateCursorAppearance, validateInput } from '../utils';
import { withState, recordedCommand, CommandResult } from '../state';
import { runCommandsForMode } from './capture';
import { onChangeBindings } from '../keybindings/config';
import { CursorShape, KeyFileResult } from '../../rust/parsing/lib/parsing';
import { bindings } from '../keybindings/config';

export const MODE = 'mode';

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
        let toMode = args.value;
        if (!bindings.mode(toMode)) {
            vscode.window.showErrorMessage(`There is no mode named '${args.value}'.`);
            toMode = bindings.default_mode();
        }
        await withState(async state => state.set(MODE, { public: true }, toMode));
    }
    return args;
}
async function updateModes(bindings: KeyFileResult) {
    await withState(async (state) => {
        const newDefault = bindings.default_mode();
        console.log(`newDefault: ${newDefault}`);
        restoreModesCursorState();
        return state.set(MODE, { public: true }, newDefault).resolve();
    });
}
export function restoreModesCursorState() {
    const shape = bindings.mode(currentMode)?.cursorShape || CursorShape.Line;
    updateCursorAppearance(vscode.window.activeTextEditor, shape);
}

let currentMode = 'default';
export async function activate(context: vscode.ExtensionContext) {
    onChangeBindings(updateModes);

    vscode.window.onDidChangeActiveTextEditor((e) => {
        const shape = bindings.mode(currentMode)?.cursorShape || CursorShape.Line;
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
        const defaultMode = bindings.default_mode() || 'default';
        return state.set(MODE, { public: true }, defaultMode).resolve();
    });
    await onResolve('mode', (values) => {
        const _currentMode = currentMode;
        // NOTE: I don't really know why I to declare `_currentMode` instead of using
        // `currentMode` directly but not doing it prevents this function from detecting
        // changes to the mode state (something about how closures interact with scopes and
        // async that I don't understand???)
        const newMode = <string>values.get(MODE, bindings.default_mode() || 'default');
        const mode = bindings.mode(newMode);
        if (mode) {
            if (_currentMode !== newMode) {
                const shape = (mode.cursorShape || CursorShape.Line);
                updateCursorAppearance(vscode.window.activeTextEditor, shape);
                runCommandsForMode(mode);
                currentMode = newMode;
            }
        }
        return true;
    });
}
