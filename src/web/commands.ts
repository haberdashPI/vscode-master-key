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

type ListenerRequest = "keepOpen" | "close";

// TODO: we will need to implement API equivalent flags
// for each 'when' clause context variable we want to use

// TODO: we should make a task to make it possible
// to register new variables here that extensions can hook into


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


const repeatCommandArgs = bindingCommand.extend({
    repeat: z.number().min(0).optional()
});
async function repeatCommand(args_: unknown){
    let args = validateInput('master-key.repeat', args_, repeatCommandArgs);
    if(args){
        for(let i=0;i<(args.repeat || 1);i++){
            await runCommand({ command: args.command, args: args.args, computedArgs: args.computedArgs });
        }
    }
}
commands['master-key.repeat'] = repeatCommand;

// TODO: move a more limited version of this (set flag) to `state.ts`)
// TODO: there needs to be more data validation for the standard state values; only
// arbitrary values should be free to be any value
const setArgs = z.object({
    name: z.string(),
    value: z.any(),
    transient: z.boolean().default(false).optional()
}).strict();
type SetArgs = z.infer<typeof setArgs>;

function setCmd(args_: unknown){
    let args = validateInput('master-key.set', args_, setArgs);
    if(args){
        state.setKeyContextForUser(args.name, args.value, args.transient || false);
    }
}

export function setKeyContext(args: SetArgs){
    state.setKeyContext(args.name, args.value, args.transient || false);
}
commands['master-key.set'] = setCmd;
const setModeArgs = z.object({ value: z.string() }).strict();
commands['master-key.setMode'] = function(args_: unknown){
    let args = validateInput('master-key.setMode', args_, setModeArgs);
    if(args){
        return setKeyContext({name: 'mode', value: (<any>args).value});
    }
};
commands['master-key.enterInsert'] = (x) => setKeyContext({name: 'mode', value: 'insert'});
commands['master-key.enterNormal'] = (x) => setKeyContext({name: 'mode', value: 'normal'});

// TODO: move to state.ts??? (do we actually need it)
function reset(): void{ state.reset(); }
commands['master-key.reset'] = reset;

commands['master-key.ignore'] = () => undefined;

const storeNamedArgs = z.object({
    description: z.string().optional(),
    name: z.string(),
    contents: z.string(),
});
let stored: Record<string, Record<string, any>> = {};
function storeNamed(args_: unknown){
    let argsNow = validateInput('master-key.storeNamed', args_, storeNamedArgs);
    if(argsNow){
        let args = argsNow;
        let value = evalContext.evalStr(args.contents, state.values);
        if(value !== undefined){
            let picker = vscode.window.createQuickPick();
            picker.title = args.description || args.name;
            picker.placeholder = "Enter a new or existing name";
            let options: vscode.QuickPickItem[] = Object.keys(stored[args.name] || {}).
                map(k => ({label: k}));
            options.unshift(
                {label: "New Name...", alwaysShow: true},
                {label: "Existing Names:", kind: vscode.QuickPickItemKind.Separator,
                 alwaysShow: true}
            );
            picker.items = options;
            picker.onDidAccept(e => {
                let item = picker.selectedItems[0];
                let name;
                if(item.label === "New Name..."){
                    name = picker.value;
                }else{
                    name = item.label;
                }
                if(stored[args.name] === undefined){
                    stored[args.name] = {};
                }
                stored[args.name][name] = value;
                picker.hide();
            });
            picker.show();
        }
    }
}
commands['master-key.storeNamed'] = storeNamed;

const restoreNamedArgs = z.object({
    description: z.string().optional(),
    name: z.string(),
    doAfter: doArgs
});
async function restoreNamed(args_: unknown){
    let args = validateInput('master-key.restoreNamed', args_, restoreNamedArgs);
    if(args){
        if(!stored[args.name]){
            vscode.window.showErrorMessage(`No values are stored under '${args.name}'.`);
        }
        let items = Object.keys(stored[args.name]).map(x => ({label: x}));
        let selected = await vscode.window.showQuickPick(items);
        if(selected !== undefined){
            setKeyContext({ name: 'captured', value: stored[args.name][selected.label] });
            runCommands({ do: args.doAfter });
        }
    }
}
commands['master-key.restoreNamed'] = restoreNamed;

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
