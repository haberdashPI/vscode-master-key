// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import {enterModalKeys, setBindings, setupEditor, storeCoverageStats} from './utils.mts';
import {sleep, TextEditor, WebView, Workbench} from 'wdio-vscode-service';
import 'webdriverio';

describe('Visual Docs', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let editor: TextEditor;
    let workbench: Workbench;
    let docView: WebView;
    before(async () => {
        await setBindings(`
            # # Test Documentation
            #- IGNORED COMMENT
            [header]
            version = "2.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

            [[kind]]
            name = "left"
            description = "more leftward keys"

            [[kind]]
            name = "right"
            description = "more rightward keys"

            # ## First Section

            # Cillum adipisicing consequat aliquip Lorem adipisicing minim culpa officia aliquip reprehenderit.

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "master-key.enterNormal"
            prefixes = "{{all_prefixes}}"
            hideInPalette = true

            [[default]]
            id = "motion"
            name = "basic motions"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count"

            [[bind]]
            defaults = "motion"
            name = "left"
            key = "h"
            args.to = "left"
            kind = "left"

            [[bind]]
            defaults = "motion"
            name = "right"
            key = "l"
            args.to = "right"
            kind = "right"

            [[bind]]
            defaults = "motion"
            name = "down"
            key = "j"
            args.to = "down"
            kind = "left"

            # ## Second Section

            # Aliquip ipsum enim cupidatat aute occaecat magna nostrud qui labore.

            [[bind]]
            defaults = "motion"
            name = "up"
            key = "k"
            args.to = "up"
            kind = "right"

            [[bind]]
            defaults = "motion"
            name = "funny right"
            key = "w w"
            mode = "normal"
            args.to = "right"
            kind = "right"

            [[bind]]
            name = "insert mode"
            key = "i"
            command = "master-key.enterInsert"
            mode = "normal"
            kind = "right"

            [[bind]]
            defaults = "motion"
            key = "ctrl+i"
            name = "magic insert"
            command = "foobar"
            mode = "normal"
            kind = "right"

            [[bind]]
            defaults = "motion"
            key = "ctrl+o"
            name = "magic outsert"
            command = "foobiz"
            mode = "normal"
            kind = "right"

            [[bind]]
            defaults = "motion"
            key = "alt+i"
            name = "evil insert"
            command = "die"
            mode = "normal"
            kind = "right"

            # Final paragraph shows up.
        `);
        editor = await setupEditor('A simple test');
        workbench = await browser.getWorkbench();
        await sleep(500);

        await workbench.executeCommand('Master Key: Show Visual Documentation');
        await enterModalKeys({key: 'escape', updatesStatus: false});

        await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0);
        const webviews = await workbench.getAllWebviews();
        expect(webviews).toHaveLength(1);
        docView = await webviews[0].wait();
    });

    it('Label Keys', async () => {
        await docView.open();
        expect(await browser.$('div#master-key-visual-doc')).toExist();

        const hLabel = await browser.$('div.keyboard').$('div=H');
        expect(hLabel).toHaveText('H');
        const hName = (await hLabel.parentElement()).$('div.name.bottom');
        expect(hName).toHaveText('left');
        const hClasses = await hName.getAttribute('class');
        expect(hClasses).toMatch('kind-color-0');

        const jLabel = await browser.$('div.keyboard').$('div=J');
        expect(jLabel).toHaveText('J');
        const jName = (await jLabel.parentElement()).$('div.name.bottom');
        expect(jName).toHaveText('down');
        const jClasses = await jName.getAttribute('class');
        expect(jClasses).toMatch('kind-color-0');

        const kLabel = await browser.$('div.keyboard').$('div=K');
        expect(kLabel).toHaveText('K');
        const kName = (await kLabel.parentElement()).$('div.name.bottom');
        expect(kName).toHaveText('up');
        const kClasses = await kName.getAttribute('class');
        expect(kClasses).toMatch('kind-color-1');

        const lLabel = await browser.$('div.keyboard').$('div=L');
        expect(lLabel).toHaveText('L');
        const lName = (await lLabel.parentElement()).$('div.name.bottom');
        expect(lName).toHaveText('right');
        const lClasses = await lName.getAttribute('class');
        expect(lClasses).toMatch('kind-color-1');

        await docView.close();
    });

    it('Update with prefix', async () => {
        await enterModalKeys({key: 'w', updatesStatus: false});
        await docView.open();

        const disappeared = await browser.waitUntil(async () => {
            const hLabel = browser.$('div.keyboard').$('div=H');
            const hName = (await hLabel.parentElement()).$('div.name.bottom');
            return (await hName.getText()) !== 'left';
        });
        expect(disappeared).toBeTruthy();

        const wLabel = await browser.$('div.keyboard').$('div=W');
        expect(wLabel).toHaveText('W');
        const wName = (await wLabel.parentElement()).$('div.name.bottom');
        expect(wName).toHaveText('funny right');
        const wClasses = await wLabel.getAttribute('class');
        expect(wClasses).toMatch('kind-color-1');

        await browser.keys('w');
        await docView.close();
    });

    it('Toggled by command', async () => {
        await docView.open();

        // eslint-disable-next-line prefer-const
        let iLabel = await browser.$('div.keyboard').$('div*=I');
        expect(await iLabel.getText()).toMatch(/I/);
        let iLowerName = (await iLabel.parentElement()).$('div.name.bottom');
        expect(iLowerName).toHaveText('insert');
        let iUpperName = (await iLabel.parentElement()).$('div.name.top');
        expect(iUpperName).toHaveText('magic insert');

        let oLabel = await browser.$('div.keyboard').$('div*=0');
        expect(await oLabel.getText()).toMatch(/0/);
        let oName = (await iLabel.parentElement()).$('div.name.top');
        expect(oName).toHaveText('magic outsert');

        await browser.executeWorkbench(vscode => {
            vscode.commands.executeCommand('master-key.toggleVisualDocModifiers');
        });

        iLabel = await browser.$('div.keyboard').$('div*=I');
        expect(await iLabel.getText()).toMatch(/I/);
        iLowerName = (await iLabel.parentElement()).$('div.name.bottom');
        expect(iLowerName).toHaveText('insert');
        iUpperName = (await iLabel.parentElement()).$('div.name.top');
        expect(iUpperName).toHaveText('evil insert');

        oLabel = await browser.$('div.keyboard').$('div*=O');
        expect(await oLabel.getText()).toMatch(/O/);
        oName = (await iLabel.parentElement()).$('div.name.top');
        expect(oName).toHaveText('');

        await browser.executeWorkbench(vscode => {
            vscode.commands.executeCommand('master-key.toggleVisualDocModifiers');
        });

        iLabel = await browser.$('div.keyboard').$('div*=I');
        expect(await iLabel.getText()).toMatch(/I/);
        iLowerName = (await iLabel.parentElement()).$('div.name.bottom');
        expect(iLowerName).toHaveText('insert');
        iUpperName = (await iLabel.parentElement()).$('div.name.top');
        expect(iUpperName).toHaveText('magic insert');

        oLabel = await browser.$('div.keyboard').$('div*=0');
        expect(await oLabel.getText()).toMatch(/0/);
        oName = (await iLabel.parentElement()).$('div.name.top');
        expect(oName).toHaveText('magic outsert');

        await docView.close();
    });

    after(async () => {
        await storeCoverageStats('visualDoc');
    });
});
