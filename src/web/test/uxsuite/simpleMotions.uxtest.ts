import assert from 'assert';
import { TextEditor, EditorView, InputBox, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';
import * as fs from 'fs';
import * as path from 'path';

describe('My Test Suite', () => {
    let browser: VSBrowser;
    let driver: WebDriver;
    let workbench: Workbench;
    let editor: TextEditor;

    // initialize the browser and webdriver
    before(async function(){
        // TODO: for the very first test, maybe wait until the welcome screen has
        // shown up here...?
        this.timeout(50000);
        browser = VSBrowser.instance;
        driver = browser.driver;
        workbench = new Workbench();
        let editorView = new EditorView();

        // NOTE: ux tests *have* to be compiled in a node context, so we should use the
        // path/fs utilities to generate a temporary file, and then use the VSBrowser object
        // to load the file into VSCode
        if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
        let tempdir = fs.mkdtempSync('uxtest/temp/tmp');
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
            name = "left"
            key = "h"
            args.to = "left"

            [[bind]]
            name = "right"
            key = "l"
            args.to = "right"

            [[bind]]
            name = "down"
            key = "j"
            args.to = "down"

            [[bind]]
            name = "up"
            key = "k"
            args.to = "up"
        `);

        await workbench.executeCommand('Master Key: Select Keybinding');
        const input = await InputBox.create();
        // TODO: somewhere here, just open the temporary file via the simple open dialog
        await input.setText('Open File');
        await input.confirm();
        // TODO: we're getting a welcome screen when vscode opens, need to fix this
        let textFile = path.join(tempdir, 'test.txt');
        fs.writeFileSync(textFile, `Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
`);
        await VSBrowser.instance.openResources(textFile);
        editor = new TextEditor(editorView);
        return;
    });

    it('Has Working Down Motions', async () => {
        let oldLoc = await editor.getLocation();
        await editor.sendKeys('jj');
        let loc = await editor.getLocation();
        // TODO: how do I compare positions
        assert.equal(oldLoc.y+2, loc.y);
    });
});
