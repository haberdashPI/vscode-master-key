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
        expect(cursor).toHaveClass(/cursor-line-style/);

        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: default"]',
        );
        expect(statusBarMode).toBeAttached();
    });
});
