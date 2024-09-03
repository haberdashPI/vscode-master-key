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

    if (process.env.COVERAGE) {
        context.subscriptions.push(
            vscode.commands.registerCommand('master-key.writeCoverageToEditor', () => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const coverage = JSON.stringify(__coverage__);
                    editor.edit(builder => {
                        builder.insert(new vscode.Position(0, 0), coverage);
                    });
                }
            })
        );
    }

    if (process.env.TESTING) {
        const fileConfig = vscode.workspace.getConfiguration('files');
        fileConfig.update('simpleDialog.enable', true, vscode.ConfigurationTarget.Global);

        const config = vscode.workspace.getConfiguration('master-key');
        config.update('presetDirectories', [], vscode.ConfigurationTarget.Global);
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}
