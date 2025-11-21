import { test, expect } from './config';
import { activateKeybindings, openFile } from './utils';
import { Page } from '@playwright/test';

test.describe('mode.whenNoBindings.run option', () => {
    async function setup(workbox: Page) {
        await activateKeybindings(workbox, 'replaceCharsMode.toml');
        await openFile(workbox, 'text.md');
        const editor = workbox.getByLabel('text.md').
            filter({ has: workbox.getByText('fugiat magna ') }).
            filter({ has: workbox.getByRole('code') });
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
        return { editor, pos };
    };

    test('replaces chars', async ({ workbox }) => {
        const result = await setup(workbox);
        const pos = result.pos;
        let editor = result.editor;

        await editor.pressSequentially('This is a test of replace ');
        let newText = workbox.getByText('This is a test of replace ');
        await expect(newText).toBeVisible();
        await expect(pos).toHaveText('Ln 1, Col 27');
        editor = workbox.locator('[id="workbench.parts.editor"]').
            getByRole('textbox', { name: 'The editor is not accessible' });
        await editor.press('Alt+Shift+r');
        // wait for mode to change
        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: replace"]',
        );
        await expect(statusBarMode).toBeVisible();
        await editor.pressSequentially('mode ', { delay: 100 });
        newText = workbox.getByText('replace mode do');
        await expect(newText).toBeVisible();
    });
});
