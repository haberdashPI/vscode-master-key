import * as vscode from 'vscode';
import * as keybindings from './keybindings/index';
import * as commands from './commands/index';
import * as status from './status/index';
import * as state from './state';
import * as config from './keybindings/config';

export async function activate(context: vscode.ExtensionContext) {
    await keybindings.activate(context);
    await config.activate(context);
    await state.activate(context);
    await commands.activate(context);
    await status.activate(context);
    await config.updateBindings(context);

    await keybindings.defineCommands(context);
    await config.defineCommands(context);
    await state.defineCommands(context);
    await commands.defineCommands(context);
    await status.defineCommands(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
