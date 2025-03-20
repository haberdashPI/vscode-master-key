// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import {setBindings, storeCoverageStats} from './utils.mts';
import {WebView} from 'wdio-vscode-service';

describe('Binding Docs', () => {
    let mdView: WebView;

    before(async () => {
        await setBindings(`
            # # Test Documentation
            #- IGNORED COMMENT
            [header]
            ersion = "2.0"

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

            #- verify that including lots of ignored keys doesn't mess up display
            [[bind]]
            name = "ignore"
            foreach.key = ['{key: .}']
            key = "{key}"
            command = "master-key.ignore"
            hideInDocs = true
            hideInPalette = true
            priority = -10
            when = "editorTextFocus"
            mode = "normal"

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

            # Final paragraph shows up.
        `);

        const workbench = await browser.getWorkbench();
        // console.log("[DEBUG]: showing documentation")
        // await workbench.executeCommand('Master Key: Show Text Documentation')
        await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 1);
        const webviews = await workbench.getAllWebviews();
        expect(webviews).toHaveLength(2);
        mdView = await webviews[1].wait();
        mdView.open();
    });

    it('has first section', async () => {
        const secTitle = await browser.$('div.markdown-body h2');
        expect(secTitle).toHaveText('First Section');

        // rows of the first table
        const rows = await browser.$('div.markdown-body table').$$('tbody tr');
        expect(rows).toHaveLength(4);
    });

    it('has second section', async () => {
        const secTitle = await browser.$('div.markdown-body h2:nth-of-type(2)');
        expect(secTitle).toHaveText('Second Section');
        await secTitle.click();

        const rows = await browser
            .$('div.markdown-body table:nth-of-type(2)')
            .$$('tbody tr');
        expect(rows).toHaveLength(3);
    });

    it('hides comments with `#-`', async () => {
        const paragraph = await browser.$('div.markdown-body p');
        expect(paragraph).toExist();
        const text = await paragraph.getText();
        expect(text).not.toMatch(/IGNORED/);
    });

    it('has final paragraph', async () => {
        const paragraph = await browser.$('div.markdown-body p:nth-of-type(3)');
        expect(paragraph).toHaveText('Final paragraph shows up.');
    });

    after(async () => {
        mdView.close();
        await storeCoverageStats('markdownDoc');
    });
});
