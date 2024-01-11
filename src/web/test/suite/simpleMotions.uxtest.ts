import assert from 'assert';
import { TextEditor, EditorView, InputBox, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

describe('My Test Suite', () => {
    let browser: VSBrowser;
    let driver: WebDriver;
    let workbench: Workbench;
    let editor: TextEditor;

    // initialize the browser and webdriver
    before(async () => {
        browser = VSBrowser.instance;
        driver = browser.driver;
        workbench = new Workbench();
        let editorView = new EditorView();

        // NOTE: ux tests *have* to be compiled in a node context, so we should use the
        // path/fs utilities to generate a temporary file, and then use the VSBrowser object
        // to load the file into VSCode
        await editorView.openEditor('config.toml');
        let configEditor = new TextEditor(editorView);
        configEditor.setText(`
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

        workbench.executeCommand('Master Key: Select Keybinding');
        const input = await InputBox.create();
        await input.setText('Current File');
        await input.confirm();
        await editorView.openEditor('test.txt');
        editor = new TextEditor(editorView);
        editor.setText(`
Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
`);
    });

    it('Has Working Down Motions', async () => {
        let oldLoc = await editor.getLocation();
        await editor.sendKeys('jj');
        let loc = await editor.getLocation();
        assert.equal(oldLoc.y+2, loc.y);
    });
});
