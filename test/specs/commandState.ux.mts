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
        editor = await setupEditor(`This is a short, simple sentence`);
    });

    it('Handles Automated Prefixes', async () => {
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(async () => {
            await enterModalKeys(['ctrl', 'h'], ['shift', 'ctrl', "1"]);
        }, [0, 1], editor);
    });

    it("Handles Flagged Prefixs", async function(){
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(async () => {
            await enterModalKeys(['ctrl', 'shift', 'w']);
        }, [0, 4], editor);

        await enterModalKeys(['ctrl', 'l'], ['ctrl', 'shift', 'w']);
        await sleep(1000);
        expect(await editor.getSelectedText()).toEqual(" is");
    });

    it("Allows key mode to changes commands", async () => {
        await editor.moveCursor(1, 6);
        await enterModalKeys(['ctrl', 'shift', 'l']);

        await movesCursorInEditor(async () => {
            await enterModalKeys(['ctrl','h'], ['shift', 'ctrl', '1']);
        }, [0, -1], editor);

        await movesCursorInEditor(async () => {
            await enterModalKeys(['ctrl', 'shift', 'w']);
        }, [0, -4], editor);

        await editor.moveCursor(1, 5);
        await enterModalKeys(['ctrl', 'l'], ['ctrl', 'shift', 'w']);
        expect(await editor.getSelectedText()).toEqual('This');
    });

/*     it.only('Resets state on error',async () => {
        await editor.moveCursor(1, 1);

        // clear any other notificatoins that happened before
        let workbench = new Workbench();
        let notifications = await workbench.getNotifications();
        for(let note of notifications){
            await note.dismiss();
            await pause(100);
        }

        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, 'h'));
        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        await pause(250);

        notifications = await workbench.getNotifications();
        let foundCommand = false;
        for(let note of notifications){
            let message = await note.getMessage();
            console.log("Message: " + message);
            await pause(50);
            if(message === "command 'notACommand' not found"){
                foundCommand = true;
                console.log("Found command!");
                break;
            }
        }
        console.log("Testing that command was found");
        expect(foundCommand).toEqual(true);
        await pause(100);

        console.log("Testing that we can run a command like normal");
        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'h'));
            await pause(50);
            await editor.typeText(Key.chord(Key.SHIFT, Key.CONTROL, "1"));
            await pause(50);
        }, [0, 1], editor);
    });
 */});
