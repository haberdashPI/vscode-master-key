// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import {
    enterModalKeys,
    movesCursorInEditor,
    setBindings,
    setupEditor,
    storeCoverageStats,
    waitForMode,
} from './utils.mts';
import { InputBox, sleep, TextEditor, Workbench } from 'wdio-vscode-service';
import { Key } from 'webdriverio';

describe('Palette', () => {
    let editor: TextEditor;
    let workbench: Workbench;
    before(async () => {
        await setBindings(`
            [header]
            version = "2.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "master-key.enterNormal"
            prefixes = "{{all_prefixes}}"
            hideInPalette = true

            [[default]]
            id = "motion"
            name = "basic motions"
            appendWhen = "editorTextFocus"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count"

            [[bind]]
            defaults = "motion"
            name = "left"
            combinedName = "left/right"
            combinedKey = "h/l"
            key = "h"
            args.to = "left"

            [[bind]]
            defaults = "motion"
            name = "right"
            combinedName = "left/right"
            key = "l"
            args.to = "right"

            [[bind]]
            defaults = "motion"
            name = "down"
            key = "j"
            args.to = "down"

            [[bind]]
            defaults = "motion"
            name = "up"
            key = "k"
            args.to = "up"

            [[bind]]
            name = "insert mode"
            key = "i"
            command = "master-key.enterInsert"
            when = "editorTextFocus"
            mode = "normal"

            [[bind]]
            name = "show palette"
            key = "shift+;"
            finalKey = false
            hideInPalette = true
            prefixes = []
            when = "editorTextFocus"
            mode = "normal"
            command = "master-key.commandSuggestions"

            [[bind]]
            defaults = "motion"
            name = "funny right"
            key = "w w"
            when = "editorTextFocus"
            mode = "normal"
            args.to = "right"

            [[bind]]
            name = "toggle palette"
            key = "p"
            mode = "normal"
            when = "editorTextFocus"
            command = "master-key.togglePaletteDelay"
        `);
        editor = await setupEditor('A simple test\nfor palettes');
        workbench = await browser.getWorkbench();
    });

    it('Shows All Bindings', async () => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await enterModalKeys({ key: ['shift', ';'], updatesStatus: false });
        const input = await new InputBox(workbench.locatorMap).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(6);
        expect(await picks[0].getLabel()).toEqual('H/L');
        expect(await picks[0].getDescription()).toEqual('left/right');
        expect(await picks[1].getLabel()).toEqual('J');
        expect(await picks[1].getDescription()).toEqual('down');
        expect(await picks[2].getLabel()).toEqual('K');
        expect(await picks[2].getDescription()).toEqual('up');
        expect(await picks[3].getLabel()).toEqual('I');
        expect(await picks[3].getDescription()).toEqual('insert mode');
        await enterModalKeys({ key: 'i', updatesStatus: false });
        await waitForMode('insert');
    });

    it('Can toggle modes', async () => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await enterModalKeys({ key: ['shift', ';'], updatesStatus: false });
        const input = await new InputBox(workbench.locatorMap).wait();
        await movesCursorInEditor(
            async () => {
                await browser.keys([Key.Control, '.']);
                await input.setText('down');
                await input.confirm();
            },
            [1, 0],
            editor,
        );
    });

    it('Can be displayed after delay', async () => {
        await browser.keys(Key.Escape);
        await enterModalKeys('p');

        await enterModalKeys({ key: 'w', updatesStatus: false });
        await sleep(2500); // give time for palette to show up

        const input = await new InputBox(workbench.locatorMap).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(1);

        await browser.keys(Key.Escape);
        await sleep(1000);
        await enterModalKeys('p');
        await enterModalKeys('i');
        await sleep(1000);
    });

    it('Changes with new bindings', async () => {
        await sleep(1000);
        await setBindings(`
            [header]
            version = "2.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "master-key.enterNormal"
            prefixes = "{{all_prefixes}}"
            hideInPalette = true

            [[default]]
            id = "motion"
            name = "basic motions"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count"

            [[bind]]
            defaults = "motion"
            name = "down"
            key = "j"
            args.to = "down"

            [[bind]]
            defaults = "motion"
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
            finalKey = false
            hideInPalette = true
            prefixes = []
            mode = "normal"
            command = "master-key.commandSuggestions"
        `);

        await browser.keys(Key.Escape);
        await sleep(1000);

        await enterModalKeys({ key: ['shift', ';'], updatesStatus: false });
        const input = await new InputBox(workbench.locatorMap).wait();
        const picks = await input.getQuickPicks();
        expect(picks).toHaveLength(3);
        expect(await picks[0].getLabel()).toEqual('J');
        expect(await picks[0].getDescription()).toEqual('down');
        expect(await picks[1].getLabel()).toEqual('K');
        expect(await picks[1].getDescription()).toEqual('up');
        expect(await picks[2].getLabel()).toEqual('I');
        expect(await picks[2].getDescription()).toEqual('insert mode');
    });

    // NOTE: it would be ideal if we could also test how the palette interacts with typing
    // when there is a delay set, and in the two distinct modes (searching or keybinding).
    // However the way focus and typing work with chromedriver does not replicate actual UX
    // interactions as a user at least as far as I can tell, so this behavior cannot
    // currently be automated.

    after(async () => {
        await storeCoverageStats('palette');
    });
});
