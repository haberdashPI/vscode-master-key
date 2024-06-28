import * as fs from 'fs';
import * as path from 'path';
import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { Key } from 'webdriverio';
import { Input, InputBox, StatusBar, TextEditor, sleep } from 'wdio-vscode-service';

export async function setBindings(str: string){
    const workbench = await browser.getWorkbench();
    browser.keys([Key.Ctrl, 'n']);
    await sleep(500);

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

    // clear any older notificatoins
    let notifications = await workbench.getNotifications();
    for(let note of notifications){
        await note.dismiss();
    }

    await editor.setText(str);

    (await editor.elem).click();
    await browser.keys([Key.Ctrl, 'A']);
    await browser.keys(Key.ArrowRight);

    return editor;
}

export function prettifyPrefix(str: string){
    str = str.toUpperCase();
    str = str.replace(/shift(\+|$)/gi, '⇧');
    str = str.replace(/ctrl(\+|$)/gi, '^');
    str = str.replace(/alt(\+|$)/gi, '⌥');
    str = str.replace(/meta(\+|$)/gi, '◆');
    str = str.replace(/win(\+|$)/gi, '⊞');
    str = str.replace(/cmd(\+|$)/gi, '⌘');
    str = str.replace(/escape/gi, "ESC");
    return str;
}

// TODO: test out and get this function working
const MODAL_KEY_MAP: Record<string, string> = {
    'shift': Key.Shift,
    'alt': Key.Alt,
    'tab': Key.Tab,
    'cmd': Key.Command,
    'ctrl': Key.Control,
    'escape': Key.Escape,
    'space': Key.Space
};

// TODO: implement count
interface ModalCount {
    key: string | string[]
    count: number
}
type ModalKey = string | string[] | ModalCount;
function modalKeyToStringArray(key: ModalKey): string[] {
    let simpleKey: string | string[];
    if((key as ModalCount).key){
        simpleKey = (key as ModalCount).key;
    }else{
        simpleKey = (key as string | string[]);
    }
    if(Array.isArray(simpleKey)){
        return simpleKey;
    }else{
        return [simpleKey];
    }
};

function modalKeyCount(key: ModalKey){
    if((key as ModalCount).key){
        return (key as ModalCount).count;
    }else{
        return undefined;
    }
}

export async function enterModalKeys(...keySeq: ModalKey[]){
    const workbench = await browser.getWorkbench();
    const statusBar = await (new StatusBar(workbench.locatorMap));
    let keySeqString = "";
    let cleared;

    // console.dir(keySeqString);

    // console.log("[DEBUG]: waiting for old keys to clear");
    let waitOpts = {interval: 50, timeout: 1000};
    cleared = await browser.waitUntil(() => statusBar.getItem('No Keys Typed'),
        waitOpts);
    expect(cleared).toBeTruthy();

    let count = 0;
    for(const keys_ of keySeq){
        const keys = modalKeyToStringArray(keys_);
        const keyCodes = keys.map(k => MODAL_KEY_MAP[k] !== undefined ? MODAL_KEY_MAP[k] : k);
        // console.log("[DEBUG]: keys");
        // console.dir(keys_);
        // console.dir(keyCodes);
        // console.dir(keys);
        const keyCount = modalKeyCount(keys_);
        if(keyCount === undefined){
            let keyString = keys.map(prettifyPrefix).join('');
            if(keySeqString){
                keySeqString += ", " + keyString;
            }else{
                keySeqString = keyString;
            }
        }else{
            count = count * 10 + keyCount;
        }
        let currentKeySeqString = (count ? count + "× " : '') + keySeqString;

        // console.log("[DEBUG]: looking for new key");
        // console.log("[DEBUG]: target '"+currentKeySeqString+"'");
        browser.keys(keyCodes);
        let registered = await browser.waitUntil(() =>
            statusBar.getItem('Keys Typed: '+currentKeySeqString),
            waitOpts);
        expect(registered).toBeTruthy();
    }
    // console.log("[DEBUG]: waiting for new key to clear");
    cleared = await browser.waitUntil(() => statusBar.getItem('No Keys Typed'),
        waitOpts);
    expect(cleared).toBeTruthy();

    return;
}

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let oldpos = await editor.getCoordinates();
    await action();
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos[0];
    let xdiff = newpos[1] - oldpos[1];
    expect({y: ydiff, x: xdiff}).toEqual({y: by[0], x: by[1]});
}
