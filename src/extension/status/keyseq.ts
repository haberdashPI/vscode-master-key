import * as vscode from 'vscode';
import { onSet } from '../state';
import { PREFIX } from '../commands/prefix';
import { COUNT } from '../commands/count';
import { state } from '../state';
import { prettifyPrefix } from '../utils';
import { simplifyLayoutIndependentString } from '../keybindings/layout';

let keyStatusBar: vscode.StatusBarItem | undefined = undefined;

const KEY_DISPLAY_DELAY_DEFAULT = 500;
let keyDisplayDelay: number = KEY_DISPLAY_DELAY_DEFAULT;
let statusUpdates = Number.MIN_SAFE_INTEGER;

// update the text in the status bar used to describe the current keybinding prefix
function updateKeyStatus(_: unknown) {
    if (keyStatusBar !== undefined && keyDisplayDelay > 0) {
        // the count (e.g. 12× )
        const count = <number>state.get(COUNT) || 0;
        let plannedUpdate = count ? count + '× ' : '';
        // the description of the current key prefix, e.g. SPACE, C
        const keyseq = simplifyLayoutIndependentString(<string>state.get(PREFIX) || '');
        plannedUpdate += prettifyPrefix(keyseq);
        if (plannedUpdate.length > 0) {
            keyStatusBar.text = plannedUpdate;
            keyStatusBar.accessibilityInformation = {
                label: 'Keys Typed: ' + plannedUpdate,
            };
        } else {
            // NOTE: there is no longer any prefix to display, but we wait to clear it Since
            // user's don't can't instantaneously take in information from the status bar.
            // So we give them time to read it.
            const currentUpdate = statusUpdates;
            setTimeout(() => {
                if (currentUpdate === statusUpdates) {
                    if (statusUpdates < Number.MAX_SAFE_INTEGER) {
                        statusUpdates += 1;
                    } else {
                        statusUpdates = Number.MIN_SAFE_INTEGER;
                    }

                    if (keyStatusBar) {
                        keyStatusBar.text = plannedUpdate;
                        keyStatusBar.accessibilityInformation = { label: 'No Keys Typed' };
                    }
                }
            }, keyDisplayDelay);
        }
    }
    return true;
}

// update the rate at which status bar information is cleared
function updateConfig(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event?.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        keyDisplayDelay =
            config.get<number>('keyDisplayDelay') || KEY_DISPLAY_DELAY_DEFAULT;
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
}

export async function activate(_context: vscode.ExtensionContext) {
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    keyStatusBar = vscode.window.createStatusBarItem(
        'keys',
        vscode.StatusBarAlignment.Left,
        -10000,
    );
    keyStatusBar.accessibilityInformation = { label: 'No Keys Typed' };
    keyStatusBar.show();
    onSet(PREFIX, updateKeyStatus);
    onSet(COUNT, updateKeyStatus);
}

export async function defineCommands(_context: vscode.ExtensionContext) {
    return;
}
