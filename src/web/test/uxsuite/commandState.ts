import { Key, TextEditor, Workbench } from "vscode-extension-tester";
import { pause, movesCursorInEditor, setBindings, setupEditor } from "./utils";
import expect from 'expect';

export const run = () => describe('Command state', () => {
    let editor: TextEditor;

    before(async function(){
        this.timeout(13 * 1000);
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
            key = "ctrl+h ctrl+f"
            command = "cursorMove"
            args.to = "right"
            when = "editorTextFocus"

            [[bind]]
            name = "move left"
            mode = "left"
            key = "ctrl+h ctrl+f"
            command = "cursorMove"
            args.to = "left"
            when = "editorTextFocus"

            [[bind]]
            name = "prepare select"
            key = "ctrl+l"
            mode = ["left", "insert"]
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
        await pause(1000);

        editor = await setupEditor(`This is a short, simple sentence`, "state");
    });

    it('Handles Automated Prefixes', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'h')+Key.chord(Key.CONTROL, 'f'));
        }, [0, 1], editor);
    });

    it("Handles Flagged Prefixs", async () => {
        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
            await pause(250);
        }, [0, 4], editor);

        await editor.moveCursor(1, 1);
        await pause(50);
        await editor.typeText(Key.chord(Key.CONTROL, 'l'));
        await pause(50);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        await pause(50);
        expect(await editor.getSelectedText()).toEqual('This');
    });

    it("Mode changes key effects", async () => {
        await editor.moveCursor(1, 6);
        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'l'));

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'h'));
            await pause(50);
            await editor.typeText(Key.chord(Key.CONTROL, 'f'));
        }, [0, -1], editor);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        }, [0, -4], editor);

        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'l'));
        await pause(50);

        await editor.moveCursor(1, 5);
        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, 'l'));
        await pause(50);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        await pause(250);
        expect(await editor.getSelectedText()).toEqual('This');
    });

    it('Resets state on error',async () => {
        // clear any other notificatoins that happened before
        let workbench = new Workbench();
        let notifications = await workbench.getNotifications();
        for(let note of notifications){
            console.log(await note.getMessage);
            await note.dismiss();
            await pause(10);
        }

        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, 'h'));
        await pause(50);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));

        await pause(250);
        notifications = await workbench.getNotifications();
        const message = await notifications[0].getMessage();
        expect(message).toEqual("command 'notACommand' not found");

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'h')+Key.chord(Key.CONTROL, 'f'));
        }, [0, 1], editor);
    });
    // TODO: test that command state appropriate resets if there is an exception
    // thrown in the keybinding

});

export default { run };
