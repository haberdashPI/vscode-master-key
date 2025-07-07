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
    test('Has first section', async ({ workbox }) => {
        const section = docs.contentFrame().getByRole('heading', { name: 'First Section' });
        await expect(section).toBeTruthy();

        const rows = docs.contentFrame().locator('table').first().locator('tr');
        await expect(rows).toHaveCount(5);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Has second section', async ({ workbox }) => {
        const section = docs.contentFrame().
            getByRole('heading', { name: 'Second Section' });
        await expect(section).toBeTruthy();

        const rows = docs.contentFrame().locator('table').nth(1).locator('tr');
        await expect(rows).toHaveCount(4);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Hides `#-` comments', async ({ workbox }) => {
        const paragraph = docs.contentFrame().locator('div.markdown-body p').first();
        await expect(paragraph).toBeVisible();
        const text = await paragraph.textContent();
        await expect(text).not.toMatch(/IGNORED/);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Has final paragraph', async ({ workbox }) => {
        const paragraph = docs.contentFrame().locator('div.markdown-body p').nth(2);
        const text = await paragraph.textContent();
        await expect(text).toMatch('Final paragraph shows up.');
    });
});
