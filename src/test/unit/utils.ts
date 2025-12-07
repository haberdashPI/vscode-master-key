import * as vscode from 'vscode';
import * as assert from 'assert';

export async function editorWithText(
    body: string,
    language: string = '',
): Promise<[vscode.TextEditor, vscode.Uri]> {
    const document = await vscode.workspace.openTextDocument({
        content: body,
        language,
    });
    const editor = await vscode.window.showTextDocument(document);

    return [editor, document.uri];
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
    // console.log('DEBUG start: ' + JSON.stringify(start, null, 4));
    await body();
    const end = editor.selection.active;
    // console.log('DEBUG end: ' + JSON.stringify(end, null, 4));
    const expectedEnd = new vscode.Position(
        start.line + by.line,
        start.character + by.character,
    );
    // console.log('DEBUG: start', start, 'end', end);
    assert.equal(end.line, expectedEnd.line, 'Incorrect cursor line offset');
    assert.equal(end.character, expectedEnd.character, 'Incorrect cursor character offset');
}
