import assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import { processBindings } from '../../keybindingProcessing';
import { parseBindings } from '../../keybindingParsing';
import { fromZodError } from 'zod-validation-error';
import { sortBy, isEqual } from 'lodash';

function specForBindings(text: string) {
    let result = parseBindings(text, 'toml');
    if (result.success) {
        let data = processBindings(result.data);
        if (data) {
            let [spec, problems] = data;
            if(problems.length > 0){ throw new Error(problems[0]); }
            return spec.bind;
        }
    } else {
        throw new Error("Unexpected parsing failure!: " + fromZodError(result.error));
    }
    throw new Error("Unexpected parsing failure!");
}

suite('Keybinding Test Suite', () => {
    let simpleFile = `
        [header]
        version = "1.0"
        name = "test"
        description = "A simple test file"

        [[bind]]
        name = "foo"
        key = "Cmd+a"
        command = "fooCommand"

        [[bind]]
        name = "bar"
        key = "Cmd+b"
        command = "barCommand"
    `;
    test('Files can be parsed', () => {
        let result = parseBindings(simpleFile, 'toml');
        assert(result.success);
        let data = processBindings(result.data);
        assert(result.data);
        let [spec, defs] = data;
        assert(spec);
    });

    test('Typos are noted', () => {
        assert.throws(() => specForBindings(simpleFile.replace('description', 'descrption')),
            { message: /Unrecognized key\(s\) in object: 'descrption'/ });
        assert.throws(() => specForBindings(simpleFile.replace('header', 'headr')),
            { message: /Unrecognized key\(s\) in object: 'headr'/ });
        assert.throws(() => specForBindings(simpleFile.replace('name', 'nam')),
            { message: /Unrecognized key\(s\) in object: 'nam'/ });
        assert.throws(() => specForBindings(simpleFile.replace('bind', 'bnd')),
            { message: /Unrecognized key\(s\) in object: 'bnd'/ });
        assert.throws(() => specForBindings(simpleFile.replace('key', 'keye')),
            { message: /Unrecognized key\(s\) in object: 'keye'/ });
    });

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
        `), { message: /Defined \[\[path\]\] entries must all have unique 'id' fields/ });
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
        `);
        assert.equal(spec.length, 1);

         assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "2"
        key = ":"
        kind = "all"
        command = "foo"
        `), {message: /Invalid keybinding/});

       assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "2"
        key = "k+f"
        kind = "all"
        command = "foo"
        `), {message: /Invalid keybinding/});

        assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "2"
        key = "F"
        kind = "all"
        command = "foo"
        `), {message: /Invalid keybinding/});
    });


    test('Checks for duplicate bindings', () => {
        assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "1"
        key = "a"
        kind = "all"
        command = "foo"

        [[bind]]
        path = "bind"
        name = "2"
        key = "a"
        kind = "all"
        command = "foo"
        `), {message: /Duplicate bindings for 'a' in mode 'insert'/});

        assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [define]
        validModes = ["insert", "capture", "normal"]

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "1"
        key = "a"
        kind = "all"
        mode = "!insert"
        command = "foo"

        [[bind]]
        path = "bind"
        name = "2"
        key = "a"
        kind = "all"
        mode = "!normal"
        command = "foo"
        `), {message: /Duplicate bindings for 'a' in mode 'capture'/});

        let bindings = specForBindings(`
        [header]
        version = "1.0"

        [define]
        validModes = ["insert", "capture"]

        [[bind]]
        name = "1"
        key = "a b"
        kind = "all"
        when = "foobar"
        command = "foo"

        [[bind]]
        name = "2"
        key = "a c"
        kind = "all"
        when = "bizbaz"
        command = "foo"
        `);

        let prefixes = bindings.filter(x => x.args.do[0].command === 'master-key.prefix');
        assert.equal(prefixes.length, 2);
    });

    test('Keybindings with multiple presses are expanded into prefix bindings', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[bind]]
        name = "1"
        key = "a b c"
        command = "foo"
        `);
        assert.equal(spec.length, 3);
        assert.equal(spec.filter(x => x.args.do[0].command === "foo").length, 1);
        assert(isEqual(spec.map(x => x.key).sort(), ["a", "b", "c"]));
    });

    test('Automated prefixes are properly ordered', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[bind]]
        name = "before"
        key = "d"
        command = "bar"

        [[bind]]
        name = "1"
        key = "a b c"
        when = "bar"
        command = "foo"

        [[bind]]
        name = "2"
        key = "a b"
        command = "modal-key.prefix"
        args.flag = "ab_prefix"
        `);
        assert.equal(spec.length, 6);
        assert(isEqual(spec.map(i => i.key), ["d", "a", "b", "c", "a", "b"]));
        assert(isEqual(spec.map(i => !!(i.args.do[0]?.args?.automated)),
                       [false, true, true, false, true, false]));
    });

    test('Keybindings properly resolve `<all-pefixes>` cases', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[bind]]
        name = "1"
        key = "escape"
        prefixes = "<all-prefixes>"
        command = "enterNormal"
        `);
        assert.equal(spec.length, 1);
        assert.doesNotMatch(spec[0].when, /prefixCode/);
    });
});
