import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import {
    movesCursorTo,
    setBindings,
    setupEditor,
    movesCursorInEditor,
    enterModalKeys,
    waitForMode,
    storeCoverageStats,
} from './utils.mts';
import { sleep, InputBox, TextEditor, Workbench } from 'wdio-vscode-service';

describe('Search motion command', () => {
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

            [[bind]]
            key = "shift+i"
            name = "insert"
            mode = "normal"
            command = "master-key.enterInsert"

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
            name = "search backwards"
            key = "shift+/"
            defaults = "search"
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
            defaults = "search"
            args.caseSensitive = true

            [[bind]]
            name = "search (case sensitive)"
            key = "w /"
            defaults = "search"
            args.wrapAround = true

            [[bind]]
            name = "to letter"
            key = "t"
            defaults = "search"
            args.acceptAfter = 1

            [[bind]]
            name = "to letter"
            key = "shift+t"
            defaults = "search"
            args.acceptAfter = 2

            [[bind]]
            name = "select search"
            key = "s /"
            defaults = "search"
            args.selectTillMatch = true

            [[bind]]
            name = "inclusive search"
            key = "i /"
            defaults = "search"
            args.offset = "inclusive"

            [[bind]]
            name = "inclusive search"
            key = "a /"
            defaults = "search"
            args.offset = "start"

            [[bind]]
            name = "inclusive search"
            key = "b /"
            defaults = "search"
            args.offset = "end"

            [[bind]]
            name = "preset search"
            key = "p /"
            defaults = "search"
            args.text = "point_"

            [[bind]]
            name = "regex search"
            key = "r /"
            defaults = "search"
            args.regex = true

            [[bind]]
            name = "register search"
            key = "shift+r /"
            defaults = "search"
            args.register = "other"

            [[bind]]
            name = "select word search"
            key = "e /"
            defaults = "search"
            command = "runCommands"
            args.commands = ["master-key.search", "cursorWordEndRightSelect"]

            [[bind]]
            name = "skip search"
            key = "shift+2 /"
            defaults = "search"
            args.skip = 1
        `);
        editor =
            await setupEditor(`foobar bum POINT_A Officia voluptate ex point_a commodo esse laborum velit
ipsum velit excepteur sunt cillum nulla adipisicing cupidatat. Laborum officia do mollit do
labore elit occaecat cupidatat non POINT_B.`);
        workbench = await browser.getWorkbench();
    });

    it('jumps to search location', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();
            },
            [0, 10],
            editor,
        );
    });

    it('can jump backwards', async () => {
        await editor.moveCursor(2, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: ['shift', '/'], updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();
            },
            [-1, 47],
            editor,
        );
    });

    it('follows `skip` argument', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys(['shift', '2'], { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();

                await input.setText('POINT_A');
                await input.confirm();
            },
            [0, 39],
            editor,
        );
    });

    it('handles case sensitive search', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_');
                await input.confirm();

                await enterModalKeys('n');
            },
            [0, 39],
            editor,
        );

        await editor.moveCursor(1, 1);
        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: [Key.Control, '/'], updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_');
                await input.confirm();

                await enterModalKeys('n');
            },
            [2, 34],
            editor,
        );
    });

    it('Can do a wrap-around search', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();

                await enterModalKeys('n');
                await enterModalKeys('n');
            },
            [0, 39],
            editor,
        );

        await editor.moveCursor(1, 1);

        await movesCursorTo(
            async () => {
                await enterModalKeys('w', { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();

                await enterModalKeys('n');
                await enterModalKeys('n');
            },
            [1, 11],
            editor,
        );
    });

    it('Can handle accept after', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 't', updatesStatus: false });
                await waitForMode('capture');
                await browser.keys('p');
                await waitForMode('normal');
            },
            [0, 10],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 't', updatesStatus: false });
                await waitForMode('capture');
                await browser.keys(Key.Escape);
                await waitForMode('normal');
            },
            [0, 0],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: 't', updatesStatus: false });
                await waitForMode('capture');
                await browser.keys('p');
                await waitForMode('normal');
            },
            [0, 20],
            editor,
        );
    });

    // broken test
    it.skip('Can handle delete char for acceptAfter', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: ['shift', 't'], updatesStatus: false });
                await waitForMode('capture');
                await browser.keys('po');
                await waitForMode('normal');
            },
            [0, 10],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: ['shift', 't'], updatesStatus: false });
                await waitForMode('capture');
                await browser.keys('p');
                // TODO: we don't really want to implement this with sleep
                // (there should be user feedback about captured keys)
                await sleep(100);
                await browser.keys(Key.Backspace);
                await sleep(100);
                await browser.keys('po');
                await waitForMode('normal');
            },
            [0, 20],
            editor,
        );
    });

    it('can select till match', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('s', { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();
            },
            [0, 11],
            editor,
        );

        expect(await editor.getSelectedText()).toEqual('foobar bum ');
    });

    it('Handles inclusive offset', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('i', { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();
            },
            [0, 17],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('n');
                await enterModalKeys(['shift', 'n']);
            },
            [0, -6],
            editor,
        );
    });

    it('Handles start offset', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('a', { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();
            },
            [0, 11],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('n');
                await enterModalKeys(['shift', 'n']);
            },
            [0, 0],
            editor,
        );
    });

    it('Handles end offset', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('b', { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_A');
                await input.confirm();
            },
            [0, 18],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('n');
                await enterModalKeys(['shift', 'n']);
            },
            [0, 0],
            editor,
        );
    });

    it('Accepts `text` argument.', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('p', { key: '/', updatesStatus: false });
            },
            [0, 10],
            editor,
        );
    });

    it('Handles `regex` option.', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('r', { key: '/', updatesStatus: false });
                const input = await new InputBox(workbench.locatorMap).wait();
                await input.setText('POINT_(A|B)');
                await input.confirm();
            },
            [0, 10],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('n');
            },
            [0, 29],
            editor,
        );

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('n');
            },
            [2, -5],
            editor,
        );
    });

    it('Handles multiple registers', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys({ key: '/', updatesStatus: false });
                const inputA = await new InputBox(workbench.locatorMap).wait();
                await inputA.setText('point_a');
                await inputA.confirm();

                await enterModalKeys(['shift', 'r'], { key: '/', updatesStatus: false });

                const inputB = await new InputBox(workbench.locatorMap).wait();
                await inputB.setText('point_b');
                await inputB.confirm();

                await enterModalKeys(['shift', 'n']);
            },
            [0, 47],
            editor,
        );
    });

    it('Handles post-search commands', async () => {
        await editor.moveCursor(1, 1);
        await enterModalKeys({ key: 'escape', updatesStatus: false });

        await movesCursorInEditor(
            async () => {
                await enterModalKeys('e', { key: '/', updatesStatus: false });
                const inputA = await new InputBox(workbench.locatorMap).wait();
                await inputA.setText('point_a');
                await inputA.confirm();
            },
            [0, 18],
            editor,
        );
        expect(await editor.getSelectedText()).toEqual(' POINT_A');
    });

    after(async () => {
        await browser.keys('escape');
        await browser.keys([Key.Shift, 'i']);
        await storeCoverageStats('searchMotion');
    });
});
