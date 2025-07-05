// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as assert from 'assert';
import { assertCursorMovesBy, cursorToPos, cursorToStart, editorWithText } from './utils';

suite('Search command', () => {
    let editor: vscode.TextEditor;
    setup(async () => {
        // eslint-disable-next-line @stylistic/max-len
        editor = await editorWithText(`foobar bum POINT_A Officia voluptate ex point_a commodo esse laborum velit
ipsum velit excepteur sunt cillum nulla adipisicing cupidatat. Laborum officia do mollit do
labore elit occaecat cupidatat non POINT_B.`);
    });

    test('Jumps to search location', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 10 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
            });
        });
    });

    test('Can move backwards', async () => {
        cursorToPos(editor, 1, 0);
        await assertCursorMovesBy(editor, { line: -1, character: 47 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                backwards: true,
            });
        });
    });

    test('Follows skip argument', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 39 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                skip: 1,
            });
        });
    });

    test('Can be case sensitive', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 2, character: 34 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_',
                caseSensitive: true,
            });
            await vscode.commands.executeCommand('master-key.nextMatch');
        });
    });

    test('Can wrap-around', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 39 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
            });
            await vscode.commands.executeCommand('master-key.nextMatch');
            await vscode.commands.executeCommand('master-key.nextMatch');
        });

        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 10 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                wrapAround: true,
            });
            await vscode.commands.executeCommand('master-key.nextMatch');
            await vscode.commands.executeCommand('master-key.nextMatch');
        });
    });

    test('Can select till match', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 11 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                selectTillMatch: true,
            });
            assert.equal(editor.selection.anchor.character, 0);
            assert.equal(editor.selection.anchor.line, 0);
        });
    });

    test('Can adjust position using `offset: "inclusive"`', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 17 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                offset: 'inclusive',
            });
        });

        await assertCursorMovesBy(editor, { line: 0, character: -6 }, async () => {
            await vscode.commands.executeCommand('master-key.nextMatch');
            await vscode.commands.executeCommand('master-key.previousMatch');
        });
    });

    test('Can adjust position using `offset: "start"`', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 11 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                offset: 'start',
            });
        });

        await assertCursorMovesBy(editor, { line: 0, character: 0 }, async () => {
            await vscode.commands.executeCommand('master-key.nextMatch');
            await vscode.commands.executeCommand('master-key.previousMatch');
        });
    });

    test('Can adjust position using `offset: "end"`', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 18 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                offset: 'end',
            });
        });

        await assertCursorMovesBy(editor, { line: 0, character: 0 }, async () => {
            await vscode.commands.executeCommand('master-key.nextMatch');
            await vscode.commands.executeCommand('master-key.previousMatch');
        });
    });

    test('Can use `regex` option.', async () => {
        cursorToStart(editor);

        await assertCursorMovesBy(editor, { line: 0, character: 10 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_(A|B)',
                regex: true,
            });
        });

        await assertCursorMovesBy(editor, { line: 0, character: 29 }, async () => {
            await vscode.commands.executeCommand('master-key.nextMatch');
        });

        await assertCursorMovesBy(editor, { line: 2, character: -5 }, async () => {
            await vscode.commands.executeCommand('master-key.nextMatch');
        });
    });

    test('Can use `register` option.', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, { line: 0, character: 10 }, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'point_a',
                register: 'a',
                wrapAround: true,
            });

            await vscode.commands.executeCommand('master-key.search', {
                text: 'point_b',
                register: 'b',
                wrapAround: true,
            });
            await vscode.commands.executeCommand('master-key.nextMatch', {
                wrapAround: true,
                register: 'a',
            });
        });
    });
});
