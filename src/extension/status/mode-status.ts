import * as vscode from 'vscode';
import { CommandState, onResolve, withState } from '../state';
import { RECORD } from '../commands/replay';
import { MODE, modeSpecs } from '../commands/mode';
import { Map } from 'immutable';
import { onChangeBindings } from '../keybindings/config';
import { ModeSpec } from '../keybindings/parsing';
import { Bindings } from '../keybindings/processing';

function updateModeStatusHelper(
    state: Map<string, unknown> | CommandState,
    modeSpecs: Record<string, ModeSpec>,
) {
    if (modeStatusBar) {
        const mode = <string>state.get(MODE);
        const highlight = modeSpecs[mode] ? modeSpecs[mode].highlight : 'NoHighlight';
        const rec = state.get<boolean>(RECORD, false);
        modeStatusBar.text = (rec ? 'rec: ' : '') + mode;
        modeStatusBar.accessibilityInformation = {
            label: 'Keybinding Mode: ' + modeStatusBar.text,
        };
        if (state.get<boolean>(RECORD, false) || highlight === 'Alert') {
            modeStatusBar.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.errorBackground',
            );
        } else if (highlight === 'Highlight') {
            modeStatusBar.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
        } else {
            modeStatusBar.backgroundColor = undefined;
        }
    }
}

function updateModeStatus(state: Map<string, unknown> | CommandState) {
    updateModeStatusHelper(state, modeSpecs);
    return true;
}

async function updateModeStatusConfig(bindings: Bindings | undefined) {
    const modeSpecs = bindings?.mode || {};
    await withState(async (state) => {
        updateModeStatusHelper(state, modeSpecs);
        return state;
    });
}

let modeStatusBar: vscode.StatusBarItem | undefined = undefined;
export async function activate(_context: vscode.ExtensionContext) {
    modeStatusBar = vscode.window.createStatusBarItem(
        'mode',
        vscode.StatusBarAlignment.Left,
        100000,
    );
    modeStatusBar.accessibilityInformation = { label: 'Keybinding Mode' };
    modeStatusBar.show();

    await withState(async (state) => {
        updateModeStatus(state);
        return state;
    });
    await onResolve('modeStatus', updateModeStatus);
    await onChangeBindings(updateModeStatusConfig);
}
