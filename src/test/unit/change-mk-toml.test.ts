import * as vscode from 'vscode';
import * as assert from 'assert';
import { editorWithText } from './utils';

suite('*.toml Linting', () => {
    test('Good file has no linting', async function () {
        this.timeout(5000);
        const body = `
            #:master-keybindings

            [header]
            version = "2.0.0"

            [[bind]]
            doc.name = "default"
            command = "foobar"
            key = "a"

            [[bind]]
            doc.name = "run_merged"
            key = "k"
            command = "bizbaz"
        `;

        console.log('setting up editor');
        const [_editor, fileUri] = await editorWithText(body, 'toml');
        console.log('activating bindings');
        await vscode.commands.executeCommand('master-key.activateBindings', 'CurrentFile');

        const diags = vscode.languages.getDiagnostics(fileUri);
        assert.equal(diags.length, 0);
    });

    test('Bad file causes a lint error', async function () {
        this.timeout(5000);
        // NOTE: there is no `key` field
        const body = `
            #:master-keybindings

            [header]
            version = "2.0.0"

            [[bind]]
            doc.name = "default"
            command = "foobar"

            [[bind]]
            doc.name = "run_merged"
            key = "k"
            command = "bizbaz"
        `;

        const [_editor, fileUri] = await editorWithText(body, '.toml');
        // trigger file validation
        await vscode.commands.executeCommand('master-key.activateBindings', 'CurrentFile');
        const diag = vscode.languages.getDiagnostics(fileUri);

        assert.notEqual(diag.length, 0);
        const error = diag.find(d => /`key` field/.test(d.message));
        assert.equal(error?.severity, vscode.DiagnosticSeverity.Error);
        assert.notEqual(error, undefined);
    });

    test('Sketchy file causes a lint warning', async function () {
        this.timeout(5000);
        // NOTE: `name` is not prefixed with `doc`
        const body = `
            #:master-keybindings

            [header]
            version = "2.0.0"

            [[bind]]
            name = "default"
            key = "a"
            command = "foobar"

            [[bind]]
            doc.name = "run_merged"
            key = "k"
            command = "bizbaz"
        `;

        const [_editor, fileUri] = await editorWithText(body, '.toml');
        // trigger file validation
        await vscode.commands.executeCommand('master-key.activateBindings', 'CurrentFile');
        const diag = vscode.languages.getDiagnostics(fileUri);

        assert.notEqual(diag.length, 0);
        const error = diag.find(d => /`name` no longer exists/.test(d.message));
        assert.equal(error?.severity, vscode.DiagnosticSeverity.Warning);
        assert.notEqual(error, undefined);
    });
});
