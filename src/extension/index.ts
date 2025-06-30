import * as vscode from 'vscode';
import * as keybindings from './keybindings/index';
import * as commands from './commands/index';
import * as status from './status/index';
import * as state from './state';
import * as config from './keybindings/config';

declare let __coverage__: object;
export async function activate(context: vscode.ExtensionContext) {
    console.log('[DEBUG]: activate...');
    await keybindings.activate(context);
    await state.activate(context);
    await commands.activate(context);
    await status.activate(context);
    await config.activate(context);
    console.log('[DEBUG]: activating...');

    // TODO: figure out where and how to store coverage for new test setup
    // if (process.env.COVERAGE) {
    //     context.subscriptions.push(
    //         vscode.commands.registerCommand('master-key.writeCoverageToEditor', () => {
    //             const editor = vscode.window.activeTextEditor;
    //             if (editor) {
    //                 const coverage = JSON.stringify(__coverage__);
    //                 editor.edit((builder) => {
    //                     builder.insert(new vscode.Position(0, 0), coverage);
    //                 });
    //             }
    //         }),
    //     );
    // }
}

// This method is called when your extension is deactivated
export function deactivate() {}
