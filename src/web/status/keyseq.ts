import * as vscode from 'vscode';
import { CommandState, onResolve } from '../state';
import replaceAll from 'string.prototype.replaceall';
import { PREFIX } from '../commands/prefix';
import { COUNT } from '../commands/count';

function prettifyPrefix(str: string){
    str = str.toUpperCase();
    str = replaceAll(str, /shift\+/gi, '⇧');
    str = replaceAll(str, /ctrl\+/gi, '^');
    str = replaceAll(str, /alt\+/gi, '⌥');
    str = replaceAll(str, /meta\+/gi, '◆');
    str = replaceAll(str, /win\+/gi, '⊞');
    str = replaceAll(str, /cmd\+/gi, '⌘');
    str = replaceAll(str, / /g, ", ");
    str = replaceAll(str, /escape/gi, "ESC");
    return str;
}

let keyStatusBar: vscode.StatusBarItem | undefined = undefined;

let statusUpdates = Number.MIN_SAFE_INTEGER;
async function updateKeyStatus(state: CommandState){
    let count = state.get<number>(COUNT);
    let plannedUpdate = count ? count + "× " : '';
    plannedUpdate += prettifyPrefix(state.get(PREFIX) || '');
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
            });
        }
    }
    return true;
}

export async function activate(context: vscode.ExtensionContext){
    keyStatusBar = vscode.window.createStatusBarItem('keys', vscode.StatusBarAlignment.Left, -10000);
    keyStatusBar.accessibilityInformation = { label: "Keys Typed" };
    keyStatusBar.show();
    await onResolve('keySequence', updateKeyStatus);
}
