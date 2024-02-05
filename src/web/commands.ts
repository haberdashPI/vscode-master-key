import * as vscode from 'vscode';
import { doArgs, validModes, bindingCommand, BindingCommand } from './keybindingParsing';
import { PrefixCodes, isSingleCommand } from './keybindingProcessing';
import { reifyStrings, EvalContext } from './expressions';
import { validateInput } from './utils';
import z, { record } from 'zod';
import { clearSearchDecorations, trackSearchUsage, wasSearchUsed } from './searching';
import { merge, cloneDeep, uniq } from 'lodash';
import { INPUT_CAPTURE_COMMANDS } from './keybindingParsing';
import replaceAll from 'string.prototype.replaceall';
import { CommandState } from './state';

let state = new CommandState();

let modeStatusBar: vscode.StatusBarItem | undefined = undefined;
let keyStatusBar: vscode.StatusBarItem | undefined = undefined;
let searchStatusBar: vscode.StatusBarItem | undefined = undefined;
let evalContext = new EvalContext();

let commands: Record<string, ((x: unknown) => any) | (() => any)> = {};

function updateStatusBar(opt: {delayStatusBarUpdate: boolean} = {delayStatusBarUpdate: false}){
    if(modeStatusBar !== undefined && keyStatusBar !== undefined &&
       searchStatusBar !== undefined){
        let plannedModeStatusBar = (state.values.record ? "rec: " : "") +
            (state.values.mode || 'insert');
        let plannedSearchStatusBar = state.values.search || '';

        if(opt.delayStatusBarUpdate){
            let currentUpdate = statusUpdates;
            setTimeout(() => {
                if(currentUpdate === statusUpdates){
                    if(statusUpdates < Number.MAX_SAFE_INTEGER){
                        statusUpdates += 1;
                    }else{
                        statusUpdates = Number.MIN_SAFE_INTEGER;
                    }
                    if(modeStatusBar){
                        if(state.values.record){
                            modeStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
                        }else if(plannedModeStatusBar !== 'insert'){
                            modeStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                        }else{
                            modeStatusBar.backgroundColor = undefined;
                        }
                        modeStatusBar.text = plannedModeStatusBar;
                    }
                    if(searchStatusBar){ searchStatusBar.text = plannedSearchStatusBar; }
                }
            }, 1000);
        }else{
            if(statusUpdates < Number.MAX_SAFE_INTEGER){
                statusUpdates += 1;
            }else{
                statusUpdates = Number.MIN_SAFE_INTEGER;
            }
            if(state.values.record){
                modeStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
            }else if(plannedModeStatusBar !== 'insert'){
                modeStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }else{
                modeStatusBar.backgroundColor = undefined;
            }
            modeStatusBar.text = plannedModeStatusBar;
            searchStatusBar.text = plannedSearchStatusBar;
        }
    }
}

const keyContext = z.object({
    prefix: z.string(),
    prefixCode: z.number(),
    count: z.number(),
    mode: z.string(),
    validModes: validModes
}).passthrough();
type KeyContext = z.infer<typeof keyContext> & { [key: string]: any } & {
    editorHasSelection: boolean,
    editorHasMultipleSelections: boolean,
    editorHasMultiLineSelection: boolean,
    editorLangId: undefined | string,
    firstSelectionOrWord: string,
    prefixCodes: PrefixCodes,
    macro: RecordedCommandArgs[][],
    commandHistory: RecordedCommandArgs[],
    record: boolean,
};

const keyContextKey = z.string().regex(/[a-zA-Z_]+[0-9a-zA-Z_]*/);

function updateCursorAppearance(editor: vscode.TextEditor, mode: string){
    // TODO: make these user configurable
    if(mode === 'capture'){
        editor.options.cursorStyle = vscode.TextEditorCursorStyle.Underline;
    }else if(mode !== 'insert'){
        editor.options.cursorStyle = vscode.TextEditorCursorStyle.Block;
    }else{
        editor.options.cursorStyle = vscode.TextEditorCursorStyle.Line;
    }
}


const setModeArgs = z.object({ value: z.string() }).strict();
commands['master-key.setMode'] = function(args_: unknown){
    let args = validateInput('master-key.setMode', args_, setModeArgs);
    if(args){
        return setKeyContext({name: 'mode', value: (<any>args).value});
    }
};
commands['master-key.enterInsert'] = (x) => setKeyContext({name: 'mode', value: 'insert'});
commands['master-key.enterNormal'] = (x) => setKeyContext({name: 'mode', value: 'normal'});

commands['master-key.ignore'] = () => undefined;

export function activate(context: vscode.ExtensionContext) {
    modeStatusBar = vscode.window.createStatusBarItem('mode', vscode.StatusBarAlignment.Left, 100000);
    modeStatusBar.accessibilityInformation = { label: "Keybinding Mode" };
    modeStatusBar.show();

    keyStatusBar = vscode.window.createStatusBarItem('keys', vscode.StatusBarAlignment.Left, -10000);
    keyStatusBar.accessibilityInformation = { label: "Keys Typed" };
    keyStatusBar.show();

    searchStatusBar = vscode.window.createStatusBarItem('capture', vscode.StatusBarAlignment.Left, -9999);
    searchStatusBar.accessibilityInformation = { label: "Search Text" };
    searchStatusBar.show();

    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    vscode.workspace.onDidChangeTextDocument(e => {
        let end = state.values.commandHistory.length-1;
        let lastCommand = state.values.commandHistory[end];
        if(lastCommand && typeof lastCommand.edits !== 'string' && lastCommand.recordEdits){
            lastCommand.edits = lastCommand.edits.concat(e);
        }
    });

    vscode.window.onDidChangeTextEditorSelection(e => {
        let selCount = 0;
        for(let sel of e.selections){
            if(!sel.isEmpty){ selCount += 1; }
            if(selCount > 1){ break; }
        }
        state.values.editorHasSelection = selCount > 0;
        state.values.editorHasMultipleSelections = selCount > 1;
        let doc = e.textEditor.document;

        if(e.selections[0].isEmpty){
            let wordRange = doc.getWordRangeAtPosition(e.selections[0].start);
            state.values.firstSelectionOrWord = doc.getText(wordRange);
        }else{
            state.values.firstSelectionOrWord = doc.getText(e.selections[0]);
        }
        vscode.commands.executeCommand('setContext', 'master-key.firstSelectionOrWord',
            state.values.firstSelectionOrWord);
    });

    vscode.window.onDidChangeActiveTextEditor(e => {
        state.values.editorLangId = e?.document?.languageId;
        if(e){ updateCursorAppearance(e, state.values.mode); }
    });

    for (let [name, fn] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }
}
