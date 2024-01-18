import { Key, TextEditor } from 'vscode-extension-tester';
import { pause, movesCursorInEditor, setupEditor, setBindings } from './utils';

export const run = () => describe('Simple motions', () => {
    let editor: TextEditor;

    // initialize the browser and webdriver
    before(async function(){
        this.timeout(10 * 1000);
        await setBindings(`
            [header]
            version = "1.0"

            [define]
            validModes = ["insert", "capture", "normal"]

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "runCommands"
            args = ["master-key.enterNormal", "master-key.reset"]
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
            name = "double right"
            key = "shift+l"
            command = "master-key.repeat"
            mode = "normal"
            args.command = "cursorMove"
            args.args.to = "right"
            args.repeat = 2

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
        `);

        editor = await setupEditor(`Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
Ex cillum duis anim dolor cupidatat non nostrud non et sint ullamco. Consectetur consequat
ipsum ex labore enim. Amet do commodo et occaecat proident ex cupidatat in. Quis id magna
laborum ad. Dolore exercitation cillum eiusmod culpa minim duis`);

        return;
    });

    it('Works with Directional Motions', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);

        await movesCursorInEditor(() => editor.typeText('j'), [1, 0], editor);
        await movesCursorInEditor(() => editor.typeText('l'), [0, 1], editor);
        await movesCursorInEditor(() => editor.typeText('h'), [0, -1], editor);
        await movesCursorInEditor(() => editor.typeText('k'), [-1, 0], editor);
    });

    it('Can Repeat Commands', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);

        await movesCursorInEditor(() => editor.typeText(Key.chord(Key.SHIFT, 'l')), [0, 2], editor);
    });

    it('Repeats using count', async function(){
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);

        for (let c = 1; c <= 3; c++) {
            await movesCursorInEditor(async () => {
                await editor.typeText(Key.chord(Key.SHIFT, String(c)));
                await editor.typeText('j');
            }, [1*c, 0], editor);
            await movesCursorInEditor(async () => {
                await editor.typeText(Key.chord(Key.SHIFT, String(c)));
                await editor.typeText('l');
            }, [0, 1*c], editor);
            await movesCursorInEditor(async () => {
                await editor.typeText(Key.chord(Key.SHIFT, String(c)));
                await editor.typeText('h');
            }, [0, -1*c], editor);
            await movesCursorInEditor(async () => {
                await editor.typeText(Key.chord(Key.SHIFT, String(c)));
                await editor.typeText('k');
            }, [-1*c, 0], editor);
        }
        await movesCursorInEditor(async () => {
            await editor.typeText(Key.chord(Key.SHIFT, '1'));
            await editor.typeText(Key.chord(Key.SHIFT, '0'));
            await editor.typeText('l');
        }, [0, 10], editor);
    });

});

export default { run };
