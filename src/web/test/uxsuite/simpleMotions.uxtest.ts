import { Key, TextEditor, EditorView, InputBox, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';
import * as fs from 'fs';
import expect from 'expect';
import * as path from 'path';

function pause(ms: number){ return new Promise(res => setTimeout(res, ms)); }

async function movesCurosrInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let oldpos = await editor.getCoordinates();
    await action();
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}

describe('My Test Suite', () => {
    let browser: VSBrowser;
    let driver: WebDriver;
    let workbench: Workbench;
    let editor: TextEditor;
    let tempdir: string;

    // initialize the browser and webdriver
    before(async function(){
        this.timeout(10 * 1000);
        await pause(1000); // wait for VSCODE to load
        browser = VSBrowser.instance;
        driver = browser.driver;
        workbench = new Workbench();
        let editorView = new EditorView();

        // NOTE: ux tests *have* to be compiled in a node context, so we should use the
        // path/fs utilities to generate a temporary file, and then use the VSBrowser object
        // to load the file into VSCode
        if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
        tempdir = path.join(process.cwd(), fs.mkdtempSync('uxtest/temp/tmp'));
        let config = path.join(tempdir, 'config.toml');
        fs.writeFileSync(config, `
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

        [[bind]]
        key = ["1", "2", "3"]
        mode = "normal"
        name = "count {key}"
        command = "master-key.updateCount"
        args.value = "{key}"
        resetTransient = false
        `);


        await workbench.executeCommand('Master Key: Select Keybinding');
        let input = await InputBox.create();
        await input.setText('File...');
        await input.confirm();

        input = await InputBox.create();
        await input.setText(config);
        await input.confirm();

        let textFile = path.join(tempdir, 'test.txt');
        fs.writeFileSync(textFile, `Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
Ex cillum duis anim dolor cupidatat non nostrud non et sint ullamco. Consectetur consequat
ipsum ex labore enim. Amet do commodo et occaecat proident ex cupidatat in. Quis id magna
laborum ad. Dolore exercitation cillum eiusmod culpa minim duis
`);
        await pause(500);
        await VSBrowser.instance.openResources(textFile);
        editor = await editorView.openEditor('test.txt') as TextEditor;
        return;
    });

    it('Directional Motions', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);

        await movesCurosrInEditor(() => editor.typeText('j'), [1, 0], editor);
        await movesCurosrInEditor(() => editor.typeText('l'), [0, 1], editor);
        await movesCurosrInEditor(() => editor.typeText('h'), [0, -1], editor);
        await movesCurosrInEditor(() => editor.typeText('k'), [-1, 0], editor);
    });

    it('Repeat Command', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(500);

        await movesCurosrInEditor(() => editor.typeText(Key.chord(Key.SHIFT, 'l')), [0, 2], editor);
    });

    it('Counts repeat motion', async () => {
        await editor.moveCursor(1, 1);
        await editor.typeText(Key.ESCAPE);
        await pause(2000);

        for (let c = 1; c <= 3; c++) {
            console.log('c: '+c);
            console.log('j');
            await movesCurosrInEditor(() => editor.typeText(c + 'j'), [1*c, 0], editor);
            console.log('l');
            await movesCurosrInEditor(() => editor.typeText(c + 'l'), [0, 1*c], editor);
            console.log('h');
            await movesCurosrInEditor(() => editor.typeText(c + 'h'), [0, -1*c], editor);
            console.log('k');
            await movesCurosrInEditor(() => editor.typeText(c + 'k'), [-1*c, 0], editor);
        }
        await movesCurosrInEditor(() => editor.typeText('10l'), [0, 10], editor);
    });

    after(() => { fs.rmSync(tempdir, {recursive: true}); });
});
