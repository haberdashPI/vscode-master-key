import * as vscode from 'vscode';
import { validateKeybindings } from '.';
import { inflate, deflate } from 'pako';

import { KeyFileResult, parse_keybinding_bytes } from '../../rust/parsing/lib/parsing';

// this globally accessible variable drives most interactions with the key bindings data it
// is the main entry point to most of the functionality defined in rust. A KeyFileResult
// represents a successful or failed parsing of a keybinding file. It stores all state that
// will be used to execute expressions found within individual keybindings. Refer to
// `file.rs` for details.
export let bindings: KeyFileResult;
// the check sum is used to determine if the saved file matches the currently loaded
// bindings
let bindingChecksum: string = '';
// a config listener is notified any time a new set of keybindings is loaded
export type ConfigListener = (x: KeyFileResult) => Promise<void>;
const listeners: ConfigListener[] = [];

// these two variables are where the bindings and bindingChecksum are stored to; these
// values are stored in the globalSate, and marked as variables to be synced across
// machines.
const CONFIG_STORAGE = 'master-key.activeBindings';
const CONFIG_CHECKSUM = 'master-key.activeChecksum';

export async function updateBindings(context: vscode.ExtensionContext) {
    const checksum = context.globalState.get<string>(CONFIG_CHECKSUM);
    if (bindingChecksum !== checksum) {
        console.log('Loaded checksum: ' + bindingChecksum);
        console.log('Config checksum: ' + checksum);
        useBindings(context);
    }
}

// KeyFileResult objects are computed from KeyFileData. There are three steps to loaded a
// set of bindings:
// 1. (uri): the initial file name where the bindings are stored
// 2. (data): the raw bytes loaded from the given file
// 3. (parsed): the parsed data stored as a KeyFileResult
//
// Throughout the code base we need each of these three elements. We store all of them in a
// `KeyFileData`, lazily computing each step as needed. This way we don't compute or load
// the values of one stage unless we need to.
type KeyFileBytes = { bytes: Uint8Array; checksum?: string }; // the raw byte content of the file
type KeyFileCompressed = { base64: string; checksum: string }; // the compressed file data: stored in the globalState
type KeyFileContent = KeyFileBytes | KeyFileCompressed;

export class KeyFileData {
    uri: vscode.Uri;
    _content?: KeyFileContent;
    _parsed?: KeyFileResult;
    constructor(uri: vscode.Uri, content?: KeyFileContent) {
        this._content = content;
        this.uri = uri;
        this._parsed = undefined;
    }

    get checksum(): string | undefined {
        return (<KeyFileCompressed> this._content)?.checksum;
    }

    async data(): Promise<Uint8Array> {
        if (!this._content) {
            const result = await vscode.workspace.fs.readFile(this.uri);
            this._content = { bytes: result };
            return result;
        } else if ((<KeyFileBytes> this._content)?.bytes) {
            return (<KeyFileBytes> this._content)?.bytes;
        } else {
            const base64 = (<KeyFileCompressed> this._content).base64;
            const checksum = (<KeyFileCompressed> this._content).checksum;
            const bytes = fromZipBase64(base64 || '') || [];
            this._content = { bytes, checksum };
            return bytes;
        }
    }

    async bindings() {
        if (!this._parsed) {
            if (this.checksum === bindingChecksum) {
                return bindings;
            }
            const data = await this.data();
            const result = parse_keybinding_bytes(data);
            this._parsed = result;
            return result;
        } else {
            return this._parsed;
        }
    }
}

interface IStorage {
    data?: string;
    file?: string;
}

async function toZipBase64(data: Uint8Array): Promise<[string, string]> {
    const bytes = deflate(data, { level: 9 });
    const byteString = String.fromCharCode.apply(null, Array.from(bytes));
    const byte64 = btoa(byteString);

    const checksumData = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    const checksumArray = new Uint8Array(checksumData);
    const checksumString = String.fromCharCode.apply(null, Array.from(checksumArray));
    const checksum64 = btoa(checksumString);

    return [byte64, checksum64];
}

export function fromZipBase64(str: string): Uint8Array {
    const result = inflate(Uint8Array.from(atob(str), c => c.charCodeAt(0)));
    return result || [];
}

// set the global bindings from a new source; storing them in the global state so the sync
// across machines
export async function setBindings(
    context: vscode.ExtensionContext,
    newBindings?: KeyFileData,
): Promise<KeyFileData | undefined> {
    const storage: IStorage = {};

    if (newBindings) {
        const [compressed, checksum] = await toZipBase64(await newBindings.data());
        storage.data = compressed;
        storage.file = newBindings.uri.toString();

        bindings = await newBindings.bindings();
        bindingChecksum = checksum;
        console.log('Set checksum: ' + bindingChecksum);
        for (const fn of listeners || []) {
            await fn(bindings);
        }

        context.globalState.update(CONFIG_STORAGE, storage);
        context.globalState.update(CONFIG_CHECKSUM, checksum);
    } else {
        context.globalState.update(CONFIG_STORAGE, {});
        context.globalState.update(CONFIG_CHECKSUM, '');
        bindings = new KeyFileResult();
        for (const fn of listeners || []) {
            await fn(bindings);
        }
        return undefined;
    }
}

// reload the bindings from the global state
export async function getBindings(context: vscode.ExtensionContext) {
    const checksum = context.globalState.get<string>(CONFIG_CHECKSUM) || '';
    const storage = context.globalState.get<IStorage>(CONFIG_STORAGE) || {};
    if (storage.file && storage.data) {
        return new KeyFileData(
            vscode.Uri.parse(storage.file),
            { base64: storage.data, checksum: checksum },
        );
    }
}

// use the bindings stored in the global state, setting them as the current global
// `bindings`
async function useBindings(context: vscode.ExtensionContext) {
    const newBindings = await getBindings(context);
    if (!newBindings) {
        bindings = new KeyFileResult();
        bindingChecksum = '';
        console.log('Set checksum: ' + bindingChecksum);
        for (const fn of listeners || []) {
            await fn(bindings);
        }
    } else {
        if (newBindings.checksum === bindingChecksum) {
            return;
        }
        console.log('Parsing key file data');
        const parsed = await newBindings.bindings();
        if (await validateKeybindings(newBindings, { explicit: true })) {
            bindings = parsed;
            bindingChecksum = newBindings.checksum || '';
            console.log('Set checksum: ' + bindingChecksum);
            for (const fn of listeners || []) {
                await fn(parsed);
            }
            return;
        }
    }
}

// listen for changes to the global `bindings` variable
export async function onSetBindings(fn: ConfigListener) {
    await fn(bindings);
    listeners.push(fn);
    return;
}

///////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
}

export async function activate(context: vscode.ExtensionContext) {
    context.globalState.setKeysForSync([CONFIG_CHECKSUM, CONFIG_STORAGE]);

    bindings = new KeyFileResult();
    for (const fn of listeners || []) {
        await fn(bindings);
    }

    updateBindings(context);
    // we have to poll for bindings, there is no hook that checks for changes to the global
    // state. We do this on a generously slow cadence, since parsing the files is a chunk of
    // work
    const configPolling = setInterval(() => {
        updateBindings(context);
    }, 5000);
    // don't let the polling continue once the extension is closed out
    context.subscriptions.push({
        dispose: () => clearInterval(configPolling),
    });
}

export async function defineCommands(_context: vscode.ExtensionContext) {
    return;
}
