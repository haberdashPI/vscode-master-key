import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

suite('Basic Motions', () => {
    let editor: vscode.TextEditor;
    setup(async () => {
        // TODO: abstract setup in a utility functions
        await vscode.commands.executeCommand('explorer.newFile');

        const editor_ = vscode.window.activeTextEditor;
        assert.notEqual(editor_, undefined);
        editor = editor_!;

        await editor.edit((edit) => {
            edit.insert(new vscode.Position(0, 0), `
Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
Ex cillum duis anim dolor cupidatat non nostrud non et sint ullamco.
Consectetur consequat ipsum ex labore enim. Amet do commodo et occaecat
proident ex cupidatat in. Quis id magna laborum ad. Dolore exercitation
cillum eiusmod culpa minim duis
            `);
        });
    });

    test('Can run do', async () => {
        // TODO: abstract these commands in a utility functions
        editor.selection = new vscode.Selection(
            new vscode.Position(1, 0),
            new vscode.Position(1, 0),
        );
        await vscode.commands.executeCommand('master-key.do', {
            do: [
                {
                    command: 'cursorMove',
                    args: {
                        to: 'right',
                    },
                    computedArgs: {
                        value: 'count',
                    },
                }],
        });
        // TODO: abstract these assertions in a utility function
        const position = editor.selection.active;
        assert.equal(position.character, 1);
        assert.equal(position.line, 1);
    });

    test('Can run do with repeat', async () => {
        editor.selection = new vscode.Selection(
            new vscode.Position(1, 0),
            new vscode.Position(1, 0),
        );

        await vscode.commands.executeCommand('master-key.do', {
            do: [
                {
                    command: 'cursorMove',
                    args: {
                        to: 'right',
                    },
                    computedArgs: {
                        value: 'count',
                    },
                }],
            computedRepeat: 1,
        });

        const position = editor.selection.active;
        assert.equal(position.character, 2);
        assert.equal(position.line, 1);
    });

    test('Can run do with computed repeat', async () => {
        editor.selection = new vscode.Selection(
            new vscode.Position(1, 0),
            new vscode.Position(1, 0),
        );

        await vscode.commands.executeCommand('master-key.do', {
            do: [
                {
                    command: 'cursorMove',
                    args: {
                        to: 'right',
                    },
                    computedArgs: {
                        value: 'count',
                    },
                }],
            computedRepeat: '1+2',
        });

        const position = editor.selection.active;
        assert.equal(position.character, 4);
        assert.equal(position.line, 1);
    });

    test('Fail on invalid computed repeat', async () => {
        editor.selection = new vscode.Selection(
            new vscode.Position(1, 0),
            new vscode.Position(1, 0),
        );

        await vscode.commands.executeCommand('master-key.do', {
            do: [
                {
                    command: 'cursorMove',
                    args: {
                        to: 'right',
                    },
                    computedArgs: {
                        value: 'count',
                    },
                }],
            computedRepeat: '"a"+ "b"',
        });

        const position = editor.selection.active;
        assert.equal(position.character, 0);
        assert.equal(position.line, 1);
    });
});
