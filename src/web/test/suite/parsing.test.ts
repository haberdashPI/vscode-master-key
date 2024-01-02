import assert from 'assert';
import fs from 'fs';
import path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { processBindings } from '../../keybindingProcessing';
import { parseBindingTOML } from '../../keybindingParsing';

function specForBindings(text: string){
    let result = parseBindingTOML(text);
    if (result.success) {
        let data = processBindings(result.data);
        if(data){
            let [spec, defs] = data;
            return spec;
        }
    }
    throw new Error("Unexpected parsing failure!");
}

suite('Keybinding Test Suite', () => {
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

    // TODO: extract this pattern so it is easy to write tests
    // for the parsing of file content
    test('Imports correct number of bindings', async () => {
        let spec = specForBindings(sampleBindings);
        assert.equal(spec.length, 2);
    });
});
