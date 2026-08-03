import { test, expect } from './config';
import { activateKeybindings, openFile, runCommand } from './utils';

test.describe('Configuration Updates', () => {
    test('Can add/remove bindings', async ({ workbox }) => {
        await activateKeybindings(workbox, 'simpleMotions.toml');
        await openFile(workbox, 'text.md');
        await workbox.keyboard.press('Escape');
        const activateMessage = workbox.getByLabel(
            'Master keybindings were added to \`keybindings.json\`.',
        ).first();
        await expect(activateMessage).toBeAttached();
        await runCommand(workbox, 'Master Key: Deactivate Keybindings');
        // NOTE: used to be required here
        // await workbox.getByRole(
        //   'button',
        //   { name: 'Close Modal Editor (Escape)' }
        // ).click();

        const cursor = workbox.locator('div[role="presentation"].cursors-layer');
        await expect(cursor.first()).toHaveClass(/cursor-line-style/);

        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: default"]',
        );
        await expect(statusBarMode).toBeAttached();
    });

    test('Can add and run bindings from `source`', async ({ workbox }) => {
        await activateKeybindings(workbox, 'vimSource.toml');

        await openFile(workbox, 'macro.md');
        const editor = workbox.getByLabel('macro.md').
            filter({ has: workbox.getByText('a b c ') }).
            filter({ has: workbox.getByRole('code') });
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
        const activateMessage = workbox.getByLabel(
            'Master keybindings were added to \`keybindings.json\`.',
        ).first();
        await expect(activateMessage).toBeAttached();

        await editor.press('l');
        await expect(pos).toHaveText('Ln 1, Col 2');

        await editor.press('h');
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('Shift+k');
        await expect(pos).toHaveText('Ln 1, Col 2');
    });
});
