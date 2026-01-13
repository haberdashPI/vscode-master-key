import * as vscode from 'vscode';

// state: this manages all of the values that can be accessed
// from expressions (e.g. `key.count`) and contexts (e.g. `master-key.count`).
import * as state from './state';
// keybindings: handlings the parsing and activation of keybinding files and the evaluation
// of expressions, all of which are defined within the keybindings
import * as keybindings from './keybindings/index';
// commands: defines all of the commands created by master key
import * as commands from './commands/index';
// status: implements the UI elements visible in the status bar
import * as status from './status/index';
// config: handles the storing of configuration data defined by a master keybinding file
import * as config from './keybindings/config';
// parsing: the rust module used that supports keybindings, it is used as a part of
// `keybindings` above
import initParsing from '../rust/parsing/lib';

// Each file has a `defineState` function which initializes the variables stored in the
// `state` object. It is executed first to ensure that all hooks that respond to
// changes---which are defined in `activate`---can occur after the values are defined. This
// ensures preemptive errors can be raised if we create a hook for a value that doesn't
// exist by checking that it has been defined.
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

    // state is stored in `bindings` which represents the currently loaded set of key
    // bindings. This is defined inside `config` and so before we can define the state
    // variables wee need to activate `config`.
    await config.activate(context);
    defineState();

    // the remaining `activate` functions require state-related methods to exist
    // e.g. `onSet` and `onResolve`
    await keybindings.activate(context);
    await state.activate(context);
    await commands.activate(context);
    await status.activate(context);
    await config.updateBindings(context);

    // check for and warn about legacy data
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

    // commands must be defined after activation, as the commands sometimes depend on hooks
    // initialized during `activate`.
    await keybindings.defineCommands(context);
    await config.defineCommands(context);
    await state.defineCommands(context);
    await commands.defineCommands(context);
    await status.defineCommands(context);
    await config.defineCommands(context);
}

export function deactivate() {}
