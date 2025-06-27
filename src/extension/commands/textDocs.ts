import * as vscode from 'vscode';
import { onChangeBindings } from '../keybindings/config';

/**
 * @userCommand showTextDoc
 * @name Show Text Documentation
 * @order 10
 *
 * Show documentation for the current master keybindings in a rendered markdown file.
 */
async function showTextDoc() {
    const file = docFile();
    if (file) {
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('markdown.showPreview');
    }
}

function docFile() {
    if (storageUri) {
        return vscode.Uri.joinPath(storageUri, 'Keybinding Documentation.md');
    } else {
        return undefined;
    }
}

let storageUri: vscode.Uri | undefined = undefined;
export async function activate(context: vscode.ExtensionContext) {
    storageUri = context.globalStorageUri;
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.showTextDoc', showTextDoc),
    );
    onChangeBindings(async (x) => {
        const file = docFile();
        if (x !== undefined && file) {
            const data = new TextEncoder().encode(x.docs);
            vscode.workspace.fs.writeFile(file, data);
        }
    });
}
