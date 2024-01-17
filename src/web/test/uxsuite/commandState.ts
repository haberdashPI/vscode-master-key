import { Key, TextEditor } from "vscode-extension-tester";
import { movesCurosrInEditor, setBindings, setupEditor } from "./utils";

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
            default.prefixes = ["", "ctrl+l"]

            [[bind]]
            path = "word"
            name = "word motion"
            key = "ctrl+shift+w"
            when = "!master-key.select"
            command = "cursorWordRight"

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
            command = "cursorWordRightSelect"

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

        editor = await setupEditor(`Fugiat qui eiusmod ullamco Lorem non esse commodo
consequat. Adipisicing aliqua Lorem Lorem proident excepteur reprehenderit et adipisicing
aliquip eu mollit tempor sit. Amet ut do nisi voluptate laboris ipsum magna velit. Est
cillum eiusmod cillum fugiat nostrud dolore sint. Amet excepteur eu minim aliqua. Labore
aute sint ad ullamco. Nulla consequat in do velit incididunt id nisi Lorem aliqua.`);
    });

    it('Handles Prefixes', async () => {
        await editor.moveCursor(1, 1);

        await movesCurosrInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, 'g')+Key.chord(Key.CONTROL, 'f'));
        }, [0, 1], editor);

        // TODO: run each command from the list above and verify its effect
    });
});
