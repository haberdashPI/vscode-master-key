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
    editor.selection = new vscode.Selection(
        new vscode.Position(1, 0),
        new vscode.Position(1, 0),
    );
}

export async function assertCursorMovesBy(
    editor: vscode.TextEditor,
    by: vscode.Position,
    body: (x: void) => Promise<void>,
) {
    const start = editor.selection.active;
    await body();
    const end = editor.selection.active;
    const expectedEnd = new vscode.Position(
        start.line + by.line,
        start.character + by.character,
    );
    assert.equal(end.character, expectedEnd.character, 'Incorrect cursor character offset');
    assert.equal(end.line, expectedEnd.line, 'Incorrect cursor line offset');
}
