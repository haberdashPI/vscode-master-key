import { test, expect } from './config';
import { activateKeybindings, openFile } from './utils';
import { Page } from '@playwright/test';

test.describe('Debug expressions', () => {
    async function setup(workbox: Page) {
        await activateKeybindings(workbox, 'debugBindings.toml');
        await openFile(workbox, 'text.md');
        const editor = workbox.getByLabel('text.md').
            filter({ has: workbox.getByText('Commodo fugiat magna ') }).
            filter({ has: workbox.getByRole('code') });
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
        // TODO: debug even though the editor reports that we're in normal mode
        // the keys aren't responding as such without pressing 'Escape' above
        // (oddly this doesn't happen when I debug the program)
        await editor.press('Escape');
        return { editor, pos };
    };

    test('Debug shows when there\'s no error', async ({ workbox }) => {
        const { editor, pos } = await setup(workbox);
        await editor.press('a');
        await expect(pos).toHaveText('Ln 1, Col 4');

        const output = workbox.getByLabel('Master Key - Output');
        const content = output.getByRole('code').locator('div');
        const item = content.filter({ hasText: '] sum:' }).first();
        await expect(item).toBeVisible();
    });

    if (process.env.CI !== 'true') {
        test('Debug shows after error', async ({ workbox }) => {
            const { editor } = await setup(workbox);
            await editor.press('b');

            const output = workbox.getByLabel('Master Key - Output');
            const content = output.getByRole('code').locator('div');
            const item = content.filter({ hasText: '] result:' }).first();
            await expect(item).toBeVisible();
        });
    }
});
