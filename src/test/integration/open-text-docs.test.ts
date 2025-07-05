import { test, expect } from './config';
import { activateKeybinings, runCommand } from './utils';
import { Locator } from '@playwright/test';

test.describe('Text Documentation', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let docs: Locator;
    test.beforeEach(async ({ workbox }) => {
        await activateKeybinings(workbox, 'textDocExample.toml');
        await runCommand(workbox, 'Master Key: Show Text Documentation');
        docs = workbox.
            locator('iframe.webview.ready').contentFrame().
            locator('iframe[title="Preview Keybinding Documentation.md"]');
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Has first section', async ({ workbox }) => {
        const section = docs.contentFrame().getByRole('heading', { name: 'First Section' });
        expect(section).toBeTruthy();

        const rows = docs.contentFrame().locator('table').first().locator('tr');
        await expect(rows).toHaveCount(5);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Has second section', async ({ workbox }) => {
        const section = docs.contentFrame().
            getByRole('heading', { name: 'Second Section' });
        expect(section).toBeTruthy();

        const rows = docs.contentFrame().locator('table').nth(1).locator('tr');
        await expect(rows).toHaveCount(4);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Hides `#-` comments', async ({ workbox }) => {
        const paragraph = docs.contentFrame().locator('div.markdown-body p').first();
        expect(paragraph).toBeVisible();
        const text = await paragraph.textContent();
        expect(text).not.toMatch(/IGNORED/);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Has final paragarph', async ({ workbox }) => {
        const paragraph = docs.contentFrame().locator('div.markdown-body p').nth(2);
        const text = await paragraph.textContent();
        expect(text).toMatch('Final paragraph shows up.');
    });
});
