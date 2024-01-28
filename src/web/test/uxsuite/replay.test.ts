import { pause, movesCursorInEditor, setBindings, setupEditor } from "./utils";
import expect from "expect";
import { InputBox, Key, TextEditor, Workbench } from "vscode-extension-tester";
export const run = () => describe('Capture key commands', () => {
    let editor: TextEditor;

    before(async function(){
        this.timeout(8 * 1000);
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

        `);

       editor = await setupEditor(``, 'replay');
       await pause(500);
    });

    // we need verify that the follow can be recorded
    // - counts
    // - search (with, without acceptAfter)
    // - capture
    // - canceled captured keys
    // - canceled search (with accept after)
    // - replace/insert char
    // - if

    // we need to verify the following recording commands work
    // - pushHistoryToStack
    // - replayFromHistory
    // - replayFromStack

    it('Basic recording', async () => {
        editor.setText(`a b c d\ne f g h\ni j k l`);
        await pause(250);
        editor.typeText(Key.ESCAPE);
        await pause(50);

        editor.typeText('shift+q');
        movesCursorInEditor(async () => {
            await editor.typeText('l');
            await editor.typeText('j');
        }, [1, 1], editor);
        editor.typeText('shift+q');

        movesCursorInEditor(async () => {
            await editor.typeText('q q');
        }, [1, 1], editor);
    });
});
export default { run };
