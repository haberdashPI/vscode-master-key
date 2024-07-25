import * as vscode from 'vscode';
import {onChangeBindings} from '../keybindings/config';

async function showTextDoc() {
    await vscode.workspace.openTextDocument({content: textDocs, language: 'markdown'});
    await vscode.commands.executeCommand('markdown.showPreview');
}

let textDocs: string = '';
export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.showTextDoc', showTextDoc)
    );
    onChangeBindings(async x => {
        if (x !== undefined) {
            textDocs = x.docs;
        }
    });
}
