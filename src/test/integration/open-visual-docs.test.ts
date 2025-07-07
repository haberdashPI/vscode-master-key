import { test, expect } from './config';
import { activateKeybindings, openFile, runCommand } from './utils';
import { Locator } from '@playwright/test';

test.describe('Visual Documentation', () => {
    let docs: Locator;
    test.beforeEach(async ({ workbox }) => {
        await activateKeybindings(workbox, 'visualDocExample.toml');
        await runCommand(workbox, 'Master Key: Show Visual Documentation');
        // TODO: I haven't figured out how to remove this fragile step yet
        workbox.waitForTimeout(500);
        const frame = workbox.locator('iframe.webview.ready');
        await frame.waitFor({ state: 'attached' });
        docs = frame.contentFrame().locator('iframe[title="Master Key Bindings"]');

        // TODO: why do I have to type this?
        await workbox.keyboard.press('Escape');
        await workbox.waitForTimeout(500);
    });

    function getKey(row: number, col: number, location: 'top' | 'bottom' = 'bottom') {
        const keyboard = docs.contentFrame().locator('div.keyboard');
        const keyRow = keyboard.locator('div.keyboard-row').nth(row);
        const keyContent = keyRow.locator('div.key').nth(col);

        return {
            label: keyContent.locator(`div.label.${location}`),
            name: keyContent.locator(`div.name.${location}`),
        };
    }

    function checkKey(
        label: string,
        name: string,
        color: string,
        key: { label: Locator; name: Locator },
    ) {
        expect(key.label).toHaveText(label);
        expect(key.name).toHaveText(name);
        expect(key.name).toHaveClass(RegExp(`kind-color-${color}`));
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test('Labels Keys', async ({ workbox }) => {
        checkKey('H', 'left', '0', getKey(3, 6));
        checkKey('J', 'down', '0', getKey(3, 7));
        checkKey('K', 'up', '1', getKey(3, 8));
        checkKey('L', 'right', '1', getKey(3, 9));
    });

    test('Updates on prefix', async ({ workbox }) => {
        await openFile(workbox, 'text.md');
        await workbox.keyboard.press('w');
        const name = getKey(3, 6).name;
        for (let i = 0; i < 10; i++) {
            const text = await name.textContent();
            if (text !== 'left') break;
            await workbox.waitForTimeout(100);
        }
        expect(name).not.toHaveText('left');

        const key = getKey(2, 2);
        for (let i = 0; i < 10; i++) {
            const text = await key.name.textContent();
            if (text === 'funny right') break;
            await workbox.waitForTimeout(100);
        }
        checkKey('W', 'funny right', '1', key);
    });

    test('Layout toggles by command', async ({ workbox }) => {
        checkKey('I', 'insert mode', '1', getKey(2, 8));
        checkKey('^I', 'magic insert', '1', getKey(2, 8, 'top'));
        checkKey('^O', 'magic outsert', '1', getKey(2, 9, 'top'));

        await runCommand(workbox, 'Master Key: Toggle Visual Doc Modifiers');

        const key = getKey(2, 8, 'top');
        for (let i = 0; i < 10; i++) {
            const text = await key.name.textContent();
            if (text === 'evil insert') break;
            await workbox.waitForTimeout(100);
        }
        checkKey('⌥I', 'evil insert', '1', key);
        checkKey('I', 'insert mode', '1', getKey(2, 8));
        checkKey('⌥O', '', 'none', getKey(2, 9, 'top'));
    });
});
