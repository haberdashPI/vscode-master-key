// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as assert from 'assert';
import { assertCursorMovesBy, editorWithText } from './utils';

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('Set values', () => {
    let editor: vscode.TextEditor;
    setup(async () => {
        let _;

        [editor, _] = await editorWithText(`#:master-keybindings
            [header]
            version = "2.0.0"

            [[define.val]]
            foo = 1
            internal__debug__flag = false

            [[bind]]
            key = "a"
            command = "bar"
        `);
        await vscode.commands.executeCommand('master-key.activateBindings', 'CurrentFile');
        await sleep(150);
        await vscode.window.showTextDocument(editor.document);
        editor = vscode.window.activeTextEditor!;
    });

    test('Updated value visible to expressions', async () => {
        await vscode.commands.executeCommand('master-key.setValue', {
            name: 'foo', value: 3,
        });
        await assertCursorMovesBy(editor, { line: 0, character: 3 }, async () => {
            await vscode.commands.executeCommand('master-key.storeCommand', {
                register: 'test',
                command: 'cursorMove',
            });
            await vscode.commands.executeCommand('master-key.executeStoredCommand', {
                register: 'test',
                args: {
                    value: '{{val.foo}}',
                    to: 'right',
                },
            });
        });
    });

    // TODO: get this test working — we can verify that context is updated
    // when debugging this test, but for some reason the newly available command
    // isn't something that gets picked up here
    // test('Updated value visible in context', async function () {
    //     this.timeout(50000000);
    //     let allCommands = await vscode.commands.getCommands();
    //     // in package.json this command is defined, but it is simply a placeholder for
    //     // testing
    //     let commandExists = allCommands.includes('master-key.internal-testCommand');
    //     assert.equal(commandExists, false);
    //     await vscode.commands.executeCommand('master-key.setValue', {
    //         name: 'internal__debug__flag', value: true,
    //     });
    //     // HACK: run a master key command so that the context is updated
    //     // (setValue is normally called inside of master-key.do where context
    //     // is updated when calling `state.resolve()`)
    //     await vscode.commands.executeCommand('master-key.prefix', {
    //         key: 'x',
    //         prefix_id: 0,
    //     });
    //     let count = 0;
    //     while (!commandExists) {
    //         allCommands = await vscode.commands.getCommands();
    //         // in package.json this command is defined, but it is simply a placeholder
    //         // for testing
    //         commandExists = allCommands.includes('master-key.internal-testCommand');
    //         await sleep(100);
    //         count++;
    //         if (count > 20) {
    //             break;
    //         }
    //     }
    //     assert.equal(commandExists, true);
    // });
});
