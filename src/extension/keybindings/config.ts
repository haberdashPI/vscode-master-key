import * as vscode from 'vscode';
import { checksumOfAllPresets, loadPresets, validateKeybindings } from '.';
import { inflate, deflate } from 'pako';
import { presetOrder } from '.';
import { clean } from '../utils';

import {
    KeyFileResult,
    ErrorLevel,
    parse_keybinding_bytes,
    parse_keybinding_bytes_with_source,
    parse_source_from_keybinding_bytes,
} from '../../rust/parsing/lib/parsing';

// this globally accessible variable drives most interactions with the key bindings data it
// is the main entry point to most of the functionality defined in rust. A KeyFileResult
// represents a successful or failed parsing of a keybinding file. It stores all state that
// will be used to execute expressions found within individual keybindings. Refer to
// `file.rs` for details.
export let bindings: KeyFileResult;
// the checksum is used to determine if the file stored in global state matches the bindings
// currently loaded into memory
let bindingChecksum: string = '';
// a config listener is notified any time a new set of keybindings is loaded
export type ConfigListener = (x: KeyFileResult) => Promise<void>;
const listeners: ConfigListener[] = [];

// these two variables are where the bindings and bindingChecksum are stored to; these
// values are stored in the globalSate, and marked as variables to be synced across
// machines.
const CONFIG_STORAGE = 'master-key.activeBindings';
const CONFIG_CHECKSUM = 'master-key.activeChecksum';
const CONFIG_PRESET_CHECKSUM = 'master-key.activePresetChecksum';

let userKnowsPresetsAreOutdates = false;

export async function updateBindings(context: vscode.ExtensionContext) {
    const storedPresetChecksum = context.globalState.get<string>(CONFIG_PRESET_CHECKSUM);
    const checksum = context.globalState.get<string>(CONFIG_CHECKSUM);
    if (bindingChecksum !== checksum) {
        console.log('Loaded checksum: ' + bindingChecksum);
        console.log('Config checksum: ' + checksum);
        useBindings(context);
    }
    await loadPresets();
    // NOTE: we check that `storedPresetChecksum` is a non-empty string. We don't really
    // want to warn users that their bindings are out of date if they've *never* activated
    // keybindings with Master Key. In addition, on the first update to master key that has
    // this block of code, `storedPresetChecksum` will be empty. There are no updates to the
    // presents in this version of Master Key so we avoid a false positive for this single
    // update.
    if (
        !ignorePresetUpdates && checksumOfAllPresets &&
        storedPresetChecksum && storedPresetChecksum !== checksumOfAllPresets &&
        !userKnowsPresetsAreOutdates
    ) {
        const ignore = 'Ignore This Update';
        const ignoreForever = 'Ignore Forever';
        userKnowsPresetsAreOutdates = true;
        const response = await vscode.window.showWarningMessage(clean(`
            Master Key's binding presets have been updated. Re-activate your keybindings
            if you use a preset or depend on a preset (using 'source').
        `), ignore, ignoreForever);
        if (response === ignore) {
            context.globalState.update(CONFIG_PRESET_CHECKSUM, checksumOfAllPresets);
        } else if (response === ignoreForever) {
            const config = vscode.workspace.getConfiguration('master-key');
            config.update('ignorePresetUpdates', true, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(clean(`
                Preset updates will now be ignored forever. Change this by setting
                'master-key.ignorePresetUpdates' to 'false' in your configuration.
            `));
        }
        return;
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

// the raw byte content of the file
type KeyFileBytes = { bytes: Uint8Array; checksum?: string };
// the compressed file data: stored in the globalState
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
            const bytes = fromZipBase64(base64 || '') || [];
            this._content = { bytes, checksum };
            return bytes;
        }
    }

    async bindings(): Promise<KeyFileResult> {
        if (!this._parsed) {
            if (this.checksum === bindingChecksum) {
                return bindings;
            }
            const data = await this.data();
            const source = parse_source_from_keybinding_bytes(data);
            if (source && source.name) {
                // WARNING: calling `loadPresets` outside this conditional creates an
                // infinite loop (because inside of `loadPresents` we call `bindings()` on
                // the present files)
                const bindingPresets = await loadPresets();
                const sourceData = bindingPresets.get(source.name);
                if (sourceData) {
                    const result = parse_keybinding_bytes_with_source(
                        data,
                        await sourceData.bindings(),
                    );
                    this._parsed = result;
                    return result;
                } else {
                    const message = clean(`
                        Source '${source.name}' does not exist. You must use
                        one of the presets defined by Master Key: ${presetOrder.join(', ')}
                    `);
                    return KeyFileResult.from_error(message, source.pos, ErrorLevel.Error);
                }
            } else {
                const result = parse_keybinding_bytes(data);
                this._parsed = result;
                return result;
            }
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
    const byte64 = Buffer.from(bytes).toString('base64');

    // compute checksum of file data
    const checksumBytes = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    const checksum64 = Buffer.from(checksumBytes).toString('base64');

    return [byte64, checksum64];
}

export function fromZipBase64(str: string): Uint8Array {
    const result = inflate(new Uint8Array(Buffer.from(str, 'base64')));
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
        context.globalState.update(CONFIG_PRESET_CHECKSUM, checksumOfAllPresets);
    } else {
        context.globalState.update(CONFIG_STORAGE, {});
        context.globalState.update(CONFIG_CHECKSUM, '');
        context.globalState.update(CONFIG_PRESET_CHECKSUM, '');
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
async function useBindings(
    context: vscode.ExtensionContext,
) {
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

let ignorePresetUpdates = false;
function updateConfig(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event?.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        ignorePresetUpdates = config.get<boolean>('ignorePresetUpdates') || false;
    }
}

export async function activate(context: vscode.ExtensionContext) {
    context.globalState.setKeysForSync([CONFIG_CHECKSUM, CONFIG_STORAGE]);

    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

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
