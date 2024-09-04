// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, waitForMode, storeCoverageStats, setFileDialogText } from './utils.mts';
import { EditorView, InputBox, StatusBar, TextEditor } from 'wdio-vscode-service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sleep } from 'wdio-vscode-service';
import { Key } from 'webdriverio';


describe('Configuration', () => {
    let editor: TextEditor;
    let folder: string;
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

        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'master-key-test-'));

        const a_text = `
        [header]
        version = "1.0"
        name = "A bindings"

        [[mode]]
        name = "abind"
        default = true

        [[bind]]
        name = "left"
        key = "ctrl+l"
        command = "cursorMove"
        args.to = "left"
        `;


        const b_text = `
        [header]
        version = "1.0"
        name = "B bindings"

        [[bind]]
        name = "right"
        key = "ctrl+h"
        command = "cursorMove"
        args.to = "right"
        `

        const c_text = `
        [header]
        version = "1.0"
        name = "A bindings"

        [[mode]]
        name = "abind"
        default = true

        [[bind]]
        name = "left"
        key = "ctrl+d"
        command = "cursorMove"
        args.to = "left"
        `;

        fs.mkdirSync(path.join(folder, 'others'));
        fs.writeFileSync(path.join(folder, 'a.toml'), a_text);
        fs.writeFileSync(path.join(folder, 'b.toml'), b_text);
        fs.writeFileSync(path.join(folder, 'others', 'c.toml'), c_text)
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
        if(!editor){
            editor = await setupEditor(`A simple test`);
        }

        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Master Key: Activate Keybindings');
        await sleep(500);
        await input.setText('Directory...');
        await input.confirm();

        await setFileDialogText(folder+"/");
        const bindingInput = await (new InputBox(workbench.locatorMap)).wait();
        const items = await bindingInput.getQuickPicks();

        const labels = [];
        for(const it of items){
            labels.push(await it.getLabel());
        }
        expect(labels).toContain('A bindings');
        expect(labels).toContain('B bindings');
    });

    it('Can be loaded from a directory', async () => {
        if(!editor){
            editor = await setupEditor(`A simple test`);
        }

        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Master Key: Activate Keybindings');
        await sleep(500);
        await input.setText('Directory...');
        await input.confirm();

        await setFileDialogText(path.join(folder, "others"));
        const bindingInput = await (new InputBox(workbench.locatorMap)).wait();
        const items = await bindingInput.getQuickPicks();

        const labels = [];
        for(const it of items){
            labels.push(await it.getLabel());
        }
        expect(labels).toContain('A bindings (1)');
        expect(labels).toContain('A bindings (2)');
        expect(labels).toContain('B bindings');
    });

    it('Can load from a file', async () => {
        if(!editor){
            editor = await setupEditor(`A simple test`);
        }

        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Master Key: Activate Keybindings');
        await sleep(500);
        await input.setText('File...');
        await input.confirm();

        await setFileDialogText(path.join(folder, 'a.toml'));
        const statusBar = await (new StatusBar(workbench.locatorMap));
        const modeItem = await statusBar.getItem('Keybinding Mode: abind');
        expect(modeItem).toBeTruthy();
    });

    it('Can add user bindings', async () => {
        const userFile = `
        [[bind]]
        name = "right"
        key = "ctrl+h"
        command = "cursorMove"
        args.to = "right"
        `;
        fs.writeFileSync(path.join(folder, 'user.toml'), userFile);

        editor = await setupEditor(`A simple test`);

        const workbench = await browser.getWorkbench();
        await workbench.executeCommand('Master Key: Activate User Keybindings');
        await setFileDialogText(path.join(folder, 'user.toml'));

        await editor.moveCursor(1, 1);
        await sleep(200);

        await movesCursorInEditor(async () => {
            await enterModalKeys(['ctrl', 'h']);
        }, [0, 1], editor);
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

    it('Can prevent user binding update absent a preset', async () => {
        if(!editor) {
            editor = await setupEditor(`A simple test`);
        }
        await editor.moveCursor(1, 1);


        const workbench = await browser.getWorkbench();
        await workbench.executeCommand('Master Key: Remove Keybindings');
        await waitForMode('default');

        const userFile = `
        [[bind]]
        name = "right"
        key = "ctrl+h"
        command = "cursorMove"
        args.to = "right"
        `;
        fs.writeFileSync(path.join(folder, 'user.toml'), userFile);

        await workbench.executeCommand('Master Key: Activate User Keybindings');
        await setFileDialogText(path.join(folder, 'user.toml'));

        let notifs = await workbench.getNotifications();
        let messages = await Promise.all(notifs.map(n => n.getMessage()));
        let error = 'User bindings have not been activated ' +
        'because you have no preset keybindings. Call `Master Key: `' +
        'Activate Keybindings` to add a preset.'

        expect(messages).toContainEqual(error);
    });

    it('Can create editable copy', async () => {
        if(!editor) {
            editor = await setupEditor(`A simple test`);
        }
        await editor.moveCursor(1, 1);

        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Edit Preset Copy');
        await input.setText('Larkin');
        await input.confirm();

        const editorView = await workbench.getEditorView();
        await sleep(500);
        const title = await browser.waitUntil(async () => {
            let tab = await editorView.getActiveTab();
            const title = await tab?.getTitle();
            if(title && title.match(/Untitled/)){
                return title;
            }
            return;
        }, { interval: 1000, timeout: 10000 });
        const copyEditor = await editorView.openEditor(title!) as TextEditor;

        const copyEditorText = await copyEditor.getText();
        expect(copyEditorText).toMatch(/name = "Larkin Key Bindings"/);
    });

    it.only('Can copy user config', async () => {
        if(!editor) {
            editor = await setupEditor(`A simple test`);
        }
        await editor.moveCursor(1, 1);

        const workbench = await browser.getWorkbench();
        await workbench.executeCommand('Master Key: Remove Keybindings');

        const editorView = await workbench.getEditorView();
        const keyEditor = await editorView.openEditor("keybindings.json") as TextEditor;

        if(keyEditor){
            keyEditor.setText(`[
                {
                    "key": "ctrl+g",
                    "command": "foo"
                }
            ]`);
            await keyEditor.save();
            await sleep(10000);

            await setBindings(`
                [header]
                version = "1.0"
                name = "Some Bindings"

                [[bind]]
                key = "ctrl+c"
                command = "bar"
            `)

            const bindingEditor = await setupEditor(`
                [header]
                version = "1.0"
                name = "Some New Bindings"

                [[bind]]
                key = "ctrl+h"
                command = "baz"
            `)
            const workbench = await browser.getWorkbench();
            let input = await workbench.executeCommand('Select Language Mode');
            await sleep(500);
            await input.setText("Markdown");
            await input.confirm();

            await workbench.executeCommand('Master Key: Import User Bindings');
            const bindingText = await bindingEditor.getText();
            expect(bindingText).toMatch(/key\s*=\s*"ctrl\+h"/);
            expect(bindingText).toMatch(/key\s*=\s*"ctrl\+g"/);
            expect(bindingText).not.toMatch(/key\s*=\s*"ctrl\+c"/);
        }else{
            expect(false).toBeTruthy();
        }
    })

    after(async () => {
        await storeCoverageStats('config');
    });
});
