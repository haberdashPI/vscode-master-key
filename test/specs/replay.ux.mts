import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { movesCursorTo, setBindings, setupEditor, movesCursorInEditor, enterModalKeys, cursorToTop, waitForMode } from './utils.mts';
import { sleep, InputBox, TextEditor, Workbench } from 'wdio-vscode-service';
import lodash from 'lodash';
const { isEqual } = lodash;

describe('Search motion command', () => {
    let editor: TextEditor;
    let workbench: Workbench;

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
            description = "Enter normal mode"
            key = "escape"
            mode = []
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
            mode = "normal"
            name = "left (maybe down)"
            key = "shift+l"
            command = "runCommands"

            [[bind.args.commands]]
            command = "cursorMove"
            args.to = "left"

            [[bind.args.commands]]
            command = "cursorMove"
            args.to = "down"
            if = "count > 1"

            [[path]]
            name = "action"
            id = "action"
            default.mode = "normal"

            [[bind]]
            # NOTE: because of how vscode-extension-tester is implemented
            # numeric values get typed, so we use other keybindings here
            # to avoid picking up this typed keys
            foreach.num = ["{key: [0-3]}"]
            key = "shift+{num}"
            mode = "normal"
            name = "count {num}"
            command = "master-key.updateCount"
            args.value = "{num}"
            resetTransient = false

            [[bind]]
            name = "insert"
            key = "i"
            mode = "normal"
            command = "master-key.enterInsert"

            [[path]]
            name = "capture"
            id = "capture"
            default.mode = "normal"

            [[bind]]
            name = "1"
            key = "s"
            path = "capture"
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
            path = "capture"
            command = "master-key.replaceChar"

            [[bind]]
            name = "insert"
            key = "ctrl+i"
            path = "capture"
            command = "master-key.insertChar"

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
            name = "to letter"
            key = "t"
            path = "search"
            args.acceptAfter = 1

            [[path]]
            name = "replay"
            id = "replay"
            default.mode = "normal"

            [[bind]]
            path = "replay"
            name = "record"
            key = "shift+q"
            when = "!master-key.record"
            command = "master-key.record"
            args.on = true

            [[bind]]
            path = "replay"
            name = "record"
            key = "shift+q"
            when = "master-key.record"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.record"
            args.on = false

            [[bind.args.commands]]
            command = "master-key.pushHistoryToStack"
            args.range.from = 'commandHistory[i-1].name === "record"'
            args.range.to = "i"

            [[bind]]
            path = "replay"
            name = "replay"
            key = "q q"
            command = "master-key.replayFromStack"
            computedArgs.index = "count"

            [[bind]]
            path = "replay"
            name = "replay last"
            key = "q l"
            command = "master-key.replayFromHistory"
            args.at = "i"
        `);
        editor = await setupEditor(`a b c d
e f g h
i j k l`);
        workbench = await browser.getWorkbench();
    });

    // TODO: we found a genuine bug with the current implementation (this test fails
    // when reproducing it in a debug setup)
    it('Handles basic recording', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await enterModalKeys(['shift', 'q']);
        await waitForMode('rec: normal');
        await movesCursorInEditor(async () => {
            await enterModalKeys('l');
            await enterModalKeys('j');
        }, [1, 1], editor);
        await enterModalKeys(['shift', 'q']);
        await waitForMode('normal');

        await movesCursorInEditor(async () => {
            await enterModalKeys('q', 'q');
        }, [1, 1], editor);
    });

    // it('Captures keys', async () => {
    //     await editor.moveCursor(1, 1);
    //     await enterModalKeys('escape');

    //     await movesCursorInEditor(async () => {
    //         await enterModalKeys({key: 't', updatesStatus: false});
    //         await waitForMode('capture');
    //         await browser.keys('po');
    //         await waitForMode('normal');
    //     }, [0, 10], editor);
    // });

    // it('Captures saved keys', async () => {
    //     await editor.moveCursor(1, 1);
    //     await enterModalKeys('escape');

    //     let oldPos = editor.getCoordinates();
    //     await movesCursorInEditor(async () => {
    //         await enterModalKeys({key: 'f', updatesStatus: false});
    //         await browser.waitUntil(async () => !isEqual(oldPos, await editor.getCoordinates()));
    //     }, [0, 10], editor);
    // });

    // it('Handles escape during capture', async () => {
    //     await editor.moveCursor(1, 1);
    //     await enterModalKeys('escape');

    //     await movesCursorInEditor(async () => {
    //         await enterModalKeys({key: 't', updatesStatus: false});
    //         await waitForMode('capture');
    //         await browser.keys('p');
    //         // TODO: we should have some user feedback for captured keys
    //         // so this sleep wouldn't be necessary
    //         await sleep(1000);
    //         await browser.keys(Key.Escape);
    //         await waitForMode('normal');

    //         await enterModalKeys({key: 't', updatesStatus: false});
    //         await waitForMode('capture');
    //         await browser.keys('po');
    //         await waitForMode('normal');
    //     }, [0, 10], editor);
    // });

    // it('Replaces chars', async () => {
    //     await editor.moveCursor(1, 1);
    //     await enterModalKeys('escape');

    //     await enterModalKeys({key: 'r', updatesStatus: false});
    //     await waitForMode('capture');
    //     await browser.keys('p');
    //     // TODO: we should have some user feedback for captured keys
    //     // so this sleep wouldn't be necessary
    //     await sleep(1000);
    //     expect(await editor.getText()).toEqual(`poobar bum POINT_A`);
    // });

    // it('Inserts chars', async () => {
    //     await editor.moveCursor(1, 1);
    //     await enterModalKeys('escape');

    //     await enterModalKeys({key: 'i', updatesStatus: false});
    //     await waitForMode('capture');
    //     await browser.keys('f');
    //     // TODO: we should have some user feedback for captured keys
    //     // so this sleep wouldn't be necessary
    //     await sleep(1000);
    //     expect(await editor.getText()).toEqual(`fpoobar bum POINT_A`);
    // });
});
