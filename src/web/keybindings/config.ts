import * as vscode from 'vscode';
import { hash } from 'immutable';
import { Utils } from 'vscode-uri';
import { Bindings, IConfigKeyBinding } from './processing';

let storageUri: vscode.Uri;
export let bindings: Bindings | undefined = undefined;
let configState: vscode.Memento | undefined = undefined;
export type ConfigListener = (x: Bindings | undefined) => Promise<void>;
let listeners: ConfigListener[] = [];

async function updateBindings(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let storedId = configState?.get('activatedBindingsId') || 'none';
        let configId = config.get<string>('activatedBindingsId') || 'none';
        if(storedId !== configId){
            configState?.update('activatedBindingsId', configId);
            loadBindings(configId);
        }
    }
}

async function createBindings(newBindings: Bindings){
    let label = newBindings.name + " " + hash(newBindings);
    bindings = newBindings;
    vscode.workspace.fs.createDirectory(storageUri);
    let bindingFile = vscode.Uri.joinPath(storageUri, label+'.json');
    let data = new TextEncoder().encode(JSON.stringify(newBindings));
    vscode.workspace.fs.writeFile(bindingFile, data);
    return label;
}

async function loadBindings(label: string){
    if(label === 'none'){
        bindings = undefined;
        if(configState){ for(let fn of (listeners || [])){ await fn(bindings); } }
        return;
    };
    let configFile = vscode.Uri.joinPath(storageUri, label+'.json');
    try{
        await vscode.workspace.fs.stat(configFile);
        let data = await vscode.workspace.fs.readFile(configFile);
        let newBindings = <Bindings>JSON.parse(new TextDecoder().decode(data));
        bindings = newBindings;
        if(configState){ for(let fn of (listeners || [])){ await fn(bindings); } }
    }catch{
        vscode.window.showErrorMessage("Could not load bindings with label: "+configFile);
    }
}

// Config state are global properties of the current keybindings maintained by master key
// that aren't stored as parting of the user's keybindigns, and don't make sense to store as
// part of the user settings (because there is no reason for the user to edit these
// settings, they are changes as part of the master keybinding file that gets imported. They
// define things like how each keybinding mode works, and what


export async function setBindings(bindings: Bindings) {
    let config = vscode.workspace.getConfiguration('master-key');
    let label = await createBindings(bindings);
    config.update('activatedBindingsId', label, true);
}

export async function onChangeBindings(fn: ConfigListener){
    if(configState){ await fn(bindings); }
    listeners.push(fn);
    return;
}

export async function activate(context: vscode.ExtensionContext){
    storageUri = context.globalStorageUri;
    configState = context.globalState;
    for(let fn of (listeners || [])){ await fn(bindings); }

    updateBindings();
    vscode.workspace.onDidChangeConfiguration(updateBindings);

    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.removePreset',
        () => {
            let config = vscode.workspace.getConfiguration('master-key');
            config.update('activatedBindingsId', 'none');
        }
    ));
}
