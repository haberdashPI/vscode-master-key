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

            [[bind]]
            description = "Enter normal mode"
            key = "escape"
            mode = []
            command = "master-key.enterNormal"
            prefixes = "<all-prefixes>"

            [[path]]
            name = "capture"
            id = "capture"
            default.mode = "normal"

            [[bind]]
            name = "1"
            key = "t"
            path = "capture"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.captureKeys"
            args.acceptAfter = 2

            [[bind.args.commands]]
            command = "master-key.search"
            computedArgs.text = "captured"

            [[bind]]
            name = "1"
            key = "f"
            path = "capture"
            command = "runCommands"

            [[bind.args.commands]]
            command = "master-key.captureKeys"
            args.text = "po"
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
            name = "replace"
            key = "i"
            path = "capture"
            command = "master-key.insertChar"
        `);
        editor = await setupEditor(`foobar bum POINT_A`);
        workbench = await browser.getWorkbench();
    });

    it('Captures keys', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: 't', updatesStatus: false});
            await waitForMode('capture');
            await browser.keys('po');
            await waitForMode('normal');
        }, [0, 10], editor);
    });

    it('Captures saved keys', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: 'f', updatesStatus: false});
        }, [0, 10], editor);
    });

    it('Handles escape during capture', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: 't', updatesStatus: false});
            await waitForMode('capture');
            await browser.keys('p');
            // TODO: we should have some user feedback for captured keys
            // so this sleep wouldn't be necessary
            await sleep(1000);
            await browser.keys(Key.Escape);
            await waitForMode('normal');

            await enterModalKeys({key: 't', updatesStatus: false});
            await waitForMode('capture');
            await browser.keys('po');
            await waitForMode('normal');
        }, [0, 10], editor);
    });

    it('Replaces chars', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await enterModalKeys({key: 'r', updatesStatus: false});
        await waitForMode('capture');
        await browser.keys('p');
        // TODO: we should have some user feedback for captured keys
        // so this sleep wouldn't be necessary
        await sleep(1000);
        expect(await editor.getText()).toEqual(`poobar bum POINT_A`);
    });

    it('Inserts chars', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await enterModalKeys({key: 'i', updatesStatus: false});
        await waitForMode('capture');
        await browser.keys('f');
        // TODO: we should have some user feedback for captured keys
        // so this sleep wouldn't be necessary
        await sleep(1000);
        expect(await editor.getText()).toEqual(`fpoobar bum POINT_A`);
    });
});
