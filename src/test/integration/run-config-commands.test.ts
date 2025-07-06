import { test, expect } from './config';
import { activateKeybinings, openFile, runCommand } from './utils';
import { Locator } from '@playwright/test';

test.describe('Visual Documentation', () => {
    test.beforeEach(async ({ workbox }) => {
        await activateKeybinings(workbox, 'simpleMotions.toml');
        await openFile(workbox, 'text.md');
        await workbox.keyboard.press('Escape');
    });

    test('Can remove bindings', async ({ workbox }) => {
        await runCommand(workbox, 'Master Key: Deactivate Keybindings');
    });
});
