import * as vscode from 'vscode';
import * as keybindings from './keybindings/index';
import * as commands from './commands/index';
import * as status from './status/index';
import * as state from './state';
import * as config from './keybindings/config';

declare let __coverage__: object;
export async function activate(context: vscode.ExtensionContext) {
    await keybindings.activate(context);
    await state.activate(context);
    await commands.activate(context);
    await status.activate(context);
    await config.activate(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
