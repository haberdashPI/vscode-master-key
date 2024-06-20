import * as fs from 'fs';
import * as path from 'path';
import { TextEditor, EditorView, InputBox, VSBrowser, Workbench } from 'vscode-extension-tester';
import expect from 'expect';
import hash from 'object-hash';

let tempdir: string;

export async function setupTempdir(){
    if(!fs.existsSync('uxtest/temp/')){ fs.mkdirSync('uxtest/temp/'); }
    tempdir = path.join(process.cwd(), fs.mkdtempSync('uxtest/temp/tmp'));
}

export async function cleanupTempdir(){
    fs.rmSync(tempdir, {recursive: true});
}

export function pause(ms: number){ return new Promise(res => setTimeout(res, ms)); }

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let oldpos = await editor.getCoordinates();
    await action();
    await pause(15);
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}

export async function setupEditor(str: string, testname: string){
    let filename = testname + ".txt";
    let editorView = new EditorView();
    let textFile = path.join(tempdir, filename);
    fs.writeFileSync(textFile, str);
    await pause(100);
    await VSBrowser.instance.openResources(textFile);
    return await editorView.openEditor(filename) as TextEditor;
}

// TODO: copy over and revise for wdio setup
export async function setBindings(str: string){
    console.log("loading config.toml");
    let config = path.join(tempdir, 'config.toml');
    fs.writeFileSync(config, str);

    console.log("preparing to activate bindings");
    let workbench = new Workbench();
    await workbench.executeCommand('Master Key: Activate Keybindings');
    console.log("executed command");
    let input = await InputBox.create();
    await input.setText('File...');
    await input.confirm();
    await pause(250);
    console.log("Setting file...");

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
