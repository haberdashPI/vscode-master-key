import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { Key } from 'webdriverio';
import { Input, InputBox, StatusBar, TextEditor, sleep } from 'wdio-vscode-service';
import replaceAll from 'string.prototype.replaceall';

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
                if(messagePattern.test(m)){
                    return m;
                }else{
                    console.log("[UTIL]: notification message — "+m);
                }
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

    (await editor.elem).click();
    await browser.keys([Key.Ctrl, 'A']);
    await browser.keys(Key.ArrowRight);

    return editor;
}

export function prettifyPrefix(str: string | string[]){
    str = Array.isArray(str) ? str.join('+') : str;
    str = str.toUpperCase();
    str = replaceAll(str, /shift(\+|$)/gi, '⇧');
    str = replaceAll(str, /ctrl(\+|$)/gi, '^');
    str = replaceAll(str, /alt(\+|$)/gi, '⌥');
    str = replaceAll(str, /meta(\+|$)/gi, '◆');
    str = replaceAll(str, /win(\+|$)/gi, '⊞');
    str = replaceAll(str, /cmd(\+|$)/gi, '⌘');
    // note: a bit hacky, to handle combined key descriptions
    str = replaceAll(str, /(?<!\/) (?!\/)/g, ", ");
    str = replaceAll(str, /escape/gi, "ESC");
    return str;
}

// TODO: test out and get this function working
export async function modalKeySeq(...keySeq: (string | string[])[]){
    const workbench = await browser.getWorkbench();
    const statusBar = await (new StatusBar(workbench.locatorMap));
    let lastKeyStr = "";
    for(const keys of keySeq){
        browser.keys(keys);
        const keyString = prettifyPrefix(keys);
        lastKeyStr = keyString;
        let registered = await browser.waitUntil(async () => {
            const items = await statusBar.getItems();
            return items.some(i => i.includes(keyString));
        });
        expect(registered).toBeTruthy();
    }
    // wait for keys to be cleared from status before moving on
    let cleared = await browser.waitUntil(async () => {
        const items = await statusBar.getItems();
        return !items.some(i => i.includes(lastKeyStr));
    });
    expect(cleared).toBeTruthy();
}

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let oldpos = await editor.getCoordinates();
    await action();
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}
