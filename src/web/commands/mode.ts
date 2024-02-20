import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { validateInput } from '../utils';
import { wrapStateful, CommandState, CommandResult } from '../state';

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
        state.set(MODE, args.value, {public: true});
    }
    return [undefined, state];
};

let currentMode = 'insert';
export function activate(context: vscode.ExtensionContext){
    onResolve('mode', async state => {
        currentMode = state.get<string>(MODE, 'insert')!;
        updateCursorAppearance(vscode.window.activeTextEditor, currentMode);
        return true;
    });
    vscode.window.onDidChangeActiveTextEditor(e => {
        updateCursorAppearance(e, currentMode);
    });

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setMode',
        wrapStateful(setMode)));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.enterInsert',
        wrapStateful(s => setMode(s, {value: 'insert'}))));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.enterNormal',
        wrapStateful(s => setMode(s, {value: 'normal'}))));
}
