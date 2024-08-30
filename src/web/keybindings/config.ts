import * as vscode from 'vscode';
import hash from 'object-hash';
import {Bindings} from './processing';
import {parseBindings} from './parsing';
import {processParsing} from '.';
import {get} from '../utils';
import {inflate, deflate} from 'pako';

export let bindings: Bindings | undefined = undefined;
let configState: vscode.Memento | undefined = undefined;
export type ConfigListener = (x: Bindings | undefined) => Promise<void>;
const listeners: ConfigListener[] = [];

async function updateBindings(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        const configId = config.get<string>('activatedBindingsId') || 'none';
        useBindings(configId);
    }
}

interface IStorage {
    userBindings?: string;
    presetBindings?: string;
}

export async function createUserBindings(
    userBindings: string
): Promise<Bindings | undefined> {
    if (configState) {
        const config = vscode.workspace.getConfiguration('master-key');
        const storage = config.get<IStorage>('storage') || {};
        const newBindings: string = inflate(atob(storage.presetBindings || ''), {
            to: 'string',
        });

        const newParsedBindings = processParsing(
            await parseBindings(newBindings + userBindings)
        );
        if (newParsedBindings) {
            bindings = newParsedBindings;
            return newParsedBindings;
        }
    }
    return undefined;
}

export async function createBindings(newBindings: string): Promise<Bindings | undefined> {
    const config = vscode.workspace.getConfiguration('master-key');
    const storage = config.get<IStorage>('storage') || {};

    const userBindingsData = get(storage, 'userBindings', '');
    const userBindings: string = inflate(atob(userBindingsData || ''), {to: 'string'});

    const newParsedBindings = processParsing(
        await parseBindings(newBindings + userBindings)
    );
    if (newParsedBindings) {
        bindings = newParsedBindings;
        const newBindingsData = btoa(deflate(newBindings));
        storage.presetBindings = newBindingsData;
        config.update('storage', storage);
        return newParsedBindings;
    } else {
        return undefined;
    }
}

async function useBindings(label: string) {
    if (label === 'none') {
        bindings = undefined;
        if (configState) {
            for (const fn of listeners || []) {
                await fn(bindings);
            }
        }
        return;
    }
    if (configState) {
        if (configState.get(label)) {
            bindings = configState.get(label);
            for (const fn of listeners || []) {
                await fn(bindings);
            }
            return;
        }
    }
    vscode.window.showErrorMessage(
        `Could not load bindings with label: ${label}. Try using Master Key to activate a
        different set of keybindgs or to reactivate the same binding set.`
    );
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
