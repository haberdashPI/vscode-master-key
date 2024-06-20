import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { InputBox, TextEditor, sleep } from 'wdio-vscode-service';

export async function setBindings(str: string){
    if(!fs.existsSync('test/temp/')){ fs.mkdirSync('test/temp/'); }
    let tempdir = path.join(process.cwd(), fs.mkdtempSync('test/temp/tmp'));
    let config = path.join(tempdir, 'config.toml');
    fs.writeFileSync(config, str);

    console.log("[DEBUG]: executing 'Activate Keybindings'");
    const workbench = await browser.getWorkbench();
    await workbench.executeCommand('Master Key: Activate Keybindings');
    console.log("[DEBUG]: setting file");
    const bindingInput = await (new InputBox(workbench.locatorMap).wait());
    await bindingInput.setText('File...');
    await bindingInput.confirm();

    console.log("[DEBUG]: specifying filename");
    const fileInput = await (new InputBox(workbench.locatorMap).wait());
    await fileInput.setText(config);
    await fileInput.confirm();
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
