// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, waitForMode } from './utils.mts';
import { StatusBar, TextEditor } from 'wdio-vscode-service';
import { Key } from "webdriverio";

describe('Configuration', () => {
    let editor: TextEditor;
    before(async () => {
        await setBindings(`
            [header]
            version = "1.0"

            [[mode]]
            name = "insert"

            [[mode]]
            name = "normal"
            default = true
            highlight = "Highlight"

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "master-key.enterNormal"
            prefixes = "<all-prefixes>"

            [[path]]
            id = "motion"
            name = "basic motions"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count"

            [[bind]]
            path = "motion"
            name = "left"
            key = "h"
            args.to = "left"

            [[bind]]
            name = "insert"
            key = "i"
            command = "master-key.enterInsert"
        `);
        editor = await setupEditor(`A simple test`);
    });

    it('Can make normal mode the default', async() => {
        const workbench = await browser.getWorkbench();
        const statusBar = await (new StatusBar(workbench.locatorMap));
        const modeItem = await statusBar.getItem('Keybinding Mode: normal');
        expect(modeItem).toBeTruthy();
        console.log('[DEBUG]: '+modeItem?.getCSSProperty('background-color'));
        await movesCursorInEditor(() => enterModalKeys('h'), [0, -1], editor);
    });

    it('Can allow switch to insert mode', async() => {
        await movesCursorInEditor(() => enterModalKeys('i'), [0, -1], editor);
        await waitForMode('insert');
    });

});
