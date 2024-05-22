import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { validateInput } from '../utils';
import { withState, recordedCommand, CommandResult } from '../state';
import { ModeSpec } from '../keybindings/parsing';
import { runCommandOnKeys } from './capture';

export const MODE = 'mode';
const TYPED = 'typed';

const CURSOR_STYLES = {
    "Line": vscode.TextEditorCursorStyle.Line,
    "Block": vscode.TextEditorCursorStyle.Block,
    "Underline": vscode.TextEditorCursorStyle.Underline,
    "LineThin": vscode.TextEditorCursorStyle.LineThin,
    "BlockOutline": vscode.TextEditorCursorStyle.BlockOutline,
    "UnderlineThin": vscode.TextEditorCursorStyle.UnderlineThin
};

function updateCursorAppearance(editor: vscode.TextEditor | undefined, mode: string,
                                modeSpec: Record<string, ModeSpec>){
    if(editor && modeSpec[mode]){
        editor.options.cursorStyle = CURSOR_STYLES[modeSpec[mode]?.cursorShape] || "Line";
    }
}

async function updateModeKeyCapture(mode: string, modeSpec: Record<string, ModeSpec>){
    if(modeSpec[mode]){
        runCommandOnKeys(modeSpec[mode].onType, mode);
    }
}

const setModeArgs = z.object({ value: z.string() }).strict();
async function setMode(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.setMode', args_, setModeArgs);
    if(args){
        let a = args;
        await withState(async state => state.set(MODE, {public: true}, a.value));
    }
    return args;
};
export let modeSpecs: Record<string, ModeSpec> = {};
export let defaultMode: string = 'default';
async function updateModeSpecs(event?: vscode.ConfigurationChangeEvent){
    if(!event || event?.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        modeSpecs = config.get<Record<string, ModeSpec>>('mode') || {};
        defaultMode = (Object.values(modeSpecs).filter(x => x.default)[0] || {name: 'default'}).name;
    }
}

let currentMode = 'default';
export async function activate(context: vscode.ExtensionContext){
    await updateModeSpecs();
    vscode.workspace.onDidChangeConfiguration(updateModeSpecs);

    vscode.window.onDidChangeActiveTextEditor(e => {
        updateCursorAppearance(e, currentMode, modeSpecs);
    });

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setMode',
        recordedCommand(setMode)));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.enterInsert',
        recordedCommand(() => setMode({value: 'insert'}))));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.enterNormal',
        recordedCommand(() => setMode({value: 'normal'}))));

    await withState(async state => state.set(MODE, {public: true}, defaultMode).resolve());
    await onResolve('mode', values => {
        let newMode = <string>values.get(MODE, defaultMode);
        if(currentMode !== newMode){
            currentMode = newMode;
            updateCursorAppearance(vscode.window.activeTextEditor, currentMode, modeSpecs || {});
            updateModeKeyCapture(currentMode, modeSpecs || {});
        }
        return true;
    });

}
