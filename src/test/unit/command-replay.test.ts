// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as assert from 'assert';
import { assertCursorMovesBy, cursorToStart, editorWithText } from './utils';

suite('Replay command', () => {
    let editor: vscode.TextEditor;
    setup(async () => {
        editor = await editorWithText(`a b c d
e f g h
i j k l`);
    });

    test.skip('Handles recording', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 1, character: 1 }, async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'master-key.record', args: { on: true } }],
            });
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'right' } }],
            });
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'down' } }],
            });
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.record',
                        args: { on: false },
                    },
                    {
                        command: 'master-key.pushHistoryToStack',
                        args: {
                            whereComputedRangeIs: {
                                from: 'commandHistory[index-1].name === "record"',
                                to: 'index',
                            },
                        },
                    },
                ],
            });
        });

        await assertCursorMovesBy(editor, { line: 1, character: 1 }, async () => {
            await vscode.commands.executeCommand('master-key.replayFromStack');
        });
    });
});
