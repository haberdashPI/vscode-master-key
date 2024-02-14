import * as vscode from 'vscode';
import * as keybindings from './keybindings';
import * as commands from './commands/index';

export function activate(context: vscode.ExtensionContext) {
	keybindings.activate(context);
	commands.activate(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
