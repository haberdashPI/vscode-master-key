import { test, expect } from './config';
import { activateKeybindings, openFile } from './utils';
import { Page } from '@playwright/test';

test.describe('Basic keypresses', () => {
    async function setup(workbox: Page, file: string) {
        await activateKeybindings(workbox, file);
        await openFile(workbox, 'text.md');
        const editor = workbox.getByLabel('text.md').
            filter({ has: workbox.getByText('Commodo fugiat magna ') }).
            filter({ has: workbox.getByRole('code') });
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });
        // TODO: debug even though the editor reports that we're in normal mode
        // the keys aren't responding as such without pressing 'Escape' above
        // (oddly this doesn't happen when I debug the program)
        await editor.press('Escape');
        return { editor, pos };
    };

    const testVariants = [
        ['', 'simpleMotions.toml'],
        [' using layout invariant bindings', 'simpleMotionsLayout.toml'],
    ];
    for (const [label, file] of testVariants) {
        // we leave `workbox` in because we often want to use it to debug this test
        test('Move the cursor' + label, async ({ workbox }) => {
            const { editor, pos } = await setup(workbox, file);
            await editor.press('l');
            await expect(pos).toHaveText('Ln 1, Col 2');

            await editor.press('h');
            await expect(pos).toHaveText('Ln 1, Col 1');

            await editor.press('j');
            await expect(pos).toHaveText('Ln 2, Col 1');

            await editor.press('k');
            await expect(pos).toHaveText('Ln 1, Col 1');
        });

        test('Can change the key mode' + label, async ({ workbox }) => {
            const { editor, pos } = await setup(workbox, file);
            await editor.press('Escape');
            // TODO: debug even though the editor reports that we're in normal mode
            // the keys aren't responding as such without pressing 'Escape' above

            const cursor = workbox.locator('div[role="presentation"].cursors-layer');
            await expect(cursor).toHaveClass(/cursor-block-style/);
            let statusBarMode = workbox.locator(
                'div[aria-label="Keybinding Mode: normal"]',
            );
            await expect(statusBarMode).toHaveClass(/warning-kind/);

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
            await expect(cursor).not.toHaveClass(/cursor-block-style/);
            statusBarMode = workbox.locator('div[aria-label="Keybinding Mode: insert"]');
            await expect(statusBarMode).not.toHaveClass(/warning-kind/);

            await editor.press('j');
            await expect(pos).toHaveText('Ln 1, Col 3');
        });

        test('Can change cursor shape when using a delayed action' + label,
            async ({ workbox }) => {
                const { editor } = await setup(workbox, file);
                await editor.press('Escape');
                const cursor = workbox.locator('div[role="presentation"].cursors-layer');
                await expect(cursor).toHaveClass(/cursor-block-style/);

                await editor.press('d');
                // assert cursor state
                await expect(cursor).toHaveClass(/cursor-underline-style/);

                // execute the action
                await editor.press('w');
                await expect(cursor).toHaveClass(/cursor-block-style/);
            },
        );

        test('Can use number prefixes' + label, async ({ workbox }) => {
            const { editor, pos } = await setup(workbox, file);
            await editor.press('3');
            await editor.press('l');
            await expect(pos).toHaveText('Ln 1, Col 4');
        });
    }

    test('Can leverage fallback bindings', async ({ workbox }) => {
        const { editor, pos } = await setup(workbox, 'simpleMotions.toml');
        await editor.press('Shift+g');
        const statusBarMode = workbox.locator(
            'div[aria-label="Keybinding Mode: normal-left"]',
        );
        await expect(statusBarMode).toBeAttached();

        await editor.press('3');
        await editor.press('l');
        await expect(pos).toHaveText('Ln 1, Col 4');

        await editor.press('Shift+h');
        await expect(pos).toHaveText('Ln 1, Col 3');

        await editor.press('Shift+l');
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('h');
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('j');
        await expect(pos).toHaveText('Ln 2, Col 1');

        await editor.press('k');
        await expect(pos).toHaveText('Ln 1, Col 1');
    });
});
