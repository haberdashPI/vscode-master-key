import assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { processBindings } from '../../keybindingProcessing';
import { parseBindingTOML } from '../../keybindingParsing';
import { fromZodError } from 'zod-validation-error';
import { sortBy, isEqual } from 'lodash';

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
        kind = "do"

        [[bind]]
        path = ""
        name = "bar"
        key = "Cmd+b"
        command = "barCommand"
        kind = "do"
    `;
    test('Files can be parsed', () => {
        let result = parseBindingTOML(simpleFile);
        assert(result.success);
        let data = processBindings(result.data);
        assert(result.data);
        let [spec, defs] = data;
        assert(spec);
    });

    test('Typos are noted', () => {
        assert.throws(() => specForBindings(simpleFile.replace('header', 'headr')),
            {message: 'Unexpected parsing failure!: Validation error: Required at "header"; Unrecognized key(s) in object: \'headr\''});
        assert.throws(() => specForBindings(simpleFile.replace('name', 'nam')),
            {message: 'Unexpected parsing failure!: Validation error: Required at "path[0].name"'});
        assert.throws(() => specForBindings(simpleFile.replace('bind', 'bnd')),
            {message: 'Unexpected parsing failure!: Validation error: Unrecognized key(s) in object: \'bnd\''});
        assert.throws(() => specForBindings(simpleFile.replace('key', 'keye')),
            {message: 'Unexpected parsing failure!: Validation error: Unrecognized key(s) in object: \'keye\' at "bind[0]"'});
    });

    // TODO: extract this pattern so it is easy to write tests
    // for the parsing of file content
    test('Imports correct number of bindings', () => {
        let spec = specForBindings(simpleFile);
        console.dir(spec);
        assert.equal(spec.length, 2);
    });

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

    test('Defaults expand recursively', () => {
        assert.equal(defItems[0].key, "a");
        assert.equal(defItems[0].args.kind, "fookind");
        assert.equal(defItems[0].prefixDescriptions.length, 1);
        assert(defItems[0].when.match(/baz > 0/));
        assert.notEqual(defItems[0].args.do[0].computedArgs?.select, "prefix.startsWith('u')");
        assert.equal(defItems[0].args.do[0].computedArgs?.value, "count");

        let bkeys = defItems.filter(x => x.key === "b" && x.args.kind === "barkind");
        assert.equal(bkeys.length, 2);
        assert(bkeys[0].when.match(/baz > 0/));
        assert(bkeys[0].when.match(/biz < 10/));
        assert.equal(bkeys[0].args.do[0].computedArgs?.select, "prefix.startsWith('u')");
        assert.equal(defItems[0].args.do[0].computedArgs?.value, "count");

        let ckeys = defItems.filter(x => x.key === "c" && x.args.kind === "barkind");
        assert.equal(ckeys.length, 1);
        assert(ckeys[0].when.match(/baz > 0/));
        assert(!ckeys[0].when.match(/biz < 10/));
    });

    test('Detects duplicate path ids', () => {
        assert.throws(() => specForBindings(`
            [header]
            version = "1.0"

            [[path]]
            id = "foo"
            name = "Foo"

            [[path]]
            id = "foo"
            name = "FooAgain"

            [[bind]]
            path = "foo"
            name = "1"
            key = "a"
            kind = "do"
            command = "fooDo"
        `), { message: 'Unexpected parsing failure!: Validation error: Defined [[path]] entries must all have unique \'id\' fields. at "path"'});
    });

    test('Multi-key bindings expand to individual bindings', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "1"
        key = ["a", "b", "c", "d", "e"]
        kind = "all"
        command = "type"
        args.text = "{key}"
        `);

        assert.equal(spec.length, 5);
        assert(isEqual(spec.map(x => x.key), ["a", "b", "c", "d", "e"]));
        assert(isEqual(spec.map(x => x.args.do[0].args.text), ["a", "b", "c", "d", "e"]));
    });

    test('`key` value is validated', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "1"
        key = "Cmd+a"
        kind = "all"
        command = "foo"

        // TODO: make each of these a separate binding spec

        [[bind]]
        path = "bind"
        name = "2"
        key = ":"
        kind = "all"
        command = "foo"

        [[bind]]
        path = "bind"
        name = "2"
        key = "k+f"
        kind = "all"
        command = "foo"

        [[bind]]
        path = "bind"
        name = "2"
        key = "F"
        kind = "all"
        command = "foo"
        `);
    })

    // TODO: verify that duplicates are detected
    // NOTE: we need to make two changes:
    // 1. don't showErrorMessage throughout parsing code, wait until the end,
    //   this will make it easier to test this methods without UX
    // 2. we want to implement the fix to split out keys so that there is one per mode
    // it is supported by (since this will simplify duplicate handling)

});
