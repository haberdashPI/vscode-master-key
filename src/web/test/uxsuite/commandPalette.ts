import { InputBox, Key, TextEditor } from 'vscode-extension-tester';
import { pause, movesCursorInEditor, setupEditor, setBindings } from './utils';

export const run = () => describe('Command palette', () => {
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
            command = "master-key.enterNormal"
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
            key = "g h"
            args.to = "left"

            [[bind]]
            path = "motion"
            name = "right"
            key = "g l"
            args.to = "right"
        `);

        editor = await setupEditor(`aaa bbb`, "palette");

        return;
    });

    it('Can be safely skipped', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);
        await movesCursorInEditor(async () => {
            await editor.typeText('g');
            await editor.typeText('l');
         }, [1, 0], editor);
         await movesCursorInEditor(async () => {
            await editor.typeText('g');
            await editor.typeText('l');
         }, [-1, 0], editor);
    });

    it('Works in keybinding mode', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);
        await movesCursorInEditor(async () => {
            await editor.typeText('g');
            await pause(1000);
            let input = await InputBox.create();
            await input.setText('l');
         }, [1, 0], editor);
         await movesCursorInEditor(async () => {
            await editor.typeText('g');
            await pause(1000);
            let input = await InputBox.create();
            await input.setText('h');
         }, [-1, 0], editor);
    });

    it('Works in search mode', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);
        await movesCursorInEditor(async () => {
            await editor.typeText('g');
            await pause(1000);
            let input = await InputBox.create();
            await input.setText(Key.chord(Key.CONTROL, '.'));
            await input.setText('left');
            await input.confirm();
         }, [1, 0], editor);
         await movesCursorInEditor(async () => {
            await editor.typeText('g');
            await pause(1000);
            let input = await InputBox.create();
            await input.setText(Key.chord(Key.CONTROL, '.'));
            await input.setText('right');
            await input.confirm();
         }, [-1, 0], editor);
    });
});

export default { run };
