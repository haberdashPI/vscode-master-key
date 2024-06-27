// start with just some basic tests to verify all is well

import { browser, expect } from '@wdio/globals';
import { setBindings, setupEditor, movesCursorInEditor, enterModalKeys } from './utils.mts';
import 'wdio-vscode-service';
import { sleep, TextEditor } from 'wdio-vscode-service';
import { Key } from "webdriverio";

describe('Command State', () => {
    let editor: TextEditor;
    before(async () => {
        await setBindings(`
            [header]
            version = "1.0"

            [define]
            select_on = false

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
        editor = await setupEditor(`This is a short, simple sentence`);
    });

    it('Handles Automated Prefixes', async () => {
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(async () => {
            await enterModalKeys([Key.Control, 'h'], [Key.Shift, Key.Control, "1"]);
        }, [0, 1], editor);
    });
});
