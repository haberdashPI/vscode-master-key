// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { enterModalKeys, setBindings, setupEditor, movesCursorInEditor, storeCoverageStats } from './utils.mts';
import { InputBox, sleep, TextEditor, Workbench } from 'wdio-vscode-service';
import { Key } from "webdriverio";

describe('Palette', () => {
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
            key = "shift+,"
            resetTransient = false
            hideInPalette = true
            prefixes = []
            mode = "normal"
            command = "master-key.commandPalette"

            [[bind]]
            name = "show palette"
            key = "shift+;"
            resetTransient = false
            hideInPalette = true
            prefixes = []
            mode = "normal"
            command = "master-key.commandSuggestions"

            [[bind]]
            path = "motion"
            name = "funny right"
            key = "w w"
            mode = "normal"
            args.to = "right"

            [[bind]]
            name = "toggle palette"
            key = "p"
            mode = "normal"
            command = "master-key.togglePaletteDelay"
        `);
        editor = await setupEditor(`A simple test`);
        workbench = await browser.getWorkbench();
    });

    it('Shows All Bindings', async() => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await enterModalKeys({key: ['shift', ';'], updatesStatus: false});
        const input = await (new InputBox(workbench.locatorMap)).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(7)
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

    it('Can be displayed after delay', async () => {
        await enterModalKeys('escape');
        await enterModalKeys('p');

        await enterModalKeys({key: 'w', updatesStatus: false});
        await sleep(1500); // give time for palette to show up

        const input = await (new InputBox(workbench.locatorMap)).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(1);

        await browser.keys(Key.Escape);
        await browser.keys('p');
        await enterModalKeys('i');
        await sleep(1000);
    });

    it('Changes with new bindings', async () => {
        await sleep(1000);
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

        await enterModalKeys('escape');
        await sleep(1000);

        await enterModalKeys({key: ['shift', ';'], updatesStatus: false});
        const input = await (new InputBox(workbench.locatorMap)).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(3);
        expect(await picks[0].getLabel()).toEqual("J");
        expect(await picks[0].getDescription()).toEqual("down");
        expect(await picks[1].getLabel()).toEqual("K");
        expect(await picks[1].getDescription()).toEqual("up");
        expect(await picks[2].getLabel()).toEqual("I");
        expect(await picks[2].getDescription()).toEqual("insert mode");
    })

    // NOTE: it would be ideal if we could also test how the palette interacts with typing
    // when there is a delay set, and in the two distinct modes (searching or keybinding).
    // However the way focus and typing work with chromedriver does not replicate actual UX
    // interactions as a user at least as far as I can tell, so this behavior cannot
    // currently be automated.

    after(async () => {
        await storeCoverageStats('palette');
    });
});
