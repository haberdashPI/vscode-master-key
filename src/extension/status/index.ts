// shows an indicator of the mode in the status bar
import * as modeStatus from './mode-status';
// shows an indicator of the sequence of pressed keys in the status bar
import * as keySequence from './keyseq';
import * as vscode from 'vscode';

export function defineState() {
    modeStatus.defineState();
    keySequence.defineState();
}

export async function activate(context: vscode.ExtensionContext) {
    await modeStatus.activate(context);
    await keySequence.activate(context);
}

export async function defineCommands(context: vscode.ExtensionContext) {
    await modeStatus.defineCommands(context);
    await keySequence.defineCommands(context);
}
