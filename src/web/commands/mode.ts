import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { validateInput } from '../utils';
import { withState, recordedCommand, CommandState, CommandResult } from '../state';

export const MODE = 'mode';

function updateCursorAppearance(editor: vscode.TextEditor | undefined, mode: string){
    if(editor){
        if(mode === 'capture'){
            editor.options.cursorStyle = vscode.TextEditorCursorStyle.Underline;
        }else if(mode !== 'insert'){
            editor.options.cursorStyle = vscode.TextEditorCursorStyle.Block;
        }else{
            editor.options.cursorStyle = vscode.TextEditorCursorStyle.Line;
        }
    }
}

const setModeArgs = z.object({ value: z.string() }).strict();
async function setMode(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.setMode', args_, setModeArgs);
    if(args){
        let a = args;
        withState(async state => {
            return state.update(MODE, {public: true}, x => a.value);
        });
    }
    return [undefined, state];
};

let currentMode = 'insert';
export async function activate(context: vscode.ExtensionContext){
    vscode.window.onDidChangeActiveTextEditor(e => {
        updateCursorAppearance(e, currentMode);
    });

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setMode',
        recordedCommand(setMode)));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.enterInsert',
        recordedCommand(s => setMode(s, {value: 'insert'}))));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.enterNormal',
        recordedCommand(s => setMode(s, {value: 'normal'}))));

    await onResolve('mode', values => {
        currentMode = <string>values.get(MODE, 'insert');
        updateCursorAppearance(vscode.window.activeTextEditor, currentMode);
        return true;
    });

}
