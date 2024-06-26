import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { Key } from 'webdriverio';
import { Input, InputBox, TextEditor, sleep } from 'wdio-vscode-service';

export async function setBindings(str: string){
    const workbench = await browser.getWorkbench();
    browser.keys([Key.Ctrl, 'n']);

    await workbench.executeCommand('Select Language Mode');
    let input = await ((new InputBox(workbench.locatorMap)).wait());
    await input.setText("Markdown");
    await input.confirm();

    const editorView = await workbench.getEditorView();
    let tab = await editorView.getActiveTab();
    const editor = await editorView.openEditor(await tab?.getTitle()!) as TextEditor;
    await editor.setText(str);

    await workbench.executeCommand('Master key: Activate Keybindings');
    let bindingInput = await ((new InputBox(workbench.locatorMap)).wait());
    await bindingInput.setText("Current File");
    await bindingInput.confirm();

    const messagePattern = /Your master keybindings have/;
    let message = await browser.waitUntil(async () => {
        const notifs = await workbench.getNotifications();
        if(notifs.length > 0){
            for(let not of notifs){
                const m = await not.getMessage();
                messagePattern.test(m);
                return m;
            }
        }else{
            return false;
        }
    });
    expect(message).toBeTruthy();
    return;
}

export async function setupEditor(str: string){
    const workbench = await browser.getWorkbench();
    browser.keys([Key.Ctrl, 'n']);

    const editorView = workbench.getEditorView();
    let tab = await editorView.getActiveTab();
    const editor = await editorView.openEditor(await tab?.getTitle()!) as TextEditor;

    await editor.setText(str);
    return editor;
}

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    await sleep(2000);
    let oldpos = await editor.getCoordinates();
    console.log("oldpos: "+oldpos);
    // TODO: watch the status bar, and wait until it clears
    await action();
    await sleep(2000);
    let newpos = await editor.getCoordinates();
    console.log("newpos: "+newpos);
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}
