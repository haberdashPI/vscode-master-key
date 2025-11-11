import { test, expect } from './config';
import { activateKeybindings, openFile } from './utils';
import { Page } from '@playwright/test';

test.describe('Recorded keypresses', () => {
    async function setup(workbox: Page) {
        await activateKeybindings(workbox, 'replayMotions.toml');
        await openFile(workbox, 'macro.md');
        const editor = workbox.getByLabel('macro.md').
            filter({ has: workbox.getByText('a b c ') }).
            filter({ has: workbox.getByRole('code') });
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
        // TODO: debug even though the editor reports that we're in normal mode
        // the keys aren't responding as such without pressing 'Escape' above
        // (oddly this doesn't happen when I debug the program)
        await editor.press('Escape');
        return { editor, pos };
    };

    test('Handles basic recording', async ({ workbox }) => {
        const { editor, pos } = await setup(workbox);
        await editor.press('Shift+q');
        await editor.press('l');
        await editor.press('j');
        await expect(pos).toHaveText('Ln 2, Col 2');
        await editor.press('Shift+q');
        await editor.press('q');
        await editor.press('q');
        await expect(pos).toHaveText('Ln 3, Col 3');
    });

    test('Replays history directly', async ({ workbox }) => {
        const { editor, pos } = await setup(workbox);

        await editor.press('l');
        await editor.press('j');
        await expect(pos).toHaveText('Ln 2, Col 2');
        await editor.press('q');
        await editor.press('l');
        await expect(pos).toHaveText('Ln 3, Col 2');
    });

    if (process.env.CI !== 'true') {
        test('Replays counts', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);

            await editor.press('Shift+q');
            await editor.press('Shift+3');
            await editor.press('l');
            await expect(pos).toHaveText('Ln 1, Col 4');
            await editor.press('Shift+q');
            await editor.press('q');
            await editor.press('q');
            await expect(pos).toHaveText('Ln 1, Col 7');
        });
    }

    if (process.env.CI !== 'true') {
        test('Replays search', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);
            await editor.press('Shift+q');
            await editor.press('/');
            const search = workbox.getByRole('textbox', { name: 'Search' });
            await search.pressSequentially('c d');
            await search.press('Enter');
            await expect(pos).toHaveText('Ln 1, Col 4');
            await editor.press('Shift+q');
            await editor.press('Shift+3');
            await editor.press('h');
            await editor.press('q');
            await editor.press('q');
            await expect(pos).toHaveText('Ln 1, Col 4');
        });
    }

    if (process.env.CI !== 'true') {
        test('Replays search with `acceptAfter`', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);
            await editor.press('Shift+q');
            await editor.press('t');
            await editor.press('c');
            await expect(pos).toHaveText('Ln 1, Col 4');
            await editor.press('Shift+q');
            await editor.press('Shift+3');
            await editor.press('h');
            await editor.press('q');
            await editor.press('q');
            await expect(pos).toHaveText('Ln 1, Col 4');
        });
    }

    if (process.env.CI !== 'true') {
        test('Replays search with canceled input', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);
            await editor.press('Shift+q');
            await editor.press('t');
            await editor.press('Escape');
            await editor.press('t');
            await editor.press('c');
            await expect(pos).toHaveText('Ln 1, Col 4');
            await editor.press('Shift+q');
            await editor.press('Shift+3');
            await editor.press('h');
            await editor.press('q');
            await editor.press('q');
            await expect(pos).toHaveText('Ln 1, Col 4');
        });
    }

    if (process.env.CI !== 'true') {
        test('Replays captures keys', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);
            await editor.press('Shift+q');
            await editor.press('s');
            await editor.press('c');
            await editor.press(' ');
            await expect(pos).toHaveText('Ln 1, Col 4');
            await editor.press('Shift+q');
            await editor.press('Shift+3');
            await editor.press('h');
            await editor.press('q');
            await editor.press('q');
            await expect(pos).toHaveText('Ln 1, Col 4');
        });
    }

    if (process.env.CI !== 'true') {
        test('Replays captures keys with cancel', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);
            await editor.press('Shift+q');
            await editor.press('s');
            await editor.press('Escape');
            await editor.press('s');
            await editor.press('c');
            await editor.press(' ');
            await expect(pos).toHaveText('Ln 1, Col 4');
            await editor.press('Shift+q');
            await editor.press('Shift+3');
            await editor.press('h');
            await editor.press('q');
            await editor.press('q');
            await expect(pos).toHaveText('Ln 1, Col 4');
        });
    }

    if (process.env.CI !== 'true') {
        test('Repeats replay using count', async ({ workbox }) => {
            const { editor, pos } = await setup(workbox);
            await editor.press('Shift+q');
            await editor.press('l');
            await expect(pos).toHaveText('Ln 1, Col 2');
            await editor.press('Shift+q');
            await editor.press('Shift+2');
            await editor.press('q');
            await editor.press('c');
            await expect(pos).toHaveText('Ln 1, Col 5');
        });
    }

    test('Replay stored commands', async ({ workbox }) => {
        const result = await setup(workbox);
        const pos = result.pos;
        let editor = result.editor;

        await editor.press('Shift+q');
        await editor.press('d');
        await editor.press('w');
        editor = workbox.getByLabel('macro.md').
            filter({ has: workbox.getByText('b c ') }).
            filter({ has: workbox.getByRole('code') });
        await editor.press('l');
        await expect(pos).toHaveText('Ln 1, Col 2');
        await editor.press('Shift+q');
        await editor.press('q');
        await editor.press('q');
        await expect(pos).toHaveText('Ln 1, Col 3');
        editor = workbox.getByLabel('macro.md').
            filter({ has: workbox.getByText('  c d') }).
            filter({ has: workbox.getByRole('code') });
        expect(editor).toBeVisible();
    });

    test('Can replay insert text', async ({ workbox }) => {
        const result = await setup(workbox);
        const pos = result.pos;
        let editor = result.editor;

        await editor.press('Shift+q');
        await editor.press('i');
        await editor.press('x');
        editor = workbox.locator('[id="workbench.parts.editor"]').
            getByRole('textbox', { name: 'The editor is not accessible' });
        await editor.press('Escape');
        await editor.press('Shift+q');
        await editor.press('q');
        await editor.press('q');
        await expect(pos).toHaveText('Ln 1, Col 3');
        expect(editor).toBeVisible();
    });

    test('Can nest replay', async ({ workbox }) => {
        const { editor, pos } = await setup(workbox);
        await editor.press('Shift+q');
        await editor.press('l');
        await editor.press('q');
        await editor.press('l');
        await expect(pos).toHaveText('Ln 1, Col 3');
        await editor.press('Shift+q');
        await editor.press('q');
        await editor.press('q');
        await expect(pos).toHaveText('Ln 1, Col 5');
    });

    // TODO: test repeating two macros
});
