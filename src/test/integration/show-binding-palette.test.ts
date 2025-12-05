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
        const list = workbox.locator('#quickInput_list div');
        await expect(list.getByRole('option', { name: 'H/L, left/right' }).locator('a')).
            toBeVisible();
        await expect(list.getByRole('option', { name: 'J, down' }).locator('a')).
            toBeVisible();
        await expect(list.getByRole('option', { name: 'K, up' }).locator('a')).
            toBeVisible();
        await expect(list.getByRole('option', { name: 'I, insert mode' }).locator('a')).
            toBeVisible();

        const input = workbox.
            getByRole('textbox', { name: 'Run a command by pressing its' });
        await input.press('i');
        await expect(list.first()).toBeHidden();

        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: insert"]',
        );
        await expect(statusBarMode).toBeVisible();
    });

    test('Can toggle modes', async ({ workbox }) => {
        const { editor, pos } = await setup(workbox);

        await editor.press('Shift+;');
        let input = workbox.getByText('Master Key Commands (');
        await input.click();
        await input.press('Control+.');
        await input.click();
        input = workbox.getByRole('textbox', { name: 'Search the commands by their' });
        await input.pressSequentially('down');
        const list = workbox.locator('#quickInput_list div');
        await expect(list.getByRole('option', { name: 'H/L, left/right' }).locator('a')).
            toBeHidden();
        await expect(list.getByRole('option', { name: 'J, down' }).locator('a')).
            toBeVisible();
        await expect(list.getByRole('option', { name: 'K, up' }).locator('a')).
            toBeHidden();
        await expect(list.getByRole('option', { name: 'I, insert mode' }).locator('a')).
            toBeHidden();

        await input.press('Enter');
        await expect(pos).toHaveText('Ln 2, Col 1');
    });

    test('Can display after a delay', async ({ workbox }) => {
        const { editor } = await setup(workbox);

        await runCommand(workbox, 'Master Key: Toggle automatic display of quick-pick');
        await editor.press('w');
        const list = workbox.locator('#quickInput_list div');
        await expect(list.getByRole('option', { name: 'W, funny right' }).locator('a')).
            toBeVisible();
    });
});
