import * as vscode from 'vscode';
import * as assert from 'assert';
import { editorWithText } from './utils';

suite('*.mk.toml Linting', () => {
    test('Good file has no linting', async function () {
        this.timeout(5000);
        const body = `
            [[bind]]
            name = "default"
            command = "foobar"
            key = "a"

            [[bind]]
            name = "run_merged"
            key = "k"
            command = "bizbaz"
        `;

        const [_editor, fileUri] = await editorWithText(body, '.mk.toml');

        const diags = vscode.languages.getDiagnostics();
        for (const [file, diag] of diags) {
            if (file.path.endsWith('mk.toml')) {
                assert.equal(diag.length, 0);
            }
        }

        await vscode.workspace.fs.delete(fileUri);
    });

    test('Bad file causes a lint error', async function () {
        this.timeout(5000);
        // NOTE: there is no `key` field
        const body = `
            [[bind]]
            name = "default"
            command = "foobar"

            [[bind]]
            name = "run_merged"
            key = "k"
            command = "bizbaz"
        `;

        const [_editor, fileUri] = await editorWithText(body, '.mk.toml');

        const diags = vscode.languages.getDiagnostics();

        assert.notEqual(diags.length, 0);
        for (const [file, diag] of diags) {
            if (file.path.endsWith('mk.toml')) {
                assert.notEqual(diag.length, 0);
                const error = diag.find(d => d.message == 'requires `key` field\n');
                assert.notEqual(error, undefined);
            }
        }

        await vscode.workspace.fs.delete(fileUri);
    });
});
