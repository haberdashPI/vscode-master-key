import * as vscode from 'vscode';

// Config state are global properties of the current keybindings maintained by master key
// that aren't stored as parting of the user's keybindigns, and don't make sense to store as
// part of the user settings (because there is no reason for the user to edit these
// settings, they are changes as part of the master keybinding file that gets imported. They
// define things like how each keybinding mode works, and what

export type ConfigListener = (x: any) => Promise<void>;

let configState: vscode.Memento | undefined = undefined;
let listeners: Record<string, ConfigListener[]> = {};

export function getConfig(key: string){
    return configState?.get(key);
}

export async function updateConfig<T>(key: string, value: T){
    if(configState){
        let oldValue = configState.get(key);
        if(oldValue !== value){
            configState.update(key, value);
            for(let fn of (listeners[key] || [])){
                await fn(value);
            }
        }
    }else{
        throw(Error("Tried to update config state before activating config"));
    }
}

interface IConfigUpdateOpts{
    triggerOnInit?: boolean
}

export async function onConfigUpdate(key: string, optsOrFn: IConfigUpdateOpts | ConfigListener, fn_?: ConfigListener){
    let fn: ConfigListener;
    let opts: IConfigUpdateOpts;
    if(fn_){
        fn = <ConfigListener>fn_;
        opts = <IConfigUpdateOpts>optsOrFn;
    }else{
        fn = <ConfigListener>optsOrFn;
        opts = {};
    }
    if(opts.triggerOnInit === undefined){ opts.triggerOnInit = true; }

    if(configState && opts.triggerOnInit){
        await fn(configState.get(key, undefined));
    }
    let ls = listeners[key] || [];
    ls.push(fn);
    listeners[key] = ls;
    return;
}

export async function activate(context: vscode.ExtensionContext){
    configState = context.globalState;
    if(configState){
        for(let key of configState.keys()){
            for(let fn of (listeners[key])){
                await fn(configState.get(key, undefined));
            }
        }
    }
}
