import * as vscode from 'vscode';
import hash from 'object-hash';
import {Bindings} from './processing';

let storageUri: vscode.Uri;
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

export async function createBindings(newBindings: Bindings) {
    const hashStr = hash(newBindings);
    const label = newBindings.name + ' ' + hashStr;
    bindings = newBindings;
    vscode.workspace.fs.createDirectory(storageUri);
    const bindingFile = vscode.Uri.joinPath(storageUri, label + '.json');
    const data = new TextEncoder().encode(JSON.stringify(newBindings));
    vscode.workspace.fs.writeFile(bindingFile, data);
    return label;
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
    const configFile = vscode.Uri.joinPath(storageUri, label + '.json');
    try {
        await vscode.workspace.fs.stat(configFile);
        const data = await vscode.workspace.fs.readFile(configFile);
        const newBindings = <Bindings>JSON.parse(new TextDecoder().decode(data));
        bindings = newBindings;
        if (configState) {
            for (const fn of listeners || []) {
                await fn(bindings);
            }
        }
    } catch (e) {
        console.dir(e);
        vscode.window.showErrorMessage('Could not load bindings with label: ' + configFile);
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
    storageUri = context.globalStorageUri;
    configState = context.globalState;
    for (const fn of listeners || []) {
        await fn(bindings);
    }

    updateBindings();
    vscode.workspace.onDidChangeConfiguration(updateBindings);
}
