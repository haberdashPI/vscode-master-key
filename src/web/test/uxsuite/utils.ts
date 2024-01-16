import * as fs from 'fs';
import * as path from 'path';
import { TextEditor, EditorView, InputBox, VSBrowser, Workbench } from 'vscode-extension-tester';
import expect from 'expect';

let tempdir: string;

export async function setupTempdir(){
    if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
    tempdir = path.join(process.cwd(), fs.mkdtempSync('uxtest/temp/tmp'));
}

export async function cleanupTempdir(){
    fs.rmSync(tempdir, {recursive: true});
}

export function pause(ms: number){ return new Promise(res => setTimeout(res, ms)); }

export async function movesCurosrInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let oldpos = await editor.getCoordinates();
    await action();
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}

export async function setupEditor(str: string){
    let editorView = new EditorView();
    let textFile = path.join(tempdir, 'test.txt');
    fs.writeFileSync(textFile, str);
    await VSBrowser.instance.openResources(textFile);
    return await editorView.openEditor('test.txt') as TextEditor;
}

export async function setBindings(str: string){
    let config = path.join(tempdir, 'config.toml');
    fs.writeFileSync(config, str);

    let workbench = new Workbench();
    await workbench.executeCommand('Master Key: Select Keybinding');
    let input = await InputBox.create();
    await input.setText('File...');
    await input.confirm();

    input = await InputBox.create();
    await input.setText(config);
    await input.confirm();

    await pause(500);
}
