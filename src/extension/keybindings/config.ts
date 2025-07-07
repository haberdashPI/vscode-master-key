import * as vscode from 'vscode';
import { Bindings } from './processing';
import { parseBindings } from './parsing';
import { processParsing } from '.';
import { get } from '../utils';
import { inflate, deflate } from 'pako';

export let bindings: Bindings | undefined = undefined;
let configState: vscode.Memento | undefined = undefined;
export type ConfigListener = (x: Bindings | undefined) => Promise<void>;
const listeners: ConfigListener[] = [];

async function updateBindings(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event.affectsConfiguration('master-key.storage')) {
        useBindings();
    }
}

interface IStorage {
    userBindings?: string;
    presetBindings?: string;
}

function toZip64(str: string) {
    const bytes = deflate(str, { level: 9 });
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function fromZip64(str: string): string {
    const result = inflate(
        Uint8Array.from(atob(str), c => c.charCodeAt(0)),
        { to: 'string' },
    );
    return result || '';
}

export async function clearUserBindings() {
    if (configState) {
        const config = vscode.workspace.getConfiguration('master-key');
        const storage = config.get<IStorage>('storage') || {};
        storage.userBindings = undefined;
        config.update('storage', storage, vscode.ConfigurationTarget.Global);
        const newBindings: string = fromZip64(storage.presetBindings || '');
        const newParsedBindings = processParsing(await parseBindings(newBindings));
        if (newParsedBindings) {
            bindings = newParsedBindings;
            return newParsedBindings;
        }
    }
    return undefined;
}

export async function createUserBindings(
    userBindings: string,
): Promise<Bindings | undefined> {
    if (configState) {
        const config = vscode.workspace.getConfiguration('master-key');
        const storage = config.get<IStorage>('storage') || {};
        const newBindings: string = fromZip64(storage.presetBindings || '');

        if (newBindings) {
            const newParsedBindings = processParsing(
                await parseBindings(newBindings + userBindings),
            );
            if (newParsedBindings) {
                bindings = newParsedBindings;
                storage.userBindings = toZip64(userBindings);
                config.update('storage', storage, vscode.ConfigurationTarget.Global);
                return newParsedBindings;
            }
        } else {
            vscode.window.showErrorMessage(
                'User bindings have not been activated ' +
                ' because you have no Master Key preset keybindings. Call `Master Key: `' +
                'Activate Keybindings` to add a preset.',
            );
        }
    }
    return undefined;
}

export async function createBindings(newBindings: string): Promise<Bindings | undefined> {
    const config = vscode.workspace.getConfiguration('master-key');
    const storage = config.get<IStorage>('storage') || {};

    const userBindingsData = get(storage, 'userBindings', '');
    const userBindings: string = fromZip64(userBindingsData || '') || '';

    if (newBindings) {
        const newParsedBindings = processParsing(
            await parseBindings(newBindings + '\n' + userBindings),
        );
        if (newParsedBindings) {
            bindings = newParsedBindings;
            const newBindingsData = toZip64(newBindings);
            storage.presetBindings = newBindingsData;
            config.update('storage', storage, vscode.ConfigurationTarget.Global);
            return newParsedBindings;
        } else {
            return undefined;
        }
    } else {
        config.update('storage', {}, vscode.ConfigurationTarget.Global);
        return undefined;
    }
}

export async function getBindings() {
    const config = vscode.workspace.getConfiguration('master-key');
    const storage = config.get<IStorage>('storage') || {};
    const preset = fromZip64(storage.presetBindings || '') || '';
    const user = fromZip64(storage.userBindings || '') || '';
    if (preset) {
        const parsedBindings = processParsing(await parseBindings(preset + '\n' + user));
        bindings = parsedBindings;
    } else {
        bindings = undefined;
    }
    return bindings;
}

async function useBindings() {
    const config = vscode.workspace.getConfiguration('master-key');
    const storage = config.get<IStorage>('storage') || {};
    const preset = fromZip64(storage.presetBindings || '') || '';
    const user = fromZip64(storage.userBindings || '') || '';
    if (preset) {
        const parsedBindings = processParsing(await parseBindings(preset + '\n' + user));
        for (const fn of listeners || []) {
            await fn(parsedBindings);
        }
        bindings = parsedBindings;
    } else {
        for (const fn of listeners || []) {
            await fn(undefined);
        }
        bindings = undefined;
    }
}

// Config state are global properties of the current keybindings maintained by master key
// that aren't stored as parting of the user's keybindigns, and don't make sense to store as
// part of the user settings (because there is no reason for the user to edit these
// settings, they are changes as part of the master keybinding file that gets imported. They
// define things like how each keybinding mode works, and what

export async function onChangeBindings(fn: ConfigListener) {
    if (configState) {
        await fn(bindings);
    }
    listeners.push(fn);
    return;
}

export async function activate(context: vscode.ExtensionContext) {
    configState = context.globalState;
    for (const fn of listeners || []) {
        await fn(bindings);
    }

    updateBindings();
    vscode.workspace.onDidChangeConfiguration(updateBindings);
}
