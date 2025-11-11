import { test, expect } from './config';
import { activateKeybindings, openFile, runCommand } from './utils';

test.describe('Configuration Updates', () => {
    test.beforeEach(async ({ workbox }) => {
        await activateKeybindings(workbox, 'simpleMotions.toml');
        await openFile(workbox, 'text.md');
        await workbox.keyboard.press('Escape');
    });

    test('Can add/remove bindings', async ({ workbox }) => {
        const activateMessage = workbox.getByLabel(
            'Master keybindings were added to \`keybindings.json\`.',
        ).first();
        await expect(activateMessage).toBeAttached();
        await runCommand(workbox, 'Master Key: Deactivate Keybindings');

        const cursor = workbox.locator('div[role="presentation"].cursors-layer');
        await expect(cursor.first()).toHaveClass(/cursor-line-style/);

        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: default"]',
        );
        await expect(statusBarMode).toBeAttached();
    });
});
