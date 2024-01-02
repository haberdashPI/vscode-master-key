import { assert } from 'chai';
import fs from 'fs';
import path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { processFile } from '../../keybindings';

suite('Keybinding Test Suite', () => {
    // TODO: I think because we are in a web environment we can't use node here,
    // switch to testing via string input
    // vscode.window.showInformationMessage('Start all tests.');
    let sampleBindings = `
    [header]
    version = 1.0

    [[paths]]
    for = ""
    name = "Foo"

    [[bind]]
    path = ""
    name = "foo"
    key = "Cmd+a"
    command = "fooCommand"

    [[bind]]
    path = ""
    name = "bar"
    key = "Cmd+b"
    command = "barCommand"
    `;

    describe('Imports correct number of bindings', async () => {
        let folder = fs.mkdtempSync('binding');
        let file = path.join(folder, 'bindings.toml');
        fs.writeFileSync(file, sampleBindings);
        let result = await processFile(vscode.Uri.file(file));
        assert.isArray(result);
        assert.lengthOf(result!, 2);
        let [spec, defs] = result!;
        assert.lengthOf(spec, 2);
    });
});
