import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { updateCursorAppearance, validateInput } from '../utils';
import { state, recordedCommand, CommandResult } from '../state';
import { runCommandsForMode } from './capture';
import { onSetBindings } from '../keybindings/config';
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
        state.set(MODE, toMode);
    }
    return args;
}

export function restoreModesCursorState() {
    const shape = bindings.mode(currentResolvedMode)?.cursorShape || CursorShape.Line;
    updateCursorAppearance(vscode.window.activeTextEditor, shape);
}


async function updateModes(bindings: KeyFileResult) {
    const newDefault = bindings.default_mode();
    console.log(`newDefault: ${newDefault}`);
    state.set(MODE, newDefault);
    state.resolve();
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
    state.define(MODE, 'default');

}

let currentResolvedMode = '';
export async function activate(_context: vscode.ExtensionContext) {
    onSetBindings(updateModes);

    vscode.window.onDidChangeActiveTextEditor((e) => {
        const shape = bindings.mode(currentResolvedMode)?.cursorShape || CursorShape.Line;
        updateCursorAppearance(e, shape);
    });

    const defaultMode = bindings.default_mode() || 'default';
    state.set(MODE, defaultMode);
    state.resolve();

    onResolve('mode', () => {
        const _currentMode = currentResolvedMode;
        // NOTE: I don't really know why I to declare `_currentMode` instead of using
        // `currentMode` directly but not doing it prevents this function from detecting
        // changes to the mode state (something about how closures interact with scopes and
        // async that I don't understand???)
        // TODO: this might not be necessary now that we've changed how `state.ts` works
        const newMode = <string>state.get(MODE) || bindings.default_mode() || 'default';
        const mode = bindings.mode(newMode);
        if (_currentMode !== newMode) {
            const shape = (mode?.cursorShape || CursorShape.Line);
            updateCursorAppearance(vscode.window.activeTextEditor, shape);
            if (mode) {
                runCommandsForMode(mode);
            }
            currentResolvedMode = newMode;
        }
        return true;
    });
}

export async function defineCommands(context: vscode.ExtensionContext) {
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
}
