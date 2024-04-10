import * as vscode from 'vscode';
import { CommandState, onResolve, withState } from '../state';
import { RECORD } from '../commands/replay';
import { MODE } from '../commands/mode';
import { Map } from 'immutable';

function updateModeStatus(state: Map<string, unknown> | CommandState ){
    if(modeStatusBar !== undefined){
        modeStatusBar.text = (state.get<boolean>(RECORD, false) ? "rec: " : "") +
            (state.get<string>(MODE, 'insert'))!;
        if(state.get<boolean>(RECORD, false)){
            modeStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        }else if(modeStatusBar.text !== 'insert'){
            modeStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }else{
            modeStatusBar.backgroundColor = undefined;
        }
    }
    return true;
}

let modeStatusBar: vscode.StatusBarItem | undefined = undefined;
export async function activate(context: vscode.ExtensionContext){
    modeStatusBar = vscode.window.createStatusBarItem('mode', vscode.StatusBarAlignment.Left, 100000);
    modeStatusBar.accessibilityInformation = { label: "Keybinding Mode" };
    modeStatusBar.show();

    await withState(async state => {
        updateModeStatus(state);
        return state;
    });
    await onResolve('modeStatus', updateModeStatus);
}
