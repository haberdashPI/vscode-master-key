import * as vscode from 'vscode';
import { CommandState, onResolve, withState } from '../state';
import { RECORD } from '../commands/replay';
import { MODE, defaultMode, modeSpecs } from '../commands/mode';
import { Map } from 'immutable';
import { onConfigUpdate } from '../config';
import { ModeSpec } from '../keybindings/parsing';

function updateModeStatusHelper(state: Map<string, unknown> | CommandState,
    modeSpecs: Record<string, ModeSpec>){
    if(modeStatusBar){
        let mode = <string>state.get(MODE);
        let highlight = modeSpecs[mode] ? modeSpecs[mode].highlight : 'NoHighlight';
        let rec = state.get<boolean>(RECORD, false);
        modeStatusBar.text = (rec ? "rec: " : "") + mode;
        modeStatusBar.accessibilityInformation = { label: "Keybinding Mode: "+modeStatusBar.text };
        if(state.get<boolean>(RECORD, false) || highlight === 'Alert'){
            modeStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        }else if(highlight === 'Highlight'){
            modeStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }else{
            modeStatusBar.backgroundColor = undefined;
        }
    }
}

function updateModeStatus(state: Map<string, unknown> | CommandState ){
    updateModeStatusHelper(state, modeSpecs);
    return true;
}

async function updateModeStatusConfig(modeSpecs: Record<string, ModeSpec>){
    await withState(async state => {
        updateModeStatusHelper(state, modeSpecs);
        return state;
    });
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
    await onConfigUpdate('mode', updateModeStatusConfig);
}
