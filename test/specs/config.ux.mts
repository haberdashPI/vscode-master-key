// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, waitForMode, storeCoverageStats } from './utils.mts';
import { InputBox, StatusBar, TextEditor } from 'wdio-vscode-service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sleep } from 'wdio-vscode-service';
import { Key } from 'webdriverio';


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

    it('Can be loaded from a directory', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'master-key-test-'));
        const a_text = `
        [header]
        version = "1.0"

        [[bind]]
        name = "left"
        key = "ctrl+l"
        command = "cursorMove"
        args.to = "left"
        `;

        const b_text = `
        [header]
        version = "1.0"

        [[bind]]
        name = "right"
        key = "ctrl+h"
        command = "cursorMove"
        args.to = "right"
        `

        fs.writeFileSync(path.join(folder, 'a.toml'), a_text);
        fs.writeFileSync(path.join(folder, 'b.toml'), b_text);

        if(!editor){
            editor = await setupEditor(`A simple test`);
        }

        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Master Key: Activate Keybindings');
        await sleep(500);
        await input.setText('Directory...');
        await input.confirm();

        const fileInput = await (new InputBox(workbench.locatorMap)).wait();
        await sleep(100);
        // clearing text for this input box seems to work a little differently than the
        // normal up, so we have to manually remove the text before setting the text
        const input_ = await fileInput.inputBox$.$(fileInput.locators.input)
        await input_.click();
        await browser.keys([Key.Ctrl, 'a'])
        await browser.keys(Key.Backspace);
        await sleep(100);
        await fileInput.setText(folder+"/");
        // confirmation is also flakey
        await sleep(100);
        await fileInput.confirm();
        await sleep(100);
        try {
            fileInput.confirm();
        } catch(e) {
            console.dir(e);
        }

        const bindingInput = await (new InputBox(workbench.locatorMap)).wait();
        const items = await bindingInput.getQuickPicks();
        const toml = [];
        for(const it of items){
            const label = await it.getLabel();
            console.log('[DEBUG] item label: '+label);
            if (/\.toml$/.test(label)) {
                toml.push(label)
            }
        }
        expect(toml).toContain('a.toml');
        expect(toml).toContain('b.toml');
    })

    // TODO: proper handling of duplicate names

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
