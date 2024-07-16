import * as vscode from 'vscode';
import z from 'zod';
import {onResolve} from '../state';
import {validateInput} from '../utils';
import {withState, recordedCommand, CommandResult} from '../state';
import {ModeSpec} from '../keybindings/parsing';
import {runCommandOnKeys} from './capture';
import {onChangeBindings} from '../keybindings/config';
import {Bindings} from '../keybindings/processing';

export const MODE = 'mode';

const CURSOR_STYLES = {
    Line: vscode.TextEditorCursorStyle.Line,
    Block: vscode.TextEditorCursorStyle.Block,
    Underline: vscode.TextEditorCursorStyle.Underline,
    LineThin: vscode.TextEditorCursorStyle.LineThin,
    BlockOutline: vscode.TextEditorCursorStyle.BlockOutline,
    UnderlineThin: vscode.TextEditorCursorStyle.UnderlineThin,
};

function updateCursorAppearance(
    editor: vscode.TextEditor | undefined,
    mode: string,
    modeSpec: Record<string, ModeSpec>
) {
    if (editor) {
        editor.options.cursorStyle =
            CURSOR_STYLES[modeSpec[mode]?.cursorShape] || vscode.TextEditorCursorStyle.Line;
    }
}

async function updateModeKeyCapture(mode: string, modeSpec: Record<string, ModeSpec>) {
    runCommandOnKeys(modeSpec[mode]?.onType, mode);
}

function updateLineNumbers(mode: string, modeSpec: Record<string, ModeSpec>) {
    const config = vscode.workspace.getConfiguration();
    const numbers = modeSpec[mode]?.lineNumbers || defaultLineNumbers;
    config.update(
        'editor.lineNumbers',
        numbers || defaultLineNumbers,
        vscode.ConfigurationTarget.Global
    );
}

const setModeArgs = z.object({value: z.string()}).strict();
async function setMode(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.setMode', args_, setModeArgs);
    if (args) {
        const a = args;
        await withState(async state => state.set(MODE, {public: true}, a.value));
    }
    return args;
}
export let modeSpecs: Record<string, ModeSpec> = {};
export let defaultMode: string = 'default';
async function updateModeSpecs(bindings: Bindings | undefined) {
    modeSpecs = bindings?.mode || {};
    defaultMode = (Object.values(modeSpecs).filter(x => x.default)[0] || {name: 'default'})
        .name;
    await withState(async state => state.set(MODE, {public: true}, defaultMode).resolve());
}

let defaultLineNumbers: string = 'on';
async function updateLineNumConfig(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event?.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        defaultLineNumbers = config.get<string>('defaultLineNumbers') || 'on';
    }
}

let currentMode = 'default';
export async function activate(context: vscode.ExtensionContext) {
    await updateLineNumConfig();
    vscode.workspace.onDidChangeConfiguration(updateLineNumConfig);

    onChangeBindings(updateModeSpecs);

    vscode.window.onDidChangeActiveTextEditor(e => {
        updateCursorAppearance(e, currentMode, modeSpecs);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setMode', recordedCommand(setMode))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.enterInsert',
            recordedCommand(() => setMode({value: 'insert'}))
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.enterNormal',
            recordedCommand(() => setMode({value: 'normal'}))
        )
    );

    await withState(async state => state.set(MODE, {public: true}, defaultMode).resolve());
    await onResolve('mode', values => {
        const cmode = currentMode; // NOTE: I don't really know why I to declare `cmode`
        // instead of using `currentMode` directly but not doing it prevents this function
        // from detecting changes to the mode state (something about how closures interact
        // with scopes and async that I don't understand???)
        const newMode = <string>values.get(MODE, defaultMode);
        if (cmode !== newMode) {
            updateCursorAppearance(
                vscode.window.activeTextEditor,
                newMode,
                modeSpecs || {}
            );
            updateModeKeyCapture(newMode, modeSpecs || {});
            updateLineNumbers(newMode, modeSpecs || {});
            currentMode = newMode;
        }
        return true;
    });
}
