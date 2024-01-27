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

            [[bind]]
            description = "Enter normal mode"
            key = "escape"
            mode = []
            command = "runCommands"
            args.commands = ["master-key.enterNormal", "master-key.reset"]
            prefixes = "<all-prefixes>"

            [[path]]
            name = "capture"
            id = "capture"
            default.mode = "normal"

            [[bind]]
            name = "1"
            key = "t"
            path = "capture"
            command = "master-key.captureKeys"
            args.acceptAfter = 2

            [[bind.args.doAfter]]
            command = "master-key.search"
            computedArgs.text = "captured"

            [[bind]]
            name = "1"
            key = "f"
            path = "capture"
            command = "master-key.captureKeys"
            args.text = "po"
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
            key = "i"
            path = "capture"
            command = "master-key.insertChar"
        `);

       editor = await setupEditor(`foobar bum POINT_A`, 'capture');
       await pause(500);
    });

    it('Captures keys', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('t');
            await pause(50);
            await editor.typeText('p');
            await editor.typeText('o');
            await pause(100);
        }, [0, 10], editor);
    });

    it('Captures saved keys', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('f');
            await pause(100);
        }, [0, 10], editor);
    });

    it('Handles escape during capture', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('t');
            await pause(50);
            await editor.typeText('p');
            await editor.typeText(Key.ESCAPE);
            await editor.typeText('t');
            await pause(50);
            await editor.typeText('p');
            await editor.typeText('o');
            await pause(100);
        }, [0, 10], editor);
    });

    it('Replaces chars', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await editor.typeText('r');
        await editor.typeText('p');
        await pause(50);
        let text = await editor.getText();
        expect(text).toEqual(`poobar bum POINT_A`);
    });

    it('Inserts chars', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await editor.typeText('i');
        await editor.typeText('f');
        await pause(50);
        let text = await editor.getText();
        expect(text).toEqual(`fpoobar bum POINT_A`);
    });
});
export default { run };
