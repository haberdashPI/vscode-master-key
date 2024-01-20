import { Key, TextEditor } from "vscode-extension-tester";
import { pause, movesCursorInEditor, setBindings, setupEditor } from "./utils";
import expect from 'expect';

export const run = () => describe('Command state', () => {
    let editor: TextEditor;

    before(async function(){
        this.timeout(10 * 1000);
        await setBindings(`
            [header]
            version = "1.0"

            [define]
            validModes = ["insert", "capture", "left"]

            [[bind]]
            description = "Enter normal mode"
            key = "escape"
            mode = []
            command = "runCommands"
            args = ["master-key.enterInsert", "master-key.reset"]
            when = "!findWidgetVisible"
            prefixes = "<all-prefixes>"

            [[bind]]
            name = "left mode"
            key = "ctrl+shift+r"
            command = "master-key.setMode"
            args.value = "left"

            [[bind]]
            name = "move right"
            key = "ctrl+g ctrl+f"
            command = "cursorMove"
            args.to = "right"
            when = "editorTextFocus"

            [[bind]]
            name = "move left"
            mode = "left"
            key = "ctrl+g ctrl+f"
            command = "cursorMove"
            args.to = "left"
            when = "editorTextFocus"

            [[bind]]
            name = "prepare select"
            key = "ctrl+l"
            mode = ["left", "insert"]
            command = "master-key.prefix"
            args.flag = "select"
            resetTransient = false

            [[path]]
            id = "word"
            name = "word"
            default.prefixes = ["", "ctrl+l"]

            [[bind]]
            path = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select"
            command = "cursorWordEndRight"

            [[bind]]
            path = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select"
            mode = "left"
            command = "cursorWordLeft"

            [[bind]]
            path = "word"
            key = "ctrl+shift+w"
            when = "master-key.select"
            command = "cursorWordEndRightSelect"

            [[bind]]
            path = "word"
            key = "ctrl+shift+w"
            mode = "left"
            when = "master-key.select"
            command = "cursorWordLeftSelect"

            [[bind]]
            name = "set foo"
            key = "ctrl+alt+w"
            command = "master-key.set"
            args.name = "foo"
            args.value = 6

            [[bind]]
            name = "write foo"
            key = "ctrl+alt+l"
            command = "cursorMove"
            computedArgs.value = "foo"
            args.to = "right"
        `);
        await pause(1000);

        editor = await setupEditor(`This is a short, simple sentence`);
    });

    it('Handles Automated Prefixes', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'g')+Key.chord(Key.CONTROL, 'f'));
        }, [0, 1], editor);
    });

    it("Handles Flagged Prefixs", async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
            await pause(250);
        }, [0, 4], editor);

        editor.typeText(Key.ESCAPE);
        await editor.moveCursor(1, 1);
        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, 'l'))
        await pause(50);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        await pause(250);
        expect(await editor.getSelectedText()).toEqual('This');
    });

    it("Handles variable setting", async () => {
        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, Key.ALT, 'w'));
            await pause(50);
            await editor.typeText(Key.chord(Key.CONTROL, Key.ALT, 'l'));
        }, [0, 6], editor);
    });

    it("Mode changes key effects", async () => {
        await editor.moveCursor(1, 5);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'r'));
        await pause(50);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'g')+Key.chord(Key.CONTROL, 'f'));
        }, [0, -1], editor);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
            await pause(250);
        }, [0, -4], editor);

        editor.typeText(Key.ESCAPE);
        editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'r'));
        await pause(50);

        await editor.moveCursor(1, 4);
        await pause(250);
        await editor.typeText(Key.chord(Key.CONTROL, 'l'))
        await pause(50);
        await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        await pause(250);
        expect(await editor.getSelectedText()).toEqual('This');
    });

    // TODO: check that changing the mode changes the direction of the motions

    // TODO: check that the flagged prefixes work as expected in the new mode

    // TODO: test that command state appropriate resets if there is an exception
    // thrown in the keybinding

});

export default { run };
