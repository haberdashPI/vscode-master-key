import * as vscode from 'vscode';
import * as keybindings from './keybindings';
import * as commands from './commands/index';
import * as status from './status/index';

export function activate(context: vscode.ExtensionContext) {
    keybindings.activate(context);
    commands.activate(context);
    status.activate(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
