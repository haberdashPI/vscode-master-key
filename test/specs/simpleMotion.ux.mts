// start with just some basic tests to verify all is well

import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';

describe('VS Code Extension Testing', () => {
    it('should be able to load VSCode', async () => {
        const workbench = await browser.getWorkbench();
        expect(await workbench.getTitleBar().getTitle())
            .toContain('[Extension Development Host]');
    });

    it('should be able to run command', async() => {
        const workbench = await browser.getWorkbench();
        const oldNotifs = await workbench.getNotifications();
        for(let not of oldNotifs){
            await not.dismiss();
        }
        await browser.waitUntil(async () => {
            const notifs = await workbench.getNotifications();
            return notifs.length === 0;
        });

        await workbench.executeCommand('Show Visual Documentation');
        expect(true).toBeTruthy();
    });
});
