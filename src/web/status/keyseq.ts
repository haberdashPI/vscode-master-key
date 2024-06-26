import * as vscode from 'vscode';
import { onSet } from '../state';
import { PREFIX } from '../commands/prefix';
import { COUNT } from '../commands/count';
import { Map } from 'immutable';
import { prettifyPrefix } from '../utils';

let keyStatusBar: vscode.StatusBarItem | undefined = undefined;

let keyDisplayDelay: number = 500;
let statusUpdates = Number.MIN_SAFE_INTEGER;

function updateKeyStatus(values: Map<string, unknown>){
    let count = <number>values.get(COUNT, 0);
    let plannedUpdate = count ? count + "× " : '';
    plannedUpdate += prettifyPrefix(<string>values.get(PREFIX, ''));
    if(keyStatusBar !== undefined){
        if(plannedUpdate.length > 0){
            keyStatusBar.text = plannedUpdate;
        }else{
            // clearing the prefix is delayed so users can see the completed command
            let currentUpdate = statusUpdates;
            setTimeout(() => {
                if(currentUpdate === statusUpdates){
                    if(statusUpdates < Number.MAX_SAFE_INTEGER){
                        statusUpdates += 1;
                    }else{
                        statusUpdates = Number.MIN_SAFE_INTEGER;
                    }

                    if(keyStatusBar){ keyStatusBar.text = plannedUpdate; }
                }
            }, keyDisplayDelay);
        }
    }
    return true;
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let configDelay = config.get<number>('keyDisplayDelay');
        if(configDelay !== undefined){
            keyDisplayDelay = configDelay;
        }
    }
}

export async function activate(context: vscode.ExtensionContext){
    keyStatusBar = vscode.window.createStatusBarItem('keys', vscode.StatusBarAlignment.Left, -10000);
    keyStatusBar.accessibilityInformation = { label: "Keys Typed" };
    keyStatusBar.show();
    await onSet(PREFIX, updateKeyStatus);
    await onSet(COUNT, updateKeyStatus);
}
