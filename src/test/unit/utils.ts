import * as vscode from 'vscode';
import * as assert from 'assert';

export async function editorWithText(body: string) {
    await vscode.commands.executeCommand('explorer.newFile');

    const editor_ = vscode.window.activeTextEditor;
    assert.notEqual(editor_, undefined);
    const editor = editor_!;

    await editor.edit(e => e.insert(new vscode.Position(0, 0), body));
    return editor;
}

export function cursorToStart(editor: vscode.TextEditor) {
    cursorToPos(editor, 0, 0);
}

export function cursorToPos(editor: vscode.TextEditor, line: number, character: number) {
    editor.selection = new vscode.Selection(
        new vscode.Position(line, character),
        new vscode.Position(line, character),
    );
}

export async function assertCursorMovesBy(
    editor: vscode.TextEditor,
    by: { line: number; character: number },
    body: (x: void) => Promise<void>,
) {
    const start = editor.selection.active;
    await body();
    const end = editor.selection.active;
    const expectedEnd = new vscode.Position(
        start.line + by.line,
        start.character + by.character,
    );
    // console.log('DEBUG: start', start, 'end', end);
    assert.equal(end.line, expectedEnd.line, 'Incorrect cursor line offset');
    assert.equal(end.character, expectedEnd.character, 'Incorrect cursor character offset');
}
