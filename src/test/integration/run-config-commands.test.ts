import { test, expect } from './config';
import { activateKeybindings, openFile, runCommand } from './utils';

test.describe('Visual Documentation', () => {
    test.beforeEach(async ({ workbox }) => {
        await activateKeybindings(workbox, 'simpleMotions.toml');
        await openFile(workbox, 'text.md');
        await workbox.keyboard.press('Escape');
    });

    test('Can remove bindings', async ({ workbox }) => {
        await runCommand(workbox, 'Master Key: Deactivate Keybindings');

        const cursor = workbox.locator('div[role="presentation"].cursors-layer');
        await expect(cursor).toHaveClass(/cursor-line-style/);

        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: default"]',
        );
        await expect(statusBarMode).toBeAttached();
    });

    test('Can add/remove user bindings', async ({ workbox }) => {
        await openFile(workbox, 'userBindings.toml');
        await runCommand(workbox, 'Master Key: Activate User Keybindings');
        const pos = workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });

        await workbox.keyboard.press('r');
        await expect(pos).toHaveText('Ln 2, Col 1');

        await runCommand(workbox, 'Master Key: Deactivate User Keybindings');
        await workbox.waitForTimeout(1000);
        await workbox.keyboard.press('r');
        await expect(pos).toHaveText('Ln 2, Col 2');
    });
});
