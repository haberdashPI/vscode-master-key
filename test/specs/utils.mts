import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { TextEditor, sleep } from 'wdio-vscode-service';

let tempdir: string;

export async function setBindings(str: string){
    if(!fs.existsSync('test/temp/')){ fs.mkdirSync('test/temp/'); }
    tempdir = path.join(process.cwd(), fs.mkdtempSync('test/temp/tmp'));
    let config = path.join(tempdir, 'config.toml');
    fs.writeFileSync(config, str);

    const workbench = await browser.getWorkbench();
    let input = await workbench.executeCommand('Master Key: Activate Keybindings');
    await browser.waitUntil(async () => (await input.getText()) !== 'Master Key: Activate Keybindings');
    await input.setText('File...');
    await input.confirm();
    await browser.waitUntil(async () => (await input.getText()) !== 'File...');
    await input.setText(config);
    await input.confirm();
    await browser.waitUntil(async () => (await input.getText()) !== config);
}

export async function setupEditor(str: string){
    const workbench = await browser.getWorkbench();
    const editorView = await workbench.getEditorView();
    const editor = await editorView.openEditor('test.md') as TextEditor;
    editor.setText(str);
    return editor;
}

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let oldpos = await editor.getCoordinates();
    await action();
    await sleep(30);
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}
