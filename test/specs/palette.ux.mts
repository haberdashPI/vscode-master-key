// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, storeCoverageStats } from './utils.mts';
import { InputBox, TextEditor, Workbench } from 'wdio-vscode-service';
import { Key } from "webdriverio";

describe('Simple Motions', () => {
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

            [[bind]]
            path = "motion"
            name = "right"
            key = "l"
            args.to = "right"

            [[bind]]
            path = "motion"
            name = "down"
            key = "j"
            args.to = "down"

            [[bind]]
            path = "motion"
            name = "up"
            key = "k"
            args.to = "up"

            [[bind]]
            name = "insert mode"
            key = "i"
            command = "master-key.enterInsert"
            mode = "normal"

            [[bind]]
            name = "show palette"
            key = "shift+;"
            resetTransient = false
            hideInPalette = true
            prefixes = []
            mode = "normal"
            command = "master-key.commandSuggestions"
        `);
        editor = await setupEditor(`A simple test`);
        workbench = await browser.getWorkbench();
    });

    it('Palette Shows All Bindings', async() => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await enterModalKeys({key: ['shift', ';'], updatesStatus: false});
        const input = await (new InputBox(workbench.locatorMap)).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(6);
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
    });

    after(async () => {
        await storeCoverageStats('simpleMotion');
    });
});
