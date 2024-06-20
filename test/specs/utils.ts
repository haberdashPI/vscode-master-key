import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';

let tempdir: string;

export async function setupTempdir(){
    if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
    tempdir = path.join(process.cwd(), fs.mkdtempSync('uxtest/temp/tmp'));
}

export async function cleanupTempdir(){
    fs.rmSync(tempdir, {recursive: true});
}

export async function setBindings(str: string){
    let config = path.join(tempdir, 'config.toml');
    fs.writeFileSync(config, str);

    const workbench = await browser.getWorkbench();
    let input = await workbench.executeCommand('Master Key: Activate Keybindings');
    await input.setText('File...');
    await input.confirm();
    await browser.waitUntil(async () => (await input.getTitle()) === '');


    input = await InputBox.create();
    await input.setText(config);
    await input.confirm();
    // hacky kludge: try and confirm the input again this is a work-around of what appears
    // to be a bug. I don't want to bother tracking down how vscode-extension-tester is
    // hitting the "Ok" button to see if I can fix it.
    try{
        await pause(500);
        await input.confirm();
    }finally{
        await pause(250);
        return;
    }
}
