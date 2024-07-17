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
            name = "left keys"
            description = "more leftward keys"

            [[kind]]
            name = "right keys"
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

    it('Shows All Bindings', async() => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await workbench.executeCommand("Master Key: Show Visual Documentation")

        const keyEl = await browser.$('');

        expect(await picks[0].getLabel()).toEqual("H");
        expect(await picks[0].getDescription()).toEqual("left");
        expect(await picks[1].getLabel()).toEqual("L");
        expect(await picks[1].getDescription()).toEqual("right");
        expect(await picks[2].getLabel()).toEqual("J");
        expect(await picks[2].getDescription()).toEqual("down");
        expect(await picks[3].getLabel()).toEqual("K");
        expect(await picks[3].getDescription()).toEqual("up");
        expect(await picks[4].getLabel()).toEqual("I");
        expect(await picks[4].getDescription()).toEqual("insert mode");
        await enterModalKeys('i');
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
