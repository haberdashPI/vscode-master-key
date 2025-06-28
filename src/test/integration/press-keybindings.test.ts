import { test, expect } from './config';
import { activateKeybinings, openFile } from './utils';

test.describe('Basic keypresses', () => {
    test('Commands respond appropriately to keypresses', async ({ workbox }) => {
        await activateKeybinings(workbox, 'simpleMotions.toml');
        await openFile(workbox, 'text.md');
        const editor = workbox.getByLabel('text.md').
            filter({ has: workbox.getByText('Commodo fugiat magna ') }).
            filter({ has: workbox.getByRole('code') });
        await editor.press('Escape');
        const pos = await workbox.getByRole('button').
            filter({ hasText: /Ln [0-9]+, Col [0-9]+/ });

        await editor.press('l');
        await expect(pos).toHaveText('Ln 1, Col 2');

        await editor.press('h');
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('j');
        await expect(pos).toHaveText('Ln 2, Col 1');

        await editor.press('k');
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('u');
        // wait for UX to no longer show U key being pressed
        await expect(workbox.locator('[id="haberdashPI.master-key.keys"]').
            getByLabel('No Keys Typed')).toBeHidden();
        // check that the keypress did nothing
        await expect(pos).toHaveText('Ln 1, Col 1');

        await editor.press('n');
        await expect(pos).toHaveText('Ln 1, Col 2');
    });
});
