import { pause, movesCursorInEditor, setBindings, setupEditor } from "./utils";
import expect from "expect";
import { InputBox, Key, TextEditor, Workbench } from "vscode-extension-tester";

export const run = () => describe('Search motions', () => {
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
            args = ["master-key.enterNormal", "master-key.reset"]
            prefixes = "<all-prefixes>"

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
            name = "searchC"
            key = "shift+/"
            path = "search"
            args.backwards = true
       `);

       editor = await setupEditor(`foobar bum POINT_A Officia voluptate ex commodo esse laborum velit
ipsum velit excepteur sunt cillum nulla adipisicing cupidatat. Laborum officia do mollit do
labore elit occaecat cupidatat non POINT_B.`);
    });

    it.only('Handles basic search', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);
        }, [0, 10], editor);
    });

    it.only('Handles backwards search', async () => {
        await editor.moveCursor(2, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.SHIFT,'/'));
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);
        }, [0, 18], editor);
    });

    // TODO: start working on testing out the most basic command
    // TODO: test out each argument
    // + backwards
    // - caseSensitive
    // - wrapAround
    // - acceptAfter
    // - selectTillMatch
    // - highlightMatches
    // - offset
    // - text
    // - regex
    // - register
    // - doAfter
    // TODO: test correctness of cancelling out a search
    // TODO: test correctness of failing to find search in text
    // TODO: test out 'delete last char'
    // TODO: test out next and previous match
});

export default { run };
