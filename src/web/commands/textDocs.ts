import * as vscode from 'vscode';
import { onChangeBindings } from '../keybindings/config';

async function showTextDoc(){

}

export async function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.showTextDoc', showTextDoc)
    );
    onChangeBindings(async x => (x ? ))
}
