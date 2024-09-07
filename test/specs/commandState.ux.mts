// start with just some basic tests to verify all is well

import {browser, expect} from '@wdio/globals';
import {
    setBindings,
    setupEditor,
    movesCursorInEditor,
    enterModalKeys,
    storeCoverageStats,
} from './utils.mts';
import 'wdio-vscode-service';
import {TextEditor} from 'wdio-vscode-service';

describe('Command State', () => {
    let editor: TextEditor;
    before(async () => {
        await setBindings(`
            [header]
            version = "1.0"

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
            name = "prepare select"
            key = "ctrl+l"
            mode = ["left", "default"]
            command = "master-key.prefix"
            args.flag = "select_on"
            resetTransient = false

            [[path]]
            id = "word"
            name = "word"
            default.prefixes = ["", "ctrl+l"]

            [[bind]]
            path = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select_on"
            command = "cursorWordEndRight"

            [[bind]]
            path = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select_on"
            mode = "left"
            command = "cursorWordLeft"

            [[bind]]
            path = "word"
            key = "ctrl+shift+w"
            when = "master-key.select_on"
            command = "cursorWordEndRightSelect"

            [[bind]]
            path = "word"
            key = "ctrl+h ctrl+shift+w"
            command = "notACommand"

            [[bind]]
            path = "word"
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
    });

    after(async () => {
        await storeCoverageStats('commandState');
    });
});
