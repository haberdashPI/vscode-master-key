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
    return;
}

export async function setupEditor(str: string){
    const workbench = await browser.getWorkbench();
    browser.keys([Key.Ctrl, 'n']);

    const editorView = await workbench.getEditorView();
    let tab = await editorView.getActiveTab();
    const editor = await editorView.openEditor(await tab?.getTitle()!) as TextEditor;

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
