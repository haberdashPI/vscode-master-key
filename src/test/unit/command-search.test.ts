// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as assert from 'assert';
import { assertCursorMovesBy, cursorToPos, cursorToStart, editorWithText } from './utils';
import { reverse } from 'dns';

suite('Search command', () => {
    let editor: vscode.TextEditor;
    setup(async () => {
        editor = await editorWithText(`foobar bum POINT_A Officia voluptate ex point_a commodo esse laborum velit
ipsum velit excepteur sunt cillum nulla adipisicing cupidatat. Laborum officia do mollit do
labore elit occaecat cupidatat non POINT_B.`);
    });

    test('Jumps to search location', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, {line: 0, character: 10}, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
            });
        });
    });

    test('Can move backwards', async () => {
        cursorToPos(editor, 1, 0);
        await assertCursorMovesBy(editor, {line: -1, character: 47}, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                backwards: true,
            });
        });
    });

    test('Follows skip argument', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, {line: 0, character: 39}, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                skip: 1
            });
        });
    });

    test('Can be case sensitive', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, {line: 2, character: 73}, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_',
                caseSensitive: true,
            });
            await vscode.commands.executeCommand('master-key.nextMatch')
        });

    });

    test('Can wrap-around', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, {line: 0, character: 39}, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
            });
            await vscode.commands.executeCommand('master-key.nextMatch')
            await vscode.commands.executeCommand('master-key.nextMatch')
        });

        cursorToStart(editor);
        await assertCursorMovesBy(editor, {line: 0, character: 10}, async () => {
            await vscode.commands.executeCommand('master-key.search', {
                text: 'POINT_A',
                wrapAround: true,
            });
            await vscode.commands.executeCommand('master-key.nextMatch')
            await vscode.commands.executeCommand('master-key.nextMatch')
        });

    });

});
