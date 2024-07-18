// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, storeCoverageStats } from './utils.mts';
import { InputBox, sleep, TextEditor, Workbench } from 'wdio-vscode-service';
import { Key } from "webdriverio";

describe('Visual Docs', () => {
    let editor: TextEditor;
    let workbench: Workbench;
    before(async () => {
        await setBindings(`
            [header]
            version = "1.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

            [[kind]]
            name = "left"
            description = "more leftward keys"

            [[kind]]
            name = "right"
            description = "more rightward keys"

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "master-key.enterNormal"
            prefixes = "<all-prefixes>"
            hideInPalette = true

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
            kind = "left"

            [[bind]]
            path = "motion"
            name = "right"
            key = "l"
            args.to = "right"
            kind = "right"

            [[bind]]
            path = "motion"
            name = "down"
            key = "j"
            args.to = "down"
            kind = "left"

            [[bind]]
            path = "motion"
            name = "up"
            key = "k"
            args.to = "up"
            kind = "right"

            [[bind]]
            name = "insert mode"
            key = "i"
            command = "master-key.enterInsert"
            mode = "normal"
            kind = "right"
        `);
        editor = await setupEditor(`A simple test`);
        workbench = await browser.getWorkbench();
    });

    it('Labels Keys', async() => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await workbench.executeCommand("Master Key: Show Visual Documentation")
        await sleep(1000);

        const hKey = await browser.$('div.key > div.bottom=left');
        expect(await hKey).toHaveText('left');

        const jKey = await browser.$('div.key > div.bottom=down');
        expect(await jKey).toHaveText('down');

        const kKey = await browser.$('div.key > div.bottom=up');
        expect(await kKey).toHaveText('up');

        const lKey = await browser.$('div.key > div.bottom=right');
        expect(await lKey).toHaveText('right');
    });

    it('Colors Keys', async() => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await workbench.executeCommand("Master Key: Show Visual Documentation")

        const hKey = await browser.$('div.key > div.bottom=h');
        const hClasses = await hKey.getAttribute('class')
        expect(hClasses).toMatch('kind-color-1')

        const jKey = await browser.$('div.key > div.bottom=j');
        const jClasses = await jKey.getAttribute('class')
        expect(jClasses).toMatch('kind-color-1')

        const kKey = await browser.$('div.key > div.bottom=k');
        const kClasses = await kKey.getAttribute('class')
        expect(kClasses).toMatch('kind-color-2')

        const lKey = await browser.$('div.key > div.bottom=l');
        const lClasses = await lKey.getAttribute('class')
        expect(lClasses).toMatch('kind-color-2')
    });

    // NOTE: it would be ideal if we could also test how the palette interacts with typing
    // when there is a delay set, and in the two distinct modes (searching or keybinding).
    // However the way focus and typing work with chromedriver does not replicate actual UX
    // interactions as a user at least as far as I can tell, so this behavior cannot
    // currently be automated.

    after(async () => {
        await storeCoverageStats('visualDoc');
    });
});
