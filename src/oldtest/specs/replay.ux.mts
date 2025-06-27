import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import {
    setBindings,
    setupEditor,
    movesCursorInEditor,
    enterModalKeys,
    waitForMode,
    storeCoverageStats,
} from './utils.mts';
import { sleep, InputBox, TextEditor, Workbench } from 'wdio-vscode-service';

describe('Replay', () => {
    let editor: TextEditor;
    let workbench: Workbench;

    before(async () => {
        await setBindings(`
            [header]
            version = "2.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

            [[bind]]
            description = "Enter normal mode"
            key = "escape"
            mode = []
            command = "master-key.enterNormal"
            prefixes = "{{all_prefixes}}"

            [[default]]
            id = "motion"
            name = "basic motions"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count || 1"

            [[bind]]
            defaults = "motion"
            name = "left"
            key = "h"
            args.to = "left"

            [[bind]]
            defaults = "motion"
            name = "right"
            key = "l"
            args.to = "right"

            [[bind]]
            defaults = "motion"
            name = "down"
            key = "j"
            args.to = "down"

            [[bind]]
            defaults = "motion"
            name = "up"
            key = "k"
            args.to = "up"

            [[bind]]
            mode = "normal"
            name = "left (maybe down)"
            key = "shift+l"
            command = "runCommands"

            [[bind.args.commands]]
            command = "cursorMove"
            computedArgs.value = "count || 1"
            args.to = "right"

            [[bind.args.commands]]
            command = "cursorMove"
            args.to = "down"
            whenComputed = "count > 1"

            [[default]]
            name = "action"
            id = "action"
            default.mode = "normal"

            [[bind]]
            foreach.num = ["{{key: [0-3]}}"]
            key = "shift+{{num}}"
            mode = "normal"
            name = "count {{num}}"
            command = "master-key.updateCount"
            args.value = "{{num}}"
            finalKey = false

            [[bind]]
            name = "insert"
            key = "i"
            mode = "normal"
            command = "master-key.enterInsert"

            [[default]]
            name = "capture"
            id = "capture"
            default.mode = "normal"

            [[bind]]
            name = "1"
            key = "s"
            defaults = "capture"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.captureKeys"
            args.acceptAfter = 2

            [[bind.args.commands]]
            command = "master-key.search"
            computedArgs.text = "captured"

            [[bind]]
            name = "replace"
            key = "r"
            defaults = "capture"
            command = "master-key.replaceChar"

            [[bind]]
            name = "insert"
            key = "ctrl+i"
            defaults = "capture"
            command = "master-key.insertChar"

            [[default]]
            name = "search"
            id = "search"
            default.mode = "normal"
            default.command = "master-key.search"

            [[bind]]
            name = "search"
            key = "/"
            defaults = "search"

            [[bind]]
            name = "to letter"
            key = "t"
            defaults = "search"
            args.acceptAfter = 1

            [[default]]
            name = "replay"
            id = "replay"
            default.mode = "normal"

            [[bind]]
            defaults = "replay"
            name = "record"
            key = "shift+q"
            when = "!master-key.record"
            command = "master-key.record"
            args.on = true

            [[bind]]
            defaults = "replay"
            name = "record"
            key = "shift+q"
            when = "master-key.record"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.record"
            args.on = false

            [[bind.args.commands]]
            command = "master-key.pushHistoryToStack"
            args.whereComputedRangeIs.from = 'commandHistory[index-1].name === "record"'
            args.whereComputedRangeIs.to = "index"

            [[bind]]
            defaults = "replay"
            name = "replay"
            key = "q q"
            command = "master-key.replayFromStack"
            computedArgs.index = "count"

            [[bind]]
            defaults = "replay"
            name = "replay repeat"
            key = "q c"
            command = "master-key.replayFromStack"
            computedRepeat = "count"

            [[bind]]
            defaults = "replay"
            name = "replay last"
            key = "q l"
            command = "master-key.replayFromHistory"
            args.whereComputedIndexIs = "index"

            [[bind]]
            defaults = "replay"
            name = "store macro"
            key = "q s"
            command = "master-key.storeNamed"
            args.description = "Save Macro"
            args.name = "macro"
            args.contents = "macro[macro.length-(count || 0)-1]"

            [[bind]]
            defaults = "replay"
            name = "replay stored"
            key = "q r"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.restoreNamed"
            args.description = "Replay Macro"
            args.name = "macro"

            [[bind.args.commands]]
            command = "master-key.pushHistoryToStack"
            computedArgs.value = "captured"

            [[bind.args.commands]]
            command = "master-key.replayFromStack"
            args.index = 0
        `);
        editor = await setupEditor(`a b c d
e f g h
i j k l`);
        workbench = await browser.getWorkbench();
    });

    it('Handles basic recording', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await waitForMode('rec: normal');
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('l');
                await enterModalKeys('j');
            },
            [1, 1],
            editor,
        );
        await enterModalKeys(['shift', 'q']);
        await waitForMode('normal');

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'q', updatesStatus: false });
            },
            [1, 1],
            editor,
        );
    });

    it('Replays from history', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('l');
                await enterModalKeys('j');
            },
            [1, 1],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'l', updatesStatus: false });
            },
            [1, 0],
            editor,
        );
    });

    it('Replays counts', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: ['shift', '3'], count: 3 }, 'l');
            },
            [0, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'q', updatesStatus: false });
            },
            [0, 3],
            editor,
        );
    });

    it('Replays `if` commands', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['shift', 'l']);
            },
            [0, 1],
            editor,
        );
        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'q', updatesStatus: false });
            },
            [0, 1],
            editor,
        );

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: ['shift', '3'], count: 3 }, ['shift', 'l']);
            },
            [1, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'q', updatesStatus: false });
            },
            [1, 3],
            editor,
        );
    });

    it('Replays search', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('c d');
                await input.confirm();
            },
            [0, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await editor.typeText('q');
                await editor.typeText('q');
            },
            [0, 3],
            editor,
        );
    });

    it('Replays search with `acceptAfter`', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 't', updatesStatus: false });
                await waitForMode('rec: capture');
                await browser.keys('c');
            },
            [0, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await editor.typeText('q');
                await editor.typeText('q');
            },
            [0, 3],
            editor,
        );
    });

    it('Replays search with canceled entry', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 't', updatesStatus: false });
                await waitForMode('rec: capture');
                browser.keys(Key.Escape);
                await waitForMode('rec: normal');
                await enterModalKeys({ key: 't', updatesStatus: false });
                await waitForMode('rec: capture');
                await browser.keys('c');
            },
            [0, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await editor.typeText('q');
                await editor.typeText('q');
            },
            [0, 3],
            editor,
        );
    });

    it('Replays captured keys', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 's', updatesStatus: false });
                await waitForMode('rec: capture');
                await browser.keys('c');
                // TODO: someday we can avoid this second long pause
                await sleep(1000);
                await browser.keys(' ');
            },
            [0, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await editor.typeText('q');
                await editor.typeText('q');
            },
            [0, 3],
            editor,
        );
    });

    it('Replays canceled capture keys', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 's', updatesStatus: false });
                await waitForMode('rec: capture');
                await browser.keys('c');
                // TODO: someday we can avoid this second long pause
                await sleep(1000);
                browser.keys(Key.Escape);
                await waitForMode('rec: normal');

                await enterModalKeys({ key: 's', updatesStatus: false });
                await waitForMode('rec: capture');
                await browser.keys('c');
                // TODO: someday we can avoid this second long pause
                await sleep(1000);
                await browser.keys(' ');
            },
            [0, 3],
            editor,
        );
        await enterModalKeys(['shift', 'q']);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await editor.typeText('q');
                await editor.typeText('q');
            },
            [0, 3],
            editor,
        );
    });

    it('Replaces chars', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await enterModalKeys({ key: 'r', updatesStatus: false });
        await waitForMode('rec: capture');
        await browser.keys('p');
        await waitForMode('rec: normal');
        await enterModalKeys(['shift', 'q']);

        let text = await editor.getText();
        expect(text).toEqual('p b c d\ne f g h\ni j k l');

        await editor.moveCursor(1, 3);
        await enterModalKeys('q', { key: 'q', updatesStatus: false });
        // TODO: not sure how to avoid this sleep... maybe we have some status
        // indicating a macro has finished running? (or e.g. we show a 'replying...'
        // status)
        await sleep(1500);

        text = await editor.getText();
        expect(text).toEqual('p p c d\ne f g h\ni j k l');
        await editor.setText('a b c d\ne f g h\ni j k l');
        await sleep(1000);
    });

    it('Insert chars', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await enterModalKeys({ key: ['ctrl', 'i'], updatesStatus: false });
        await waitForMode('rec: capture');
        await browser.keys('f');
        await waitForMode('rec: normal');
        await enterModalKeys(['shift', 'q']);

        let text = await editor.getText();
        expect(text).toEqual('fa b c d\ne f g h\ni j k l');

        await editor.moveCursor(1, 4);
        await enterModalKeys('q', { key: 'q', updatesStatus: false });
        // TODO: not sure how to avoid this sleep... maybe we have some status
        // indicating a macro has finished running? (or e.g. we show a 'replying...'
        // status)
        await sleep(1500);

        text = await editor.getText();
        expect(text).toEqual('fa fb c d\ne f g h\ni j k l');
    });

    it('Repeats replay using count', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await waitForMode('rec: normal');
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('l');
            },
            [0, 1],
            editor,
        );
        await enterModalKeys(['shift', 'q']);
        await waitForMode('normal');

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: ['shift', '2'], count: 2 }, 'q', {
                    key: 'c',
                    updatesStatus: false,
                });
            },
            [0, 3],
            editor,
        );
    });

    it('Can be stored/restored', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        // record move A
        await enterModalKeys(['shift', 'q']);
        await waitForMode('rec: normal');
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('l');
                await enterModalKeys('j');
            },
            [1, 1],
            editor,
        );
        await enterModalKeys(['shift', 'q']);
        await waitForMode('normal');

        // store move A
        await enterModalKeys('q', { key: 's', updatesStatus: false });
        await sleep(200);
        const saveInput = new InputBox(workbench.locatorMap);
        await saveInput.wait();
        await saveInput.setText('foo');
        await saveInput.confirm();

        // record move B
        await enterModalKeys(['shift', 'q']);
        await waitForMode('rec: normal');
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('h');
                await enterModalKeys('k');
            },
            [-1, -1],
            editor,
        );
        await enterModalKeys(['shift', 'q']);
        await waitForMode('normal');

        // replay move B
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'r', updatesStatus: false });
                await sleep(200);
                const restoreInput = new InputBox(workbench.locatorMap);
                await restoreInput.wait();
                await restoreInput.setText('foo');
                await saveInput.confirm();
            },
            [1, 1],
            editor,
        );
    });

    it('Handles nested replay', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await enterModalKeys(['shift', 'q']);
        await waitForMode('rec: normal');
        await movesCursorInEditor(
            async () => {
                await enterModalKeys('l');
                await enterModalKeys('q', { key: 'l', updatesStatus: false });
            },
            [0, 2],
            editor,
        );
        await enterModalKeys(['shift', 'q']);
        await waitForMode('normal');

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'q', updatesStatus: false });
            },
            [0, 2],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('q', { key: 'q', updatesStatus: false });
            },
            [0, 2],
            editor,
        );
    });

    after(async () => {
        await storeCoverageStats('replay');
    });
});
