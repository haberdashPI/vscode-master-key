import * as modeStatus from './mode-status';
import * as keySequence from './keyseq';
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
    await modeStatus.activate(context);
    await keySequence.activate(context);
}
