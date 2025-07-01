import { test, expect } from './config';
import { activateKeybinings, openFile } from './utils';
import { Locator } from '@playwright/test';

test.describe('Basic keypresses', () => {
    let editor: Locator;
    let pos: Locator;

    test.beforeEach(async ({ workbox }) => {
        await activateKeybinings(workbox, 'simpleMotions.toml');
        await openFile(workbox, 'text.md');
        editor = workbox.getByLabel('text.md').
            filter({ has: workbox.getByText('Commodo fugiat magna ') }).
            filter({ has: workbox.getByRole('code') });
        pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
    });

    test('Move the cursor', async ({ workbox }) => {
        await editor.press('l');
        await expect(pos).toHaveText('Ln 1, Col 2');

        await editor.press('h');
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('j');
        await expect(pos).toHaveText('Ln 2, Col 1');

        await editor.press('k');
        await expect(pos).toHaveText('Ln 1, Col 1');
    });

    test('Can change the key mode', async ({ workbox }) => {
        let cursor = workbox.locator('div[role="presentation"].cursors-layer');
        expect(cursor).toHaveClass(/cursor-block-style/);
        let statusBarMode = workbox.locator('div[aria-label="Keybinding Mode: normal"]');
        expect(statusBarMode).toHaveClass(/warning-kind/);

        await editor.press('u');
        // wait for UX to no longer show U key being pressed
        await workbox.waitForTimeout(250); // give some time for the key to be pressed
        await expect(workbox.locator('[id="haberdashPI.master-key.keys"]').
            getByLabel('No Keys Typed')).toBeHidden();
        // check that the keypress did nothing
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('n');
        await expect(pos).toHaveText('Ln 1, Col 2');

        // changing mode changes the effect of key presses
        await editor.press('i');
        expect(cursor).not.toHaveClass(/cursor-block-style/);
        statusBarMode = workbox.locator('div[aria-label="Keybinding Mode: insert"]');
        expect(statusBarMode).not.toHaveClass(/warning-kind/);

        await editor.press('j');
        await expect(pos).toHaveText('Ln 1, Col 3');
    });

    test('Can change cursor shape when using a delayed action', async ({ workbox }) => {
        await editor.press('Escape');
        await editor.press('d')
        // assert cursor state
        const cursor = workbox.locator('div[role="presentation"].cursors-layer');
        expect(cursor).toHaveClass(/cursor-underline-style/);

        // execute the action
        await editor.press('w')
        expect(cursor).toHaveClass(/cursor-block-style/);
    });
});
