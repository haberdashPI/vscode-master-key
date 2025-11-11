import * as vscode from 'vscode';
import * as assert from 'assert';

import * as path from 'path';
import * as os from 'os';

export async function editorWithText(
    body: string,
    fileExt: string = '.txt',
): Promise<[vscode.TextEditor, vscode.Uri]> {
    await vscode.commands.executeCommand('explorer.newFile');

    const fileName = `test-file-${Date.now()}${fileExt}`;
    const filePath = path.join(os.tmpdir(), fileName);

    // Convert the string path to a VS Code URI
    const fileUri = vscode.Uri.file(filePath);

    const fileContent = Buffer.from(body, 'utf8');
    await vscode.workspace.fs.writeFile(fileUri, fileContent);

    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    return [editor, fileUri];
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
