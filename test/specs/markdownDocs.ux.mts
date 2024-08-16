// start with just some basic tests to verify all is well

import '@wdio/globals';
import 'wdio-vscode-service';
import { setBindings, storeCoverageStats } from './utils.mts';

describe('Binding Docs', () => {
    before(async () => {
        await setBindings(`
            # # Test Documentation
            # IGNORED COMMENT
            [header]
            version = "1.0"

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
            prefixes = "<all-prefixes>"
            hideInPalette = true

            [[path]]
            id = "motion"
            name = "basic motions"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count"

            [[bind]]
            path = "motion"
            name = "left"
            key = "h"
            args.to = "left"
            kind = "left"

            [[bind]]
            path = "motion"
            name = "right"
            key = "l"
            args.to = "right"
            kind = "right"

            [[bind]]
            path = "motion"
            name = "down"
            key = "j"
            args.to = "down"
            kind = "left"

            # ## Second Section

            # Aliquip ipsum enim cupidatat aute occaecat magna nostrud qui labore.

            [[bind]]
            path = "motion"
            name = "up"
            key = "k"
            args.to = "up"
            kind = "right"

            [[bind]]
            path = "motion"
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
        await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 1)
        const webviews = await workbench.getAllWebviews();
        expect(webviews).toHaveLength(2);
        const mdView = await webviews[1].wait();
        mdView.open();
    });

    it('has first section', async() => {
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

        const rows = await browser.$('div.markdown-body table:nth-of-type(2)').$$('tbody tr');
        expect(rows).toHaveLength(3);
    });

    it('hides comments with `#-`', async () => {
        const paragraph = await browser.$('div.markdown-body p');
        expect(paragraph).toExist();
        const text = (await paragraph.getText());
        expect(text).not.toMatch(/IGNORED/);
    });

    it('has final paragraph', async () => {
        const paragraph = await browser.$('div.markdown-body p:nth-of_type(3)');
        expect(paragraph).toHaveText('Final paragraph shows up.');
    });

    after(async () => {
        await storeCoverageStats('markdownDoc');
    });
});
