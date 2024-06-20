// start with just some basic tests to verify all is well

import { browser, expect } from '@wdio/globals';
import { setBindings, setupEditor, movesCursorInEditor } from './utils.mts';
import 'wdio-vscode-service';
import { TextEditor } from 'wdio-vscode-service';
import { Key } from "webdriverio";

describe('VS Code Extension Testing', () => {
    let editor: TextEditor;
    before(async () => {
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
            mode = "normal"
            command = "cursorMove"
            args.to = "right"
            repeat = 1

            [[bind]]
            name = "insert mode"
            key = "i"
            command = "master-key.enterInsert"
            mode = "normal"

            [define.keyNumber]
            mode = "normal"
            "shift+0" = 0
            "shift+1" = 1
            "shift+2" = 2
            "shift+3" = 3

            [[bind]]
            # NOTE: because of how vscode-extension-tester is implemented
            # numeric values get typed, so we use other keybindings here
            # to avoid picking up these typed keys
            foreach.num = ["{key: [0-3]}"]
            key = "shift+{num}"
            mode = "normal"
            name = "count {num}"
            command = "master-key.updateCount"
            args.value = "{num}"
            resetTransient = false
        `);
        editor = await setupEditor(`Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
Ex cillum duis anim dolor cupidatat non nostrud non et sint ullamco. Consectetur consequat
ipsum ex labore enim. Amet do commodo et occaecat proident ex cupidatat in. Quis id magna
laborum ad. Dolore exercitation cillum eiusmod culpa minim duis`);
    });
    it('should be able to load VSCode', async () => {
        const workbench = await browser.getWorkbench();
        expect(await workbench.getTitleBar().getTitle())
            .toContain('[Extension Development Host]');
    });

    it('should be able to run command', async() => {
        await editor.moveCursor(1, 1);
        let elm = await editor.elem$;
        elm.click();
        await browser.keys([Key.Escape]);

        await movesCursorInEditor(() => editor.typeText('j'), [1, 0], editor);
        await movesCursorInEditor(() => editor.typeText('l'), [0, 1], editor);
        await movesCursorInEditor(() => editor.typeText('h'), [0, -1], editor);
        await movesCursorInEditor(() => editor.typeText('k'), [-1, 0], editor);
    });
});
