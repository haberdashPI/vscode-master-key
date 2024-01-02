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
    // TODO: should I name `paths` `path`, and `for` `id`?
    // TODO: extract this pattern so it is easy to write tests
    // for the parsing of file content
    test('Imports correct number of bindings', () => {
        let spec = specForBindings(`
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
        `);
        assert.equal(spec.length, 2);
    });

    // TODO: test for typos for all keys

    let defSpec = specForBindings(`
        [header]
        version = 1.0

        [[paths]]
        for = ""
        name = "Base"

        [[paths]]
        for = "foo"
        name = "Foo"
        default.mode = "foomode"
        default.when = "baz > 0"
        default.computedArgs.value = "count"

        [[paths]]
        for = "foo.bar"
        name = "FooBar"
        default.prefixes = ["", "u"]
        default.mode = "barmode"
        default.computedArgs.select = "prefix.startsWith('u')"

        [[bind]]
        path = "foo"
        name = "1"
        key = "a"
        command = "fooDo"

        [[bind]]
        path = "foo.bar"
        name = "2"
        key = "b"
        when = "biz < 10"
        command = "barDoo"

        [[bind]]
        path = "foo.bar"
        name = "3"
        key = "c"
        prefixes = [""]
        command = "barDo"
    `);

    // create multiple tests: should verify that
    // - all defaults get applied to foo.bar
    // - only foo defaults get applied to foo
    // - when clauses get concatted
    // - prefixes get overwritten
    test('Expands defaults properly', () => {
    });

});
