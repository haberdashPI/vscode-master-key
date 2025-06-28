import { expect } from './config';
import { Page } from '@playwright/test';

export async function openFile(page: Page, file: string) {
    await page.getByRole('main').press('ControlOrMeta+P');
    const openInput = await page.getByRole(
        'textbox',
        { name: 'Search files by name (append' },
    );
    await openInput.fill(file);
    await openInput.press('Enter');
    await expect(openInput).toBeHidden();
    return;
}

export async function runCommand(page: Page, command: string) {
    await page.getByRole('main').press('ControlOrMeta+Shift+P');
    const palette = await page.getByPlaceholder('Type the name of a command to run.');
    await palette.fill('>' + command);
    await palette.press('Enter');
    await expect(palette).toBeHidden();
    return;
}

export async function activateKeybinings(page: Page, file: string) {
    await runCommand(page, 'Master Key: Activate Keybindings');

    // ask to enter a filename
    const selectMethod = page.getByRole(
        'textbox',
        { name: 'Type to narrow down results' },
    );
    await expect(selectMethod).toBeFocused();
    await selectMethod.pressSequentially('File...');
    await selectMethod.press('Enter');

    // enter the filename
    const selectFile = page.getByRole(
        'textbox',
        { name: 'Type to narrow down results' },
    );
    await expect(selectFile).toBeFocused();
    await selectFile.pressSequentially(file);
    await selectFile.press('Enter');

    await expect(page.getByText('// AUTOMATED BINDINGS START').first()).toBeVisible();
    return;
}
