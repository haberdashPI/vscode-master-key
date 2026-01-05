import * as state from './state';
import * as vscode from 'vscode';
import * as keybindings from './keybindings/index';
import * as commands from './commands/index';
import * as status from './status/index';
import * as config from './keybindings/config';
import initParsing from '../rust/parsing/lib';

export function defineState() {
    keybindings.defineState();
    config.defineState();
    state.defineState();
    commands.defineState();
    status.defineState();
}

export async function activate(context: vscode.ExtensionContext) {
    // initialize rust WASM module for parsing keybinding files
    const filename = vscode.Uri.joinPath(context.extensionUri, 'out', 'parsing_bg.wasm');
    const bits = await vscode.workspace.fs.readFile(filename);
    await initParsing(bits);

    // defineState needs `bindings` to exists, defined in `config.activate`
    await config.activate(context);
    defineState();

    // the remaining `activate` functions require state-related methods to exist
    // e.g. `onSet` and `onResolve`
    await keybindings.activate(context);
    await state.activate(context);
    await commands.activate(context);
    await status.activate(context);
    await config.updateBindings(context);

    const settings = vscode.workspace.getConfiguration('master-key');
    const storage = settings.get('storage');
    if (storage) {
        vscode.window.showWarningMessage(`
            Master Key has detected legacy data in your settings
            (under 'master-key.storage'). There are many breaking changes in the newest
            version of Master Key. Please call 'Master Key: Activate Keybindings',
            to reactivate your bindings and remove the legacy data.
        `, 'Learn More', 'Reactivate Bindings').then((selection) => {
            if (selection == 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse(
                    'https://haberdashpi.github.io/vscode-master-key/bindings/',
                ));
            } else if (selection == 'Reactivate Bindings') {
                vscode.commands.executeCommand('master-key.activateBindings');
            }
        });
    }

    await keybindings.defineCommands(context);
    await config.defineCommands(context);
    await state.defineCommands(context);
    await commands.defineCommands(context);
    await status.defineCommands(context);
    await config.defineCommands(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
