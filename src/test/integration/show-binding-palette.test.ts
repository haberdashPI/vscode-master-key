import { test, expect } from './config';
import { activateKeybindings, openFile, runCommand } from './utils';
import { Page } from '@playwright/test';

test.describe('command palette', () => {
    async function setup(workbox: Page) {
        await activateKeybindings(workbox, 'paletteBinding.toml');
        await openFile(workbox, 'text.md');
        const editor = workbox.getByLabel('text.md').
            filter({ has: workbox.getByText('fugiat magna ') }).
            filter({ has: workbox.getByRole('code') });
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
        await editor.press('Escape');
        return { editor, pos };
    };

    test('shows all bindings', async ({ workbox }) => {
        const { editor } = await setup(workbox);

        await editor.press('Shift+;');
        await expect(workbox.getByText('H/Lleft/right')).toBeVisible();
        await expect(workbox.getByText('Jdown')).toBeVisible();
        await expect(workbox.getByText('Kup')).toBeVisible();
        await expect(workbox.getByText('Iinsert mode')).toBeVisible();

        await editor.press('i');

        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: insert"]',
        );
        await expect(statusBarMode).toBeVisible();
    });

    if (process.env.CI !== 'true') {
        test('Can display after a delay', async ({ workbox }) => {
            const { editor } = await setup(workbox);

            await runCommand(workbox, 'Master Key: Toggle automatic display of quick-pick');
            await editor.press('w');
            await expect(workbox.getByText('Wfunny right')).toBeVisible();
        });
    }
});
