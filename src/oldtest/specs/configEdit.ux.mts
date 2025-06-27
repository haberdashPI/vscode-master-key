// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import {
    clearNotifications,
    getEditorMatching,
    setBindings,
    setupEditor,
    storeCoverageStats,
} from './utils.mts';
import { TextEditor } from 'wdio-vscode-service';
import { sleep } from 'wdio-vscode-service';

describe('Configuration Editing', () => {
    it('Can create editable copy', async () => {
        const workbench = await browser.getWorkbench();
        const input = await workbench.executeCommand('Edit Preset Copy');
        await input.setText('Larkin');
        await input.confirm();
        await clearNotifications(workbench);

        const copyEditor = await getEditorMatching(workbench, /Untitled/);
        const copyEditorText = await copyEditor.getText();
        expect(copyEditorText).toMatch(/name = "Larkin"/);
    });

    it('Can copy user config', async () => {
        const workbench = await browser.getWorkbench();
        await browser.executeWorkbench((vscode) => {
            vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
        });

        const editorView = await workbench.getEditorView();
        const keyEditor = (await editorView.openEditor('keybindings.json')) as TextEditor;

        if (keyEditor) {
            keyEditor.setText(`[
                {
                    "key": "ctrl+g",
                    "command": "foo"
                }
            ]`);
            await keyEditor.save();
            await sleep(200);

            console.log('[DEBUG]: setting bindings');
            await setBindings(`
                [header]
                version = "2.0"
                name = "Some Bindings"

                [[bind]]
                key = "ctrl+l"
                command = "bar"
            `);

            await sleep(200);

            console.log('[DEBUG]: creating new binding setup');
            const bindingEditor = await setupEditor(`
                [header]
                version = "2.0"
                name = "Some New Bindings"

                [[bind]]
                key = "ctrl+h"
                command = "baz"
            `);

            const workbench = await browser.getWorkbench();
            const input = await workbench.executeCommand('Select Language Mode');
            await sleep(100);
            await input.setText('Markdown');
            await input.confirm();

            await workbench.executeCommand('Master Key: Import User Bindings');
            await sleep(100);
            const bindingText = await bindingEditor.getText();
            expect(bindingText).toMatch(/key\s*=\s*"ctrl\+h"/);
            expect(bindingText).toMatch(/key\s*=\s*"ctrl\+g"/);
            expect(bindingText).not.toMatch(/key\s*=\s*"ctrl\+l"/);
        } else {
            expect(false).toBeTruthy();
        }
    });

    after(async () => {
        const workbench = await browser.getWorkbench();
        await workbench.executeCommand('Clear Command History');
        await workbench.executeCommand('Master Key: Deactivate Keybindings');

        // since we're messing with bindings, we need to setup a clean state that will
        // ensure the coverage command is available
        await setBindings(`
            [header]
            version = "2.0"

        `);

        await storeCoverageStats('config');
    });
});
