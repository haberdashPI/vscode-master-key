// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as assert from 'assert';
import { assertCursorMovesBy, cursorToStart, editorWithText } from './utils';

async function startRecording() {
    await vscode.commands.executeCommand('master-key.do', {
        do: [{ command: 'master-key.record', args: { on: true } }],
        name: 'record',
    });
}

async function stopRecording() {
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
}

suite('Replay command', () => {
    let editor: vscode.TextEditor;
    setup(async () => {
        editor = await editorWithText(`a b c d
e f g h
i j k l`);
    });

    test('Handles recording', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 1, character: 1 }, async () => {
            await startRecording();
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'right' } }],
            });
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'down' } }],
            });
            await stopRecording();
        });

        await assertCursorMovesBy(editor, { line: 1, character: 1 }, async () => {
            await vscode.commands.executeCommand('master-key.replayFromStack');
        });
    });

    test('Replays directly from history', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 1, character: 1 }, async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'right' } }],
            });
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'down' } }],
            });
        });

        await assertCursorMovesBy(editor, { line: 1, character: 0 }, async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.replayFromHistory',
                        args: { whereComputedIndexIs: 'index' },
                    },
                ],
            });
        });
    });

    test('Replays `whenComputed` commands', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 1 }, async () => {
            await startRecording();

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: { to: 'right' },
                        computedArgs: { value: 'count' },
                    },
                    {
                        command: 'cursorMove',
                        args: { to: 'down' },
                        whenComputed: 'count > 1',
                    },
                ],
            });

            await stopRecording();
        });

        await assertCursorMovesBy(editor, { line: 0, character: 1 }, async () => {
            await vscode.commands.executeCommand('master-key.replayFromStack');
        });

        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 1, character: 3 }, async () => {
            await startRecording();

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.updateCount',
                        args: { value: 3 },
                    },
                ],
                finalKey: false,
            });
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: { to: 'right' },
                        computedArgs: { value: 'count' },
                    },
                    {
                        command: 'cursorMove',
                        args: { to: 'down' },
                        whenComputed: 'count > 1',
                    },
                ],
            });

            await stopRecording();
        });

        await assertCursorMovesBy(editor, { line: 1, character: 3 }, async () => {
            await vscode.commands.executeCommand('master-key.replayFromStack');
        });
    });

    test('Replays search', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 3 }, async () => {
            await startRecording();
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.search',
                        args: {
                            text: 'c d',
                        },
                    },
                ],
            });
            await stopRecording();
        });
    });

    test('Can be nested', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 2 }, async () => {
            await startRecording();
            await vscode.commands.executeCommand('master-key.do', {
                do: [{ command: 'cursorMove', args: { to: 'right' } }],
            });

            await vscode.commands.executeCommand('master-key.do', {
                do: [{
                    command: 'master-key.replayFromHistory',
                    args: { whereComputedIndexIs: 'index' },
                }],
            });
            await stopRecording();
        });

        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 2 }, async () => {
            await vscode.commands.executeCommand('master-key.replayFromStack');
        });
    });
});
