import { expect } from './config';
import { Page } from '@playwright/test';

export async function openFile(page: Page, file: string) {
    await page.getByRole('main').press('ControlOrMeta+P');
    const openInput = await page.getByRole(
        'textbox',
        { name: 'Search files by name (append' },
    );
    await openInput.pressSequentially(file);
    await openInput.press('Enter', { delay: 100 });
    await openInput.waitFor({ state: 'detached' });
    return;
}

export async function runCommand(page: Page, command: string) {
    await page.getByRole('main').press('ControlOrMeta+Shift+P');
    const palette = await page.getByPlaceholder('Type the name of a command to run.');
    await palette.pressSequentially(command);
    await palette.press('Enter', { delay: 100 });
    await palette.waitFor({ state: 'detached' });
    return;
}

export async function activateKeybinings(page: Page, file: string) {
    // open binding file
    await openFile(page, file);

    // load current file as a keybinding
    await runCommand(page, 'Master Key: Activate Keybindings');
    const selectMethod = page.getByRole(
        'textbox',
        { name: 'Type to narrow down results' },
    );
    await expect(selectMethod).toBeFocused();
    await selectMethod.pressSequentially('Current File');
    await selectMethod.press('Enter');

    await expect(page.getByText('// AUTOMATED BINDINGS START').first()).toBeVisible();
    return;
}
