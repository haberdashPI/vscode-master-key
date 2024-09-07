// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import {
    enterModalKeys,
    setBindings,
    setupEditor,
    movesCursorInEditor,
    storeCoverageStats,
} from './utils.mts';
import {TextEditor} from 'wdio-vscode-service';
import {Key} from 'webdriverio';

describe('Simple Motions', () => {
    let editor: TextEditor;
    before(async () => {
        await setBindings(`
            [header]
            version = "1.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

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
        editor =
            await setupEditor(`Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
Ex cillum duis anim dolor cupidatat non nostrud non et sint ullamco. Consectetur consequat
ipsum ex labore enim. Amet do commodo et occaecat proident ex cupidatat in. Quis id magna
laborum ad. Dolore exercitation cillum eiusmod culpa minim duis`);
    });

    it('Can move cursor', async () => {
        await browser.keys(Key.Escape);
        await editor.moveCursor(1, 1);

        await movesCursorInEditor(() => enterModalKeys('j'), [1, 0], editor);
        await movesCursorInEditor(() => enterModalKeys('l'), [0, 1], editor);
        await movesCursorInEditor(() => enterModalKeys('h'), [0, -1], editor);
        await movesCursorInEditor(() => enterModalKeys('k'), [-1, 0], editor);
    });

    it('Can use `repeat`', async () => {
        await editor.moveCursor(1, 1);
        await browser.keys([Key.Escape]);

        await movesCursorInEditor(() => enterModalKeys(['shift', 'l']), [0, 2], editor);
    });

    it('Can use `count`', async () => {
        await editor.moveCursor(1, 1);
        await browser.keys([Key.Escape]);

        for (let c = 1; c <= 3; c++) {
            await movesCursorInEditor(
                async () => {
                    await enterModalKeys({count: c, key: ['shift', String(c)]}, 'j');
                },
                [1 * c, 0],
                editor
            );
            await movesCursorInEditor(
                async () => {
                    await enterModalKeys({count: c, key: ['shift', String(c)]}, 'l');
                },
                [0, 1 * c],
                editor
            );
            await movesCursorInEditor(
                async () => {
                    await enterModalKeys({count: c, key: ['shift', String(c)]}, 'h');
                },
                [0, -1 * c],
                editor
            );
            await movesCursorInEditor(
                async () => {
                    await enterModalKeys({count: c, key: ['shift', String(c)]}, 'k');
                },
                [-1 * c, 0],
                editor
            );
        }
        await movesCursorInEditor(
            async () => {
                await enterModalKeys(
                    {count: 1, key: ['shift', '1']},
                    {count: 0, key: ['shift', '0']},
                    'l'
                );
            },
            [0, 10],
            editor
        );
    });

    after(async () => {
        await storeCoverageStats('simpleMotion');
    });
});
