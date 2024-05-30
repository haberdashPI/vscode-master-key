import * as vscode from 'vscode';

// Config state are global properties of the current keybindings maintained by master key
// that aren't stored as parting of the user's keybindigns, and don't make sense to store as
// part of the user settings (because there is no reason for the user to edit these
// settings, they are changes as part of the master keybinding file that gets imported. They
// define things like how each keybinding mode works, and what

export type ConfigListener = (x: any) => Promise<void>;

let configState: vscode.Memento;
let listeners: Record<string, ConfigListener[]> = {};

export async function updateConfig<T>(key: string, value: T){
    configState.update(key, value);
    for(let fn of (listeners[key] || [])){
        await fn(value);
    }
}

export async function onConfigUpdate(key: string, fn: ConfigListener){
    await fn(configState.get(key, undefined));
    let ls = listeners[key] || [];
    ls.push(fn);
    listeners[key] = ls;
    return;
}

export function activate(context: vscode.ExtensionContext){
    configState = context.globalState;
}
