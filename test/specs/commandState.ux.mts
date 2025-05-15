// start with just some basic tests to verify all is well

import {browser, expect} from '@wdio/globals';
import {Key} from 'webdriverio';
import {
    setBindings,
    setupEditor,
    movesCursorInEditor,
    enterModalKeys,
    storeCoverageStats,
    waitForClearedKeyStatus,
} from './utils.mts';
import 'wdio-vscode-service';
import {sleep, TextEditor} from 'wdio-vscode-service';

describe('Command State', () => {
    let editor: TextEditor;
    before(async () => {
        await setBindings(`
            [header]
            version = "2.0"

            [define]
            select_on = false

            [[mode]]
            name = "default"
            default = true

            [[mode]]
            name = "left"

            [[bind]]
            name = "left mode"
            key = "ctrl+shift+l"
            command = "master-key.setMode"
            args.value = "left"

            [[bind]]
            name = "default mode"
            key = "escape"
            command = "master-key.setMode"
            args.value = "default"
            mode = []

            [[bind]]
            name = "move right"
            key = "ctrl+h shift+ctrl+1"
            command = "cursorMove"
            args.to = "right"
            when = "editorTextFocus"

            [[bind]]
            name = "move left"
            mode = "left"
            key = "ctrl+h shift+ctrl+1"
            command = "cursorMove"
            args.to = "left"
            when = "editorTextFocus"

            [[bind]]
            name = "hold select"
            key = "shift+alt+l"
            mode = ["left", "default"]
            command = "master-key.setFlag"
            args.name = "select_on"
            args.value = true

            [[bind]]
            name = "prepare select"
            key = "ctrl+l"
            mode = ["left", "default"]
            command = "master-key.prefix"
            args.flag = "select_on"
            finalKey = false

            [[default]]
            id = "word"
            name = "word"
            default.prefixes = ["", "ctrl+l"]

            [[bind]]
            defaults = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select_on"
            command = "cursorWordEndRight"

            [[bind]]
            defaults = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select_on"
            mode = "left"
            command = "cursorWordLeft"

            [[bind]]
            defaults = "word"
            key = "ctrl+shift+w"
            when = "master-key.select_on"
            command = "cursorWordEndRightSelect"

            [[bind]]
            name = "delete"
            key = "ctrl+shift+d"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.prefix"
            args.cursor = "Underline"

            [[bind.args.commands]]
            command = "master-key.storeCommand"
            args.command = "deleteRight"
            args.register = "operation"

            [[bind]]
            name = "word motion"
            key = "ctrl+e"
            prefixes = ["ctrl+shift+d"] # this is simply to demonstrate that we could include all operator prefixes here
            command = "runCommands"

            [[bind.args.commands]]
            command = "cursorWordEndRightSelect"

            [[bind.args.commands]]
            command = "master-key.executeStoredCommand"
            args.register = "operation"

            [[bind]]
            defaults = "word"
            key = "ctrl+h ctrl+shift+w"
            command = "notACommand"

            [[bind]]
            defaults = "word"
            key = "ctrl+shift+w"
            mode = "left"
            when = "master-key.select_on"
            command = "cursorWordLeftSelect"
        `);
        editor = await setupEditor('This is a short, simple sentence');
    });

    it('Handles Automated Prefixes', async () => {
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['ctrl', 'h'], ['shift', 'ctrl', '1']);
            },
            [0, 1],
            editor
        );
    });

    it('Handles Flagged Prefixs', async () => {
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['ctrl', 'shift', 'w']);
            },
            [0, 4],
            editor
        );

        await enterModalKeys(['ctrl', 'l'], ['ctrl', 'shift', 'w']);
        expect(await editor.getSelectedText()).toEqual(' is');
    });

    it('Handles flag setting', async () => {
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['ctrl', 'shift', 'w']);
            },
            [0, 4],
            editor
        );

        await enterModalKeys(['shift', 'alt', 'l']);
        await enterModalKeys(['ctrl', 'shift', 'w']);
        expect(await editor.getSelectedText()).toEqual(' is');
    });

    it('Resets state on error', async () => {
        await editor.moveCursor(1, 1);

        await enterModalKeys(['ctrl', 'h'], ['ctrl', 'shift', 'w']);
        const workbench = await browser.getWorkbench();
        const notifs = await workbench.getNotifications();
        const messages = await Promise.all(notifs.map(n => n.getMessage()));
        expect(messages).toContainEqual("command 'notACommand' not found");

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['ctrl', 'h'], ['shift', 'ctrl', '1']);
            },
            [0, 1],
            editor
        );
    });

    it('Allows key mode to changes commands', async () => {
        await editor.moveCursor(1, 6);
        await enterModalKeys(['ctrl', 'shift', 'l']);

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['ctrl', 'h'], ['shift', 'ctrl', '1']);
            },
            [0, -1],
            editor
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['ctrl', 'shift', 'w']);
            },
            [0, -4],
            editor
        );

        await editor.moveCursor(1, 5);
        await enterModalKeys(['ctrl', 'l'], ['ctrl', 'shift', 'w']);
        expect(await editor.getSelectedText()).toEqual('This');
        await enterModalKeys('escape');
    });

    it('Can run stored commands', async () => {
        await editor.moveCursor(1, 1);
        await sleep(1000);
        await enterModalKeys(['ctrl', 'shift', 'd'], ['ctrl', 'e']);
        expect(await editor.getText()).toEqual(' is a short, simple sentence');

        await sleep(250);
        await browser.keys([Key.Ctrl, Key.Shift, 'd']);
        await sleep(1000);
        const cursorEl = await browser.$('div[role="presentation"].cursors-layer');
        const cursorClasses = await cursorEl.getAttribute('class');
        expect(cursorClasses).toMatch(/cursor-underline-style/);

        await sleep(2000);
        browser.keys([Key.Control, 'e']);
        await waitForClearedKeyStatus([
            ['ctrl', 'shift', 'd'],
            ['ctrl', 'e'],
        ]);
        const cursorEl2 = await browser.$('div[role="presentation"].cursors-layer');
        const cursorClasses2 = await cursorEl2.getAttribute('class');
        expect(cursorClasses2).toMatch(/cursor-line-style/);

        expect(await editor.getText()).toEqual(' a short, simple sentence');
    });

    after(async () => {
        await storeCoverageStats('commandState');
    });
});
