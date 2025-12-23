import { test, expect } from './config';
import { runCommand } from './utils';

// NOTE: ideally this would not be a playwright integration test, but a mocha unit test.
// However there is something about the isolated environment created by vscode's test-cli
// that prevents us from opening a new file within the extension and I don't care to debug
// that problem
test.describe('edit preset command', () => {
    test('creates a file', async ({ workbox }) => {
        await runCommand(workbox, 'Master key: New Keybinding Copy');
        const input = workbox.getByRole(
            'textbox',
            { name: 'Type to narrow down results.' },
        );
        await input.press('Enter');
        const fileTop = workbox.locator('div').
            filter({ hasText: /^#:master-keybindings$/ }).first();
        await expect(fileTop).toBeVisible();
    });
});
