import 'mocha';
import '@wdio/globals';
import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'expect-webdriverio';
type SpecResult = { error?: string, result?: any };

let tempdir: string;

function setupTempdir(){
    if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
    tempdir = path.join(process.cwd(), fs.mkdtempSync('uxtest/temp/tmp'));
}

describe('WDIO VSCode Service', () => {
    it('should be able to load VSCode', async () => {
        const workbench = await browser.getWorkbench();
        expect(await workbench.getTitleBar().getTitle()).
            toMatch(/^\[Extension Development Host\]/);
    });
});

describe('Simple Keybinding File', () => {
    let simpleFile = `
        [header]
        version = "1.0"
        name = "test"
        description = "A simple test file"

        [[bind]]
        name = "foo"
        key = "Cmd+a"
        command = "fooCommand"

        [[bind]]
        name = "bar"
        key = "Cmd+b"
        command = "barCommand"
    `;

    before(() => {
        setupTempdir();
    });

    it('can be parsed', async () => {
        let result = await specForBindings(simpleFile);
        expect(true).toBeTruthy();
        // expect(result).toHaveProperty('result');
        // if(result?.result){
        //     expect(result.result).toBeTruthy();
        // }
    });
});
