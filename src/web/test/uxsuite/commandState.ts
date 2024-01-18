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
            name = "left mode"
            key = "ctrl+shift+r"
            command = "master-key.setMode"
            args.value = "right"

            [[bind]]
            name = "move right"
            key = "ctrl+g ctrl+f"
            command = "moveCursor"
            args.to = "right"
            when = "editorTextFocus"

            [[bind]]
            name = "move left"
            mode = "left"
            key = "ctrl+g ctrl+f"
            command = "moveCursor"
            args.to = "left"
            when = "editorTextFocus"

            [[bind]]
            name = "prepare select"
            key = "ctrl+l"
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
            args.value = 2

            [[bind]]
            name = "write foo"
            key = "ctrl+alt+l"
            command = "type"
            computedArgs.text = "foo"
        `);
        await pause(1000);

        editor = await setupEditor(`This is a short, simple sentence`);
    });

    it('Handles Automated Prefixes', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'g')+Key.chord(Key.CONTROL, 'f'));
        }, [0, 1], editor);
    });

    it("Handles Flagged Prefixs", async () => {
        await editor.moveCursor(1, 1);
        await pause(250);

        // TODO: debug why this command is not running (it seems like
        // there is probably an issue with the binding itself)
        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
            await pause(250);
        }, [0, 4], editor);
        expect(editor.getSelectedText()).toEqual('');

        await editor.moveCursor(1, 1);
        await editor.typeText(Key.chord(Key.CONTROL, 'l')+Key.chord(Key.CONTROL, Key.SHIFT, 'w'));
        expect(editor.getSelectedText()).toEqual('This');
    });

});

export default { run };
