import * as modeStatus from './mode-status';
import * as keySequence from './keyseq';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext){
    modeStatus.activate(context);
    keySequence.activate(context);
}
