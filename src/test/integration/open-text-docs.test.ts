import { test, expect } from './config';
import { activateKeybindings, runCommand } from './utils';
import { Locator } from '@playwright/test';

test.describe('Text Documentation', () => {
    let docs: Locator;
    test.beforeEach(async ({ workbox }) => {
        await activateKeybindings(workbox, 'textDocExample.toml');
        await runCommand(workbox, 'Master Key: Show Text Documentation');
        docs = workbox.
            locator('iframe.webview.ready').contentFrame().
            locator('iframe[title="Preview Keybinding Documentation.md"]');
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test.fail('Has first section', async ({ workbox }) => {
        const section = docs.contentFrame().getByRole('heading', { name: 'First Section' });
        await expect(section).toBeTruthy();

        const rows = docs.contentFrame().locator('table').first().locator('tr');
        await expect(rows).toHaveCount(5);
    });
});
