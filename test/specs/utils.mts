import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { Input, InputBox, TextEditor, sleep } from 'wdio-vscode-service';

    export async function setBindings(str: string){
    if(!fs.existsSync('test/temp/')){ fs.mkdirSync('test/temp/'); }
    let tempdir = path.join(process.cwd(), fs.mkdtempSync('test/temp/tmp'));
    let config = path.join(tempdir, 'config.toml');
    fs.writeFileSync(config, str);

    // TODO: rather than using a temporary file create a new file and enter text, save it
    // and use `Current File` option
    const workbench = await browser.getWorkbench();
    await workbench.executeCommand('Master Key: Activate Keybindings');
    const bindingInput = await (new InputBox(workbench.locatorMap).wait());
    await sleep(100);
    await bindingInput.setText('File...');
    await bindingInput.confirm();
    await sleep(5000);

    const fileInput = await (new InputBox(workbench.locatorMap).wait());
    await fileInput.setText(config);
    await sleep(50);
    await fileInput.confirm();
}

export async function setupEditor(str: string){
    const workbench = await browser.getWorkbench();
    await sleep(5000);
    await workbench.executeCommand('New Untitled Text File');
    await sleep(5000);
    console.log("[DEBUG]: new file created");
    await workbench.executeCommand('Save');
    await sleep(5000);

    console.log("[DEBUG]: setting filename");
    let input = await (new InputBox(workbench.locatorMap).wait());
    let tempdir = path.join(process.cwd(), fs.mkdtempSync('test/temp/tmp'));
    await input.setText(tempdir+"/test.md");
    await input.confirm();
    await sleep(50);

    console.log("[DEBUG]: selecting editor");
    const editorView = await workbench.getEditorView();
    const editor = await editorView.openEditor('test.md') as TextEditor;
    await editor.setText(str);
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
