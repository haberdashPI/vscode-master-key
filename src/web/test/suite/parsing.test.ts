import assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import { processBindings } from '../../keybindings/processing';
import { parseBindings } from '../../keybindings/parsing';
import { activate as bindingActivate, queryPreset, updatePresets } from '../../keybindings/index';

import { fromZodError } from 'zod-validation-error';
import { sortBy, isEqual, isUndefined } from 'lodash';

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
        default.computedArgs.value = "count"
        when = "baz > 0"

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

    test('Defaults and when expand recursively', () => {
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
        foreach.key = ['{key: [a-e]}']
        key = "{key}"
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


    test('prefixes are validated', () => {
        assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "2"
        key = "k"
        kind = "all"
        prefixes = ["foobar", ""]
        command = "foo"
        `), {message: /foobar/});
    });

    test('prefixes must be transient', () => {
        assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "2"
        key = "k"
        kind = "all"
        command = "master-key.prefix"
        resetTransient = true
        `), {message: /'resetTransient' must be false/});

        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "2"
        key = "k"
        kind = "all"
        command = "master-key.prefix"

        [[bind]]
        path = "bind"
        name = "3"
        key = "j"
        kind = "all"
        command = "bob"
        `);
        assert.equal(spec.length, 2);
        assert(!spec[0].args.resetTransient);
        assert(spec[1].args.resetTransient);
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
        `), {message: /Duplicate bindings for 'a' in mode 'default'/});

        assert.throws(() => specForBindings(`
        [header]
        version = "1.0"

        [[mode]]
        name = "default"
        default = true

        [[mode]]
        name = "normal"

        [[path]]
        id = "bind"
        name = "All Bindings"

        [[bind]]
        path = "bind"
        name = "1"
        key = "a"
        kind = "all"
        mode = "!default"
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

    test('Multiple foreach create a product', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[bind]]
        name = "1"
        foreach.key = ['{key: [0-9]}']
        foreach.mod = ['shift', 'cmd']
        key = "{mod}+{key}"
        command = "foo"
        `);
        assert.equal(spec.length, 20);
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

    test('Documentation expands across key variants', () => {
        let spec = specForBindings(`
        [header]
        version = "1.0"

        [[bind]]
        path = ""
        name = "a"
        description = "boop"
        combinedName = "boop/aba"
        combinedDescription = "boop/aba daba do"
        combinedKey = "a/b"
        key = "k"
        when = "biz > 5"
        command = "do"

        [[bind]]
        path = ""
        name = "a"
        key = "k"
        when = "biz < 5"
        command = "do"

        [[bind]]
        path = ""
        name = "a"
        key = "h k"
        when = "biz > 5"
        command = "do"
        `);

        assert(isEqual(spec.length, 4));
        assert(isEqual(spec[0].args.description, spec[1].args.description));
        assert(isEqual(spec[0].args.combinedKey, spec[1].args.combinedKey));
        assert(isEqual(spec[0].args.combinedName, spec[1].args.combinedName));
        assert(isEqual(spec[0].args.combinedDescription, spec[1].args.combinedDescription));
        assert(isUndefined(spec[3].args.description));
        assert(isEqual(spec[3].args.combinedKey, ""));
        assert(isEqual(spec[3].args.combinedName, ""));
        assert(isEqual(spec[3].args.combinedDescription, ""));
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
