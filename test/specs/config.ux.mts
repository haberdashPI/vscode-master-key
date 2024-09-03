// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, waitForMode, storeCoverageStats } from './utils.mts';
import { StatusBar, TextEditor } from 'wdio-vscode-service';
import { Key } from "webdriverio";
import { sleep } from 'wdio-vscode-service';

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
            cursorShape = "Block"

            [[bind]]
            name = "normal mode"
            key = "escape"
            mode = []
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
            name = "right"
            key = "ctrl+l"
            args.to = "right"

            [[bind]]
            name = "insert"
            key = "ctrl+i"
            command = "master-key.enterInsert"
        `);
    });

    it('Can make normal mode the default', async() => {
        const workbench = await browser.getWorkbench();
        const statusBar = await (new StatusBar(workbench.locatorMap));
        const modeItem = await statusBar.getItem('Keybinding Mode: normal');
        expect(modeItem).toBeTruthy();

        await enterModalKeys(['ctrl', 'i']);
        editor = await setupEditor(`A simple test`);
        await enterModalKeys('escape');
        await movesCursorInEditor(() => enterModalKeys(['ctrl', 'l']), [0, 1], editor);
    });

    it('Correctly sets normal mode appearance', async () => {
        // check appearance of cursor and status bar
        const cursorEl = await browser.$('div[role="presentation"].cursors-layer');
        const cursorClasses = await cursorEl.getAttribute('class');
        expect(cursorClasses).toMatch(/cursor-block-style/);
        const statusBarEl = await browser.$('div[aria-label="Keybinding Mode: normal"]');
        const statusBarClasses = await statusBarEl.getAttribute('class');
        expect(statusBarClasses).toMatch(/warning-kind/);
    });

    it('Can allow switch to insert mode', async() => {
        await editor.moveCursor(1, 1);
        await enterModalKeys(['ctrl', 'i']);
        await waitForMode('insert');
        await browser.keys('i');
        expect(await editor.getText()).toEqual('iA simple test');
    });

    it('Correctly sets insert mode appearance', async () => {
        // check appearance of cursor and status bar
        const cursorEl = await browser.$('div[role="presentation"].cursors-layer');
        const cursorClasses = await cursorEl.getAttribute('class');
        expect(cursorClasses).toMatch(/cursor-line-style/);
        const statusBarEl = await browser.$('div[aria-label="Keybinding Mode: insert"]');
        const statusBarClasses = await statusBarEl.getAttribute('class');
        expect(statusBarClasses).not.toMatch(/warning-kind/);
    });

    it('Can be removed', async () => {
        const workbench = await browser.getWorkbench();
        await workbench.executeCommand('Master Key: Remove Keybindings');
        await waitForMode('default');

        const statusBarEl = await browser.$('div[aria-label="Keybinding Mode: default"]');
        const statusBarClasses = await statusBarEl.getAttribute('class');
        expect(statusBarClasses).not.toMatch(/warning-kind/);

        const cursorEl = await browser.$('div[role="presentation"].cursors-layer');
        const cursorClasses = await cursorEl.getAttribute('class');
        expect(cursorClasses).toMatch(/cursor-line-style/);
    });

    after(async () => {
        await storeCoverageStats('config');
    });
});
