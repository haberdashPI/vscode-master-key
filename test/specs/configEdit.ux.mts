// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { setBindings, setupEditor, storeCoverageStats } from './utils.mts';
import { TextEditor } from 'wdio-vscode-service';
import { sleep } from 'wdio-vscode-service';


describe('Configuration Editing', () => {
    let editor: TextEditor;

    it.only('Can create editable copy', async () => {
        editor = await setupEditor(`A simple test`);
        await sleep(200);
        await editor.moveCursor(1, 1);

        console.log('[DEBUG]: call `Edit Preset Copy`')
        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Edit Preset Copy');
        await input.setText('Larkin');
        await input.confirm();

        console.log('[DEBUG]: obtain editor object of preset copy')
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

        console.log('[DEBUG]: click editor')
        copyEditor.moveCursor(1, 1);

        console.log('[DEBUG]: getting text')
        const copyEditorText = await copyEditor.getText();
        expect(copyEditorText).toMatch(/name = "Larkin Key Bindings"/);
    });

    it('Can copy user config', async () => {
        console.log('[DEBUG]: copy user config test');
        if (!editor) {
            editor = await setupEditor(`A simple test`);
            await sleep(200);
        }
        await editor.moveCursor(1, 1);

        const workbench = await browser.getWorkbench();
        await workbench.executeCommand('Master Key: Remove Keybindings');

        const editorView = await workbench.getEditorView();
        const keyEditor = await editorView.openEditor("keybindings.json") as TextEditor;

        if (keyEditor) {
            keyEditor.setText(`[
                {
                    "key": "ctrl+g",
                    "command": "foo"
                }
            ]`);
            await keyEditor.save();
            await sleep(200);

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
            await sleep(100);
            await input.setText("Markdown");
            await input.confirm();

            await workbench.executeCommand('Master Key: Import User Bindings');
            await sleep(100);
            const bindingText = await bindingEditor.getText();
            expect(bindingText).toMatch(/key\s*=\s*"ctrl\+h"/);
            expect(bindingText).toMatch(/key\s*=\s*"ctrl\+g"/);
            expect(bindingText).not.toMatch(/key\s*=\s*"ctrl\+c"/);
        } else {
            expect(false).toBeTruthy();
        }
    });

    after(async () => {
        // since we're messing with bindings, we need to setup a clean state that will
        // ensure the coverage command is available
        await setBindings(`
            [header]
            version = "1.0"

        `);

        await storeCoverageStats('config');
    });
});
