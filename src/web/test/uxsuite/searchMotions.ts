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
            name = "search backwards"
            key = "shift+/"
            path = "search"
            args.backwards = true

            [[bind]]
            name = "next"
            key = "n"
            mode = "normal"
            command = "master-key.nextMatch"

            [[bind]]
            name = "previous"
            key = "shift+n"
            mode = "normal"
            command = "master-key.previousMatch"

            [[bind]]
            name = "search (case sensitive)"
            key = "ctrl+/"
            path = "search"
            args.caseSensitive = true

            [[bind]]
            name = "search (case sensitive)"
            key = "w /"
            path = "search"
            args.wrapAround = true

            [[bind]]
            name = "to letter"
            key = "t"
            path = "search"
            args.acceptAfter = 1

            [[bind]]
            name = "select search"
            key = "s /"
            path = "search"
            args.selectTillMatch = true

            [[bind]]
            name = "inclusive search"
            key = "i /"
            path = "search"
            args.offset = "inclusive"

            [[bind]]
            name = "inclusive search"
            key = "a /"
            path = "search"
            args.offset = "start"

            [[bind]]
            name = "inclusive search"
            key = "b /"
            path = "search"
            args.offset = "end"

            [[bind]]
            name = "preset search"
            key = "p /"
            path = "search"
            args.text = "point_"
    `);

       editor = await setupEditor(`foobar bum POINT_A Officia voluptate ex point_a commodo esse laborum velit
ipsum velit excepteur sunt cillum nulla adipisicing cupidatat. Laborum officia do mollit do
labore elit occaecat cupidatat non POINT_B.`);
    });

    it('Handles basic search', async () => {
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

    it('Handles backwards search', async () => {
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

    it('Handle case sensitive search', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('/');
            await pause(50);
            let input = await InputBox.create();

            await input.setText('POINT_');
            await input.confirm();

            await editor.typeText('n');
        }, [0, 39], editor);

        await editor.moveCursor(1, 1);
        await pause(250);
        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.CONTROL, '/'));
            await pause(50);
            let input = await InputBox.create();

            await input.setText('POINT_');
            await input.confirm();

            await editor.typeText('n');
        }, [2, 34], editor);
    });

    it('Can do a wrap-around search', async () => {
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

            await editor.typeText('n');
            await editor.typeText('n');
        }, [0, 39], editor);

        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('w');
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);

            await editor.typeText('n');
            await editor.typeText('n');
        }, [0, 10], editor);
   });

    it('Can handle accept after', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('t');
            await pause(50);
            await editor.typeText('p');
        }, [0, 10], editor);
   });

    it('Selects till match', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('s');
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);
        }, [0, 11], editor);

        await pause(50);
        let text = await editor.getSelectedText();
        expect(text).toEqual("foobar bum ");
    });

    it.only('Handles each offset', async function() {
        this.timeout(8000);

        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('i');
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);
        }, [0, 17], editor);

        await movesCursorInEditor(async () => {
            await pause(50);
            await editor.typeText('n');
            await pause(50);
            await editor.typeText('N');
            await pause(100);
        }, [0, -6], editor);


        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('a');
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);
        }, [0, 11], editor);

        await movesCursorInEditor(async () => {
            await pause(50);
            await editor.typeText('n');
            await pause(50);
            await editor.typeText('N');
            await pause(100);
        }, [0, 0], editor);

        await editor.moveCursor(1, 1);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('b');
            await editor.typeText('/');
            await pause(50);
            const input = await InputBox.create();

            await input.setText('POINT_A');
            await input.confirm();
            await pause(100);
        }, [0, 18], editor);

        await movesCursorInEditor(async () => {
            await pause(50);
            await editor.typeText('n');
            await pause(50);
            await editor.typeText('N');
            await pause(100);
        }, [0, 0], editor);
   });

    it('Accepts `text` argument.', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(250);

        await movesCursorInEditor(async () => {
            await editor.typeText('p');
            await editor.typeText('/');
            await pause(50);
        }, [0, 10], editor);
    });

    // TODO: start working on testing out the most basic command
    // TODO: test out each argument
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
