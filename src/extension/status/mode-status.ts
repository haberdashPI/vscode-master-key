import * as vscode from 'vscode';
import { onResolve, state } from '../state';
import { RECORD } from '../commands/replay';
import { MODE } from '../commands/mode';
import { onSetBindings } from '../keybindings/config';
import { bindings } from '../keybindings/config';
import { ModeHighlight } from '../../rust/parsing/lib/parsing';

function updateModeStatus() {
    if (modeStatusBar) {
        const mode = <string>state.get(MODE) || bindings.default_mode();
        const highlight = bindings.mode(mode)?.highlight || 'NoHighlight';
        const rec = state.get<boolean>(RECORD) || false;
        modeStatusBar.text = (rec ? 'rec: ' : '') + mode;
        modeStatusBar.accessibilityInformation = {
            label: 'Keybinding Mode: ' + modeStatusBar.text,
        };
        if (state.get<boolean>(RECORD) || highlight === ModeHighlight.Alert) {
            modeStatusBar.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.errorBackground',
            );
        } else if (highlight === ModeHighlight.Highlight) {
            modeStatusBar.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
        } else {
            modeStatusBar.backgroundColor = undefined;
        }
    }
    return true;
}

export function defineState() {
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

    updateModeStatus();
    onResolve('modeStatus', updateModeStatus);
    await onSetBindings(async (_) => {
        updateModeStatus();
    });
}

export async function defineCommands(_context: vscode.ExtensionContext) {
    return;
}
