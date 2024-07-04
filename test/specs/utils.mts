import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { Key, WaitUntilOptions } from 'webdriverio';
import { Input, InputBox, StatusBar, TextEditor, sleep } from 'wdio-vscode-service';
import loadash from 'lodash';
const { isEqual } = loadash;

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

export async function cursorToTop(editor: TextEditor){
    (await editor.elem).click();
    await browser.keys([Key.Ctrl, 'A']);
    await browser.keys(Key.ArrowLeft);
    await sleep(100);
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

    await cursorToTop(editor);

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
interface ModalKeySpec {
    key: string | string[]
    count?: number
    updatesStatus?: boolean
}
type ModalKey = string | string[] | ModalKeySpec;
function modalKeyToStringArray(key: ModalKey): string[] {
    let simpleKey: string | string[];
    if((key as ModalKeySpec).key){
        simpleKey = (key as ModalKeySpec).key;
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
    if((key as ModalKeySpec).key){
        return (key as ModalKeySpec).count;
    }else{
        return undefined;
    }
}

function modalKeyUpdateStatus(key: ModalKey){
    if((key as ModalKeySpec).key){
        let update = (key as ModalKeySpec).updatesStatus;
        if(update === undefined){
            return true;
        }else{
            return update;
        }
    }else{
        return true;
    }
}

export async function enterModalKeys(...keySeq: ModalKey[]){
    const workbench = await browser.getWorkbench();
    const statusBar = await (new StatusBar(workbench.locatorMap));
    let keySeqString = "";
    let cleared;

    console.dir(keySeqString);

    console.log("[DEBUG]: waiting for old keys to clear");
    let waitOpts = {interval: 50, timeout: 1000};
    cleared = await browser.waitUntil(() => statusBar.getItem('No Keys Typed'),
        waitOpts);
    expect(cleared).toBeTruthy();

    let count = 0;
    let checkCleared = true;
    for(const keys_ of keySeq){
        checkCleared = true;
        const keys = modalKeyToStringArray(keys_);
        if(!isEqual(keys.map(x => x.toLowerCase()), keys)){
            throw Error("Keys must all be lower case (use 'shift')");
        }
        const keyCodes = keys.map(k => MODAL_KEY_MAP[k] !== undefined ? MODAL_KEY_MAP[k] : k);
        console.log("[DEBUG]: keys");
        console.dir(keys_);
        console.dir(keyCodes);
        console.dir(keys);
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

        browser.keys(keyCodes);
        if(modalKeyUpdateStatus(keys_)){
            console.log("[DEBUG]: looking for new key");
            console.log("[DEBUG]: target '"+currentKeySeqString+"'");
            let registered = await browser.waitUntil(() =>
                statusBar.getItem('Keys Typed: '+currentKeySeqString),
                waitOpts);
            expect(registered).toBeTruthy();
        }else{
            checkCleared = false;
        }
    }
    if(checkCleared){
        console.log("[DEBUG]: waiting for new key to clear");
        cleared = await browser.waitUntil(() => statusBar.getItem('No Keys Typed'),
            waitOpts);
        expect(cleared).toBeTruthy();
    }

    return;
}

export async function waitForMode(mode: string, opts: Partial<WaitUntilOptions> = {}){
    const workbench = await browser.getWorkbench();
    const statusBar = await (new StatusBar(workbench.locatorMap));
    let modeSet = await browser.waitUntil(() =>
        statusBar.getItem('Keybinding Mode: '+mode),
        opts);
    expect(modeSet).toBeTruthy();
    return;
}

async function coordChange(editor: TextEditor, oldpos: {x: number, y: number}): Promise<{x: number, y: number}> {
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos.y;
    let xdiff = newpos[1] - oldpos.x;
    return {y: ydiff, x: xdiff};
}

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let [y, x] = await editor.getCoordinates();
    let oldpos = {x, y};
    await action();
    let expected = {y: by[0], x: by[1]};
    let actual = await coordChange(editor, oldpos);
    // most of the time we can just run `expect` right away...
    if(isEqual(actual, expected)){
        expect(actual).toEqual(expected);
        return;
    }
    // but some commands require that we wait before their effects are observed...
    // in this case we need to have some confidence that no further moves are
    // going to happen
    let stepsUnchanged = 0;
    let lastMove = {x: 0, y: 0};
    let maybeActual = await browser.waitUntil(async() => {
        let move = await coordChange(editor, oldpos);

        if(isEqual(lastMove, move)){ stepsUnchanged += 1; }
        else{
            lastMove = move;
            stepsUnchanged = 0;
        };
        if(stepsUnchanged > 1){
            return move;
        }
    }, {interval: 300, timeout: 9000});

    expect(maybeActual).toEqual(expected);
}

export async function movesCursorTo(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    await action();
    let newpos = await editor.getCoordinates();
    expect({y: newpos[0], x: newpos[1]}).toEqual({y: by[0], x: by[1]});
}
