import assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { processBindings } from '../../keybindingProcessing';
import { parseBindingTOML } from '../../keybindingParsing';
import { fromZodError } from 'zod-validation-error';
import { sortBy } from 'lodash';

function specForBindings(text: string){
    let result = parseBindingTOML(text);
    if (result.success) {
        let data = processBindings(result.data);
        if(data){
            let [spec, defs] = data;
            return spec;
        }
    } else {
        throw new Error("Unexpected parsing failure!: "+fromZodError(result.error));
    }
    throw new Error("Unexpected parsing failure!");
}

suite('Keybinding Test Suite', () => {
    let simpleFile = `
        [header]
        version = "1.0"

        [[path]]
        id = ""
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
    test('Files can be parsed', () => {
        let result = parseBindingTOML(simpleFile);
        assert(result.success);
        let data = processBindings(result.data);
        assert(result.data);
        let [spec, defs] = data;
        assert(spec);
    });

    // TODO: extract this pattern so it is easy to write tests
    // for the parsing of file content
    test('Imports correct number of bindings', () => {
        let spec = specForBindings(simpleFile);
        console.dir(spec);
        assert.equal(spec.length, 2);
    });

    // TODO: test for typos for all keys

    let defItems = specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = ""
        name = "Base"

        [[path]]
        id = "foo"
        name = "Foo"
        default.kind = "fookind"
        default.when = "baz > 0"
        default.computedArgs.value = "count"

        [[path]]
        id = "foo.bar"
        name = "FooBar"
        default.prefixes = ["", "u"]
        default.kind = "barkind"
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
    defItems = sortBy(defItems, x => x.key);

    // create multiple tests: should verify that
    // - all defaults get applied to foo.bar
    // - only foo defaults get applied to foo
    // - when clauses get concatted
    // - prefixes get overwritten
    test('Defaults expand recursively', () => {
        console.log(defItems.map(x => x.key));
        assert.equal(defItems[0].key, "a");
        assert.equal(defItems[0].args.kind, "fookind");
        assert.equal(defItems[0].prefixDescriptions.length, 1);
        assert(defItems[0].when.match(/baz > 0/));
        assert.notEqual(defItems[0].args.do[0].computedArgs?.select, "prefix.startsWith('u')");
    });

    // TODO: verify that path id's are unique
    // TODO: verify that duplicate keys get detected

});
