import { pause, movesCursorInEditor, setBindings, setupEditor } from "./utils";
import expect from "expect";
import { InputBox, Key, TextEditor, Workbench } from "vscode-extension-tester";
export const run = () => describe('Replay commands', () => {
    let editor: TextEditor;

    before(async function(){
        this.timeout(10 * 1000);
        await setBindings(`
        [header]
        version = "1.0"

        [define]
        validModes = ["insert", "capture", "normal"]

        [[bind]]
        description = "Enter normal mode"
        key = "escape"
        mode = []
        command = "runCommands"
        args.commands = ["master-key.enterNormal", "master-key.reset"]
        prefixes = "<all-prefixes>"

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
        mode = "normal"
        name = "left (maybe down)"
        key = "shift+l"
        command = "runCommands"

        [[bind.args.commands]]
        command = "cursorMove"
        args.to = "left"

        [[bind.args.commands]]
        command = "cursorMove"
        args.to = "down"
        if = "count > 1"

        [[path]]
        name = "action"
        id = "action"
        default.mode = "normal"

        [define.keyNumber]
        "shift+0" = 0
        "shift+1" = 1
        "shift+2" = 2
        "shift+3" = 3

        [[bind]]
        # NOTE: because of how vscode-extension-tester is implemented
        # numeric values get typed, so we use other keybindings here
        # to avoid picking up this typed keys
        key = ["shift+0", "shift+1", "shift+2", "shift+3"]
        mode = "normal"
        name = "count {keyNumber[key]}"
        command = "master-key.updateCount"
        args.value = "{keyNumber[key]}"
        resetTransient = false

        [[bind]]
        name = "insert"
        key = "i"
        mode = "normal"
        command = "master-key.enterInsert"

        [[path]]
        name = "capture"
        id = "capture"
        default.mode = "normal"

        [[bind]]
        name = "1"
        key = "s"
        path = "capture"
        command = "master-key.captureKeys"
        args.acceptAfter = 2

        [[bind.args.doAfter]]
        command = "master-key.search"
        computedArgs.text = "captured"

        [[bind]]
        name = "replace"
        key = "r"
        path = "capture"
        command = "master-key.replaceChar"

        [[bind]]
        name = "replace"
        key = "ctrl+i"
        path = "capture"
        command = "master-key.insertChar"

        [[path]]
        name = "search"
        id = "search"
        default.mode = "normal"
        default.command = "master-key.search"

        [[bind]]
        name = "search"
        key = "/"
        path = "search"

        [[bind]]
        name = "to letter"
        key = "t"
        path = "search"
        args.acceptAfter = 1

        [[path]]
        name = "replay"
        id = "replay"
        default.mode = "normal"

        [[bind]]
        path = "replay"
        name = "record"
        key = "shift+q"
        when = "!master-key.record"
        command = "master-key.set"
        args.name = "record"
        args.value = true

        [[bind]]
        path = "replay"
        name = "record"
        key = "shift+q"
        when = "master-key.record"
        command = "runCommands"

        [[bind.args.commands]]
        command = "master-key.set"
        args.name = "record"
        args.value = false

        [[bind.args.commands]]
        command = "master-key.pushHistoryToStack"
        args.range.from = """
        commandHistory[i].name === "record" && i !== commandHistory.length-1
        """
        args.range.to = "i-1"

        [[bind]]
        path = "replay"
        name = "replay"
        key = "q q"
        command = "master-key.replayFromStack"
        computedArgs.index = "count"

        [[bind]]
        path = "replay"
        name = "replay last"
        key = "q l"
        command = "master-key.replayFromHistory"
        args.at = "i-2"
        `);
        await pause(250);

       editor = await setupEditor(`a b c d
e f g h
i j k l`, 'replay');
       await pause(500);
    });

    // TODO: for some reason this test is passing even though what
    // I see on the screen is clearly wrong.
    it('Basic recording', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        editor.typeText(Key.chord(Key.SHIFT, 'q'));
        movesCursorInEditor(async () => {
            await editor.typeText('l');
            await pause(50);
            await editor.typeText('j');
        }, [1, 1], editor);
        editor.typeText(Key.chord(Key.SHIFT, 'q'));
        await pause(50);

        movesCursorInEditor(async () => {
            await editor.typeText('q q');
        }, [1, 1], editor);
    });

    it('Replay from history', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        await movesCursorInEditor(async () => {
            await editor.typeText('l');
            await editor.typeText('j');
        }, [1, 1], editor);

        await movesCursorInEditor(async () => {
            await editor.typeText('q');
            await editor.typeText('l');
        }, [1, 0], editor);
    });

    it('Replay counts', async () => {
        await editor.setText(`a b c d\ne f g h\ni j k l`);
        await editor.moveCursor(1, 1);
        await pause(250);
        await editor.typeText(Key.ESCAPE);
        await pause(50);

        await editor.typeText(Key.chord(Key.SHIFT, 'q'));
        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.SHIFT, '3'));
            await editor.typeText('l');
        }, [0, 3], editor);
        await editor.typeText(Key.chord(Key.SHIFT, 'q'));

        await movesCursorInEditor(async () => {
            await editor.typeText('q');
            await editor.typeText('q');
            await pause(250);
        }, [0, 3], editor);
    });

    it('Replay search', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        await editor.typeText(Key.chord(Key.SHIFT, 'q'));
        await movesCursorInEditor(async () => {
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('c d');
            await input.confirm();
            await pause(100);
        }, [0, 4], editor);
        await editor.typeText(Key.chord(Key.SHIFT, 'q'));

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(async () => {
            await editor.typeText('q');
            await editor.typeText('q');
            await pause(250);
        }, [0, 4], editor);
    });

    it('Replay search with `acceptAfter`', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        await editor.typeText(Key.chord(Key.SHIFT, 'q'));
        await movesCursorInEditor(async () => {
            await editor.typeText('t');
            await editor.typeText('c');
            await pause(100);
        }, [0, 3], editor);
        await editor.typeText(Key.chord(Key.SHIFT, 'q'));

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(async () => {
            await editor.typeText('q');
            await editor.typeText('q');
            await pause(250);
        }, [0, 3], editor);
    });

    it('Replay search with canceled entry', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        await editor.typeText(Key.chord(Key.SHIFT, 'q'));
        await movesCursorInEditor(async () => {
            await editor.typeText('t');
            await editor.typeText(Key.ESCAPE);
            await editor.typeText('t');
            await editor.typeText('c');
            await pause(100);
        }, [0, 3], editor);
        await editor.typeText(Key.chord(Key.SHIFT, 'q'));

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(async () => {
            await editor.typeText('q');
            await editor.typeText('q');
            await pause(250);
        }, [0, 3], editor);
    });

    it.only('Replay capture keys', async () => {
        await editor.moveCursor(1, 1);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        await editor.typeText(Key.chord(Key.SHIFT, 'q'));
        await movesCursorInEditor(async () => {
            await editor.typeText('s');
            await editor.typeText('c');
            await editor.typeText(' ');
            await pause(100);
        }, [0, 3], editor);
        await editor.typeText(Key.chord(Key.SHIFT, 'q'));

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(async () => {
            await editor.typeText('q');
            await editor.typeText('q');
            await pause(250);
        }, [0, 3], editor);
    });

    // we need to verify that the following can be recorded
    // - capture
    // - canceled captured keys
    // - replace/insert char
    // - if
});
export default { run };
