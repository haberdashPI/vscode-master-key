import * as vscode from 'vscode';
import z from 'zod';
import { onResolve } from '../state';
import { validateInput } from '../utils';
import { withState, recordedCommand, CommandResult } from '../state';
import { ModeSpec } from '../keybindings/parsing';
import { doCommandsCmd } from './do';

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

let typeSubscription: vscode.Disposable | undefined;
function clearTypeSubscription(){
    if(typeSubscription){
        typeSubscription.dispose();
        typeSubscription = undefined;
    }
}

function updateModeKeyCapture(mode: string, modeSpec: Record<string, ModeSpec>){
    if(modeSpec[mode]){
        if(modeSpec[mode].onType){
            let onType = modeSpec[mode].onType;
            clearTypeSubscription();
            if(!typeSubscription){
                try{
                    typeSubscription = vscode.commands.registerCommand('type', async (typed: string) => {
                        await withState(async state =>
                            state.set(TYPED, {transient: {reset: ""}}, typed));
                        doCommandsCmd(onType);
                    });
                }catch(e){
                    vscode.window.showErrorMessage(`Master Key failed to capture keyboard input. You
                        might have an extension that is already listening to type events
                        (e.g. vscodevim).`);
                }
            }
        }else{
            clearTypeSubscription();
        }
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
        currentMode = <string>values.get(MODE, defaultMode);
        updateCursorAppearance(vscode.window.activeTextEditor, currentMode, modeSpecs || {});
        updateModeKeyCapture(currentMode, modeSpecs || {});
        return true;
    });

}
