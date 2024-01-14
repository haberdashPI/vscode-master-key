import { Key, TextEditor, EditorView, InputBox, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';
import * as fs from 'fs';
import expect from 'expect';
import * as path from 'path';

function pause(ms: number){ return new Promise(res => setTimeout(res, ms)); }

describe('My Test Suite', () => {
    let browser: VSBrowser;
    let driver: WebDriver;
    let workbench: Workbench;
    let editor: TextEditor;

    // initialize the browser and webdriver
    before(async function(){
        this.timeout(10 * 1000);
        await pause(1000);
        browser = VSBrowser.instance;
        driver = browser.driver;
        workbench = new Workbench();
        let editorView = new EditorView();

        // NOTE: ux tests *have* to be compiled in a node context, so we should use the
        // path/fs utilities to generate a temporary file, and then use the VSBrowser object
        // to load the file into VSCode
        if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
        let tempdir = path.join(process.cwd(), fs.mkdtempSync('uxtest/temp/tmp'));
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

    it('Has Working Down Motions', async function(){
        await editor.moveCursor(1, 1);

        let oldpos = await editor.getCoordinates();
        await editor.typeText(Key.ESCAPE);
        await editor.typeText('j');
        let newpos = await editor.getCoordinates();
        expect(oldpos[0]+1).toEqual(newpos[0]);
        expect(oldpos[1]).toEqual(newpos[1]);

        oldpos = await editor.getCoordinates();
        await editor.typeText('l');
        newpos = await editor.getCoordinates();
        expect(oldpos[0]).toEqual(newpos[0]);
        expect(oldpos[1]+1).toEqual(newpos[1]);

        oldpos = await editor.getCoordinates();
        await editor.typeText('h');
        newpos = await editor.getCoordinates();
        expect(oldpos[0]).toEqual(newpos[0]);
        expect(oldpos[1]-1).toEqual(newpos[1]);

        oldpos = await editor.getCoordinates();
        await editor.typeText('k');
        newpos = await editor.getCoordinates();
        expect(oldpos[0]-1).toEqual(newpos[0]);
        expect(oldpos[1]).toEqual(newpos[1]);
    });
});
