import * as vscode from 'vscode';
import { validateKeybindings } from '.';
import { inflate, deflate } from 'pako';

import { KeyFileResult, parse_keybinding_bytes } from '../../rust/parsing/lib/parsing';

export let bindings: KeyFileResult;
let bindingChecksum: string = '';
export type ConfigListener = (x: KeyFileResult) => Promise<void>;
const listeners: ConfigListener[] = [];

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

type KeyFileBytes = { bytes: Uint8Array; checksum?: string };
type KeyFileCompressed = { base64: string; checksum: string };
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
            const bytes = fromZip64(base64 || '') || [];
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

async function toZip64(data: Uint8Array): Promise<[string, string]> {
    const bytes = deflate(data, { level: 9 });
    const byteString = String.fromCharCode.apply(null, Array.from(bytes));
    const byte64 = btoa(byteString);

    const checksumData = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    const checksumArray = new Uint8Array(checksumData);
    const checksumString = String.fromCharCode.apply(null, Array.from(checksumArray));
    const checksum64 = btoa(checksumString);

    return [byte64, checksum64];
}

export function fromZip64(str: string): Uint8Array {
    const result = inflate(Uint8Array.from(atob(str), c => c.charCodeAt(0)));
    return result || [];
}

export async function createBindings(
    context: vscode.ExtensionContext,
    newBindings?: KeyFileData,
): Promise<KeyFileData | undefined> {
    const config = vscode.workspace.getConfiguration('master-key');
    const storage = config.get<IStorage>('storage') || {};

    // const userBindingsData = get(storage, 'userBindings', '');
    // const userBindings: string = fromZip64(userBindingsData || '') || '';

    if (newBindings) {
        // const newParsedBindings = processParsing(
        //     await parseBindings(newBindings + '\n' + userBindings),
        // );
        // if (newParsedBindings) {
        //     bindings = newParsedBindings;
        //     const newBindingsData = toZip64(newBindings);
        //     storage.presetBindings = newBindingsData;
        //     config.update('storage', storage, vscode.ConfigurationTarget.Global);
        //     return newParsedBindings;
        // } else {
        //     return undefined;
        // }
        const [compressed, checksum] = await toZip64(await newBindings.data());
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

export async function onChangeBindings(fn: ConfigListener) {
    await fn(bindings);
    listeners.push(fn);
    return;
}

export async function activate(context: vscode.ExtensionContext) {
    context.globalState.setKeysForSync([CONFIG_CHECKSUM, CONFIG_STORAGE]);

    bindings = new KeyFileResult();
    for (const fn of listeners || []) {
        await fn(bindings);
    }

    updateBindings(context);
    const configPolling = setInterval(() => {
        updateBindings(context);
    }, 5000);
    context.subscriptions.push({
        dispose: () => clearInterval(configPolling),
    });
}

export async function defineCommands(_context: vscode.ExtensionContext) {
    return;
}

export function defineState() {
}
