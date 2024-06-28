import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { setBindings, setupEditor, movesCursorInEditor, enterModalKeys, cursorToTop } from './utils.mts';
import { InputBox, TextEditor, Workbench } from 'wdio-vscode-service';

describe('Search motion command', () => {
    let editor: TextEditor;
    let workbench: Workbench;

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
        workbench = await browser.getWorkbench();
    });

    it('jumps to search location', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: '/', updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_A');
            await input.confirm();
        }, [0, 10], editor);
    });

    it('can jump backwards', async () => {
        await editor.moveCursor(2, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: ['shift', '/'], updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_A');
            await input.confirm();
        }, [-1, 47], editor);
    });

    it('follows `skip` argument', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys(['shift', '2'], {key: '/', updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();

            await input.setText('POINT_A');
            await input.confirm();
        }, [0, 39], editor);
    });

    it('handles case sensitive search', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: '/', updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_');
            await input.confirm();

            await enterModalKeys('n');
        }, [0, 39], editor);

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(async () => {
            await enterModalKeys({key: [Key.Control, '/'], updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_');
            await input.confirm();

            await enterModalKeys('n');
        }, [2, 34], editor);
    });

    // TODO: currently failing
    it.only('Can do a wrap-around search', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys('escape');

        await movesCursorInEditor(async () => {
            await enterModalKeys({key: '/', updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_');
            await input.confirm();

            await enterModalKeys('n');
            await enterModalKeys('n');
        }, [0, 39], editor);

        await cursorToTop(editor);

        await movesCursorInEditor(async () => {
            await enterModalKeys('w', {key: '/', updatesStatus: false});
            const input = await (new InputBox(workbench.locatorMap)).wait();
            await input.setText('POINT_A');
            await input.confirm();

            await enterModalKeys('n');
            await enterModalKeys('n');
        }, [0, 10], editor);
    });
});
