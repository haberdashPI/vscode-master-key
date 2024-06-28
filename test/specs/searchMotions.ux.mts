import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { setBindings, setupEditor, movesCursorInEditor, enterModalKeys } from './utils.mts';
import { InputBox, TextEditor } from 'wdio-vscode-service';

describe('Search motion commands', () => {
    let editor: TextEditor;
    before(async () => {
        await setBindings(`
            [header]
            version = "1.0"

            [define]
            validModes = ["insert", "capture", "normal"]

            [[bind]]
            description = "Enter normal mode"
            key = "escape"
            mode = []
            command = "master-key.enterNormal"
            prefixes = "<all-prefixes>"

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
            name = "search backwards"
            key = "shift+/"
            path = "search"
            args.backwards = true

            [[bind]]
            name = "next"
            key = "n"
            mode = "normal"
            command = "master-key.nextMatch"

            [[bind]]
            name = "previous"
            key = "shift+n"
            mode = "normal"
            command = "master-key.previousMatch"

            [[bind]]
            name = "search (case sensitive)"
            key = "ctrl+/"
            path = "search"
            args.caseSensitive = true

            [[bind]]
            name = "delete last search char"
            key = "backspace"
            command = "deleteLastSearchChar"

            [[bind]]
            name = "search (case sensitive)"
            key = "w /"
            path = "search"
            args.wrapAround = true

            [[bind]]
            name = "to letter"
            key = "t"
            path = "search"
            args.acceptAfter = 1

            [[bind]]
            name = "to letter"
            key = "shift+t"
            path = "search"
            args.acceptAfter = 2

            [[bind]]
            name = "select search"
            key = "s /"
            path = "search"
            args.selectTillMatch = true

            [[bind]]
            name = "inclusive search"
            key = "i /"
            path = "search"
            args.offset = "inclusive"

            [[bind]]
            name = "inclusive search"
            key = "a /"
            path = "search"
            args.offset = "start"

            [[bind]]
            name = "inclusive search"
            key = "b /"
            path = "search"
            args.offset = "end"

            [[bind]]
            name = "preset search"
            key = "p /"
            path = "search"
            args.text = "point_"

            [[bind]]
            name = "regex search"
            key = "r /"
            path = "search"
            args.regex = true

            [[bind]]
            name = "register search"
            key = "shift+r /"
            path = "search"
            args.register = "other"

            [[bind]]
            name = "select word search"
            key = "e /"
            path = "search"
            command = "runCommands"
            args.commands = ["master-key.search", "cursorWordEndRightSelect"]

            [[bind]]
            name = "skip search"
            key = "shift+2 /"
            path = "search"
            args.skip = 1
        `);
        editor = await setupEditor(`foobar bum POINT_A Officia voluptate ex point_a commodo esse laborum velit
ipsum velit excepteur sunt cillum nulla adipisicing cupidatat. Laborum officia do mollit do
labore elit occaecat cupidatat non POINT_B.`);
    });

    it('jumps to search location', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');
        const workbench = await browser.getWorkbench();

        await movesCursorInEditor(async () => {
            // we don't use enterModalKeys because `/` doesn't show up in the status bar
            // (and `enterModalKeys` expects this to happen)
            await browser.keys('/');
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_A');
            await input.confirm();
        }, [0, 10], editor);
    });

    it('can jump backwards', async () => {
        await editor.moveCursor(2, 1);
        await enterModalKeys('escape');
        const workbench = await browser.getWorkbench();

        await movesCursorInEditor(async () => {
            // we don't use enterModalKeys because `shift+/` doesn't show up in the status bar
            // (and `enterModalKeys` expects this to happen)
            await browser.keys([Key.Shift, '/']);
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_A');
            await input.confirm();
        }, [-1, 47], editor);
    });
});
