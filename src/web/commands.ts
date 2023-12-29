import * as vscode from 'vscode';
import { strictDoArgs, validModes, strictBindingCommand, StrictBindingCommand } from './keybindingParsing';
import { PrefixCodes, isSingleCommand, regularizeCommands } from './keybindingProcessing';
import { reifyStrings, EvalContext } from './expressions';
import { validateInput } from './utils';
import z from 'zod';
import { clearSearchDecorations, trackSearchUsage, wasSearchUsed } from './searching';
import { merge, cloneDeep } from 'lodash';
import { INPUT_CAPTURE_COMMANDS } from './keybindingParsing';

let modeStatusBar: vscode.StatusBarItem | undefined = undefined;
let keyStatusBar: vscode.StatusBarItem | undefined = undefined;
let countStatusBar: vscode.StatusBarItem | undefined = undefined;
let searchStatusBar: vscode.StatusBarItem | undefined = undefined;
let evalContext = new EvalContext();

let commands: Record<string, ((x: unknown) => any) | (() => any)> = {};

function updateStatusBar(){
    if(modeStatusBar !== undefined && keyStatusBar !== undefined && 
       countStatusBar !== undefined && searchStatusBar !== undefined){
        modeStatusBar.text = state.values.mode || 'insert';
        keyStatusBar.text = state.values.prefix || '';
        countStatusBar.text = state.values.count ?
            state.values.count + "×" : '';
        searchStatusBar.text = state.values.search || '';
    }
}

const keyContext = z.object({
    prefix: z.string(),
    prefixCode: z.number(),
    count: z.number(),
    mode: z.string(),
    search: z.string(),
    validModes: validModes
}).passthrough();
type KeyContext = z.infer<typeof keyContext> & { [key: string]: any } & {
    editorHasSelection: boolean,
    editorHasMultipleSelections: boolean,
    editorHasMultiLineSelection: boolean,
    editorLangId: undefined | string,
    firstSelectionOrWord: string,
    prefixCodes: PrefixCodes,
    macro: RunCommandsArgs[][],
    commandHistory: RunCommandsArgs[],
    record: boolean,
};

const keyContextKey = z.string().regex(/[a-zA-Z_]+[0-9a-zA-Z_]*/);

type ListenerRequest = "keepOpen" | "close";

// TODO: we will need to implement API equivalent flags
// for each 'when' clause context variable we want to use

// TODO: we should make a task to make it possible
// to register new variables here that extensions can hook into

class CommandState {
    values: KeyContext = {
        prefix: '',
        prefixCode: 0,
        prefixCodes: new PrefixCodes(),
        count: 0,
        mode: 'insert',
        search: '',
        validModes: ['insert'],
        editorHasSelection: false,
        editorHasMultipleSelections: false,
        editorHasMultiLineSelection: false,
        editorLangId: undefined,
        firstSelectionOrWord: "",
        macro: [],
        commandHistory: [],
        record: false
    };
    listeners: ((values: KeyContext) => ListenerRequest)[] = [];
    transientValues: Record<string, any> = { prefix: '', prefixCode: 0, count: 0 };
    constructor() {
        for (let [k, v] of Object.entries(this.values)) {
            vscode.commands.executeCommand('setContext', 'master-key.' + k, v);
        }
        updateStatusBar();
    }
    setKeyContextForUser(key: string, value: any, transient: boolean = false) {
        // key validation
        validateInput('master-key.set', { key }, z.object({ key: keyContextKey }));

        // value validation
        if ((<any>keyContext.shape)[key]) {
            validateInput('master-key.set', value, (<any>keyContext.shape)[key]);
        }
        if (key === 'mode') {
            if (!this.values.validModes.some(m => m === value)) {
                vscode.window.showErrorMessage(`Invalid mode '${value}'`);
            }
        }
        return this.setKeyContext(key, value, transient);
    }
    setKeyContext(key: string, value: any, transient: boolean = false) {
        // assignment
        let oldValue = this.values[key];
        if (key === 'prefixCodes') {
            this.values[key] = new PrefixCodes(value);
        }else{
            this.values[key] = value;
        }

        if(key === 'mode'){
            let editor = vscode.window.activeTextEditor;
            if(editor){ updateCursorAppearance(editor, value); }
        }
        if(transient){ this.transientValues[key] = oldValue; }
        vscode.commands.executeCommand('setContext', 'master-key.' + key, value);
        updateStatusBar();
        this.listeners = this.listeners.filter(l => l(this.values) === "keepOpen");
    }
    onContextChange(fn: (values: KeyContext) => ListenerRequest){ this.listeners.push(fn); }
    reset() {
        // clear any transient state
        for (let [k, v] of Object.entries(this.transientValues)) { this.setKeyContext(k, v); }
        this.transientValues = {
            count: 0,
            prefix: '',
            prefixCode: 0
        };
    }
}
export let state = new CommandState();

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


async function runCommand(command: StrictBindingCommand, i?: number){
    let recordedCommand = command;
    if(i !== undefined){
        let recordedCommands = state.values.
            commandHistory[state.values.commandHistory.length-1];
        recordedCommand = recordedCommands.do[i];
    }
    if(command.if !== undefined){
        let doRun: unknown = undefined;
        if(typeof command.if === 'boolean'){ doRun = command.if; }
        else{ 
            // we expect that all arguments have been reifiend when we re-run
            // a command, i === undefined when we are reunning a command
            if(i === undefined){ throw Error("Unexpected operation! This is a bug."); }
            doRun = evalContext.evalStr(command.if, state.values); 
        }
        if(i !== undefined){ recordedCommand.if = !!doRun; }
        if(!doRun){
            return; // if the if check fails, don't run the command
        }
    }
    let reifyArgs: Record<string, any> = command.args || {};
    if(command.computedArgs !== undefined){
        let computed = reifyStrings(command.computedArgs, 
            str => evalContext.evalStr(str, state.values));
        reifyArgs = merge(reifyArgs, computed);
        if(i !== undefined){
            recordedCommand.args = reifyArgs;
            recordedCommand.computedArgs = undefined;
        }else{
            // we expect that all arguments have been reifyied when we re-run
            // a command, i === undefined iff we are re-running a command
            throw Error("Unexpected operation! This is a bug.");
        }
    }
    await vscode.commands.executeCommand(command.command, reifyArgs);
}

const runCommandArgs = z.object({ 
    do: strictBindingCommand.array(),
    resetTransient: z.boolean().optional().default(true),
    kind: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional()
}).strict();
type RunCommandsArgs = z.input<typeof runCommandArgs>;

async function runCommandsCmd(args_: unknown){
    let args = validateInput('master-key.do', args_, runCommandArgs);
    if(args){
        if(!isSingleCommand(args.do, 'master-key.prefix')){
            state.values.commandHistory.push(cloneDeep(args));
            if( state.values.commandHistory.length > maxHistory ){ state.values.commandHistory.shift(); }
        }
        await runCommands(args); 
    }
}

export function updateArgs(args: Record<string, unknown> | "CANCEL"){
    if(args === "CANCEL"){
        state.values.commandHistory.pop();
    }else{
        let commands = state.values.commandHistory[state.values.commandHistory.length-1];
        // NOTE: while in principle this could update multiple arguments we have previously
        // validated that only one command in this array will be one of the commands listed
        // under `INPUT_CAPTURE_COMMANDS`
        commands.do = commands.do.map(cmd => {
            if(INPUT_CAPTURE_COMMANDS.some(c => `master-key.${c}` === cmd.command)){
                return { ...cmd, args };
            }
            return cmd;
        });
        state.values.commandHistory[state.values.commandHistory.length-1] = commands;
    }
}

let maxHistory = 0;

export async function runCommands(args: RunCommandsArgs){
    // run the commands
    trackSearchUsage();
    for (let i=0; i<args.do.length; i++) { await runCommand(args.do[i], i); }

    if(args.resetTransient){ 
        reset(); 
        if(!wasSearchUsed() && vscode.window.activeTextEditor){ 
            clearSearchDecorations(vscode.window.activeTextEditor) ;
        }
    }
    evalContext.reportErrors();
}
commands['master-key.do'] = runCommandsCmd;

const repeatCommandArgs = strictBindingCommand.extend({
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

const updateCountArgs = z.object({
    value: z.coerce.number()
}).strict();

function updateCount(args_: unknown){
    let args = validateInput('master-key.updateCount', args_, updateCountArgs);
    if(args !== undefined){
        state.setKeyContext('count', state.values.count*10 + args.value);
    }
}
commands['master-key.updateCount'] = updateCount;

const prefixArgs = z.object({
    code: z.number(),
    flag: z.string().min(1).optional(),
    // `automated` is used during keybinding preprocessing and is not normally used otherwise
    automated: z.boolean().optional() 
}).strict();

function prefix(args_: unknown){
    let args = validateInput('master-key.prefix', args_, prefixArgs);
    if(args !== undefined){
        state.setKeyContext('prefixCode', args.code);
        state.setKeyContext('prefix', state.values.prefixCodes.nameFor(args.code));
        if(args.flag){
            state.setKeyContext(args.flag, true, true);
        }
    }
}
commands['master-key.prefix'] = prefix;

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

function reset(): void{ state.reset(); }
commands['master-key.reset'] = reset;

commands['master-key.ignore'] = () => undefined;

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let definitions = config.get<object[]>('definitions');
        for(let [k, v] of Object.entries(definitions || {})){ state.setKeyContext(k, v); }
        maxHistory = (config.get<number>('maxCommandHistory') || 65536);
    }
}

// TODO: we're going to have from and to be strings that get evaluated
// to truthy statements
const selectHistoryArgs = z.object({
    range: z.object({
        from: z.string(),
        to: z.string(),
    }).optional(),
    at: z.string().optional(),
    value: runCommandArgs.array().optional(),
    register: z.string().optional(),
}).strict().refine(x => x.at || x.range, ({
    message: "Either `at` or `range` is required."
}));

function evalMatcher(matcher: string, i: number): number {
    let result_ = evalContext.evalStr(matcher, {...state.values, i});
    if(typeof result_ !== 'number'){
        if(result_){ return i; }
        else{ return -1; }
    }else{
        return result_;
    }
}

function selectHistoryCommand(cmd: string, args_: unknown, 
    followup: (seq: RunCommandsArgs[] | undefined) => void){

    let args = validateInput(cmd, args_, selectHistoryArgs);
    if(args){
        let value: RunCommandsArgs[] | undefined = undefined;
        if(args.value){ value = args.value; }
        else{
            // find the range of commands we want to replay
            let history = state.values.commandHistory;
            let from = -1;
            let to = -1;
            let toMatcher = args.range?.to || args.at;
            let fromMatcher = args.range?.from;
            for(let i=history.length-1;i>=0;i--){
                // NOTE: remember that `selectHistoryArgs` cannot leave both `range` and
                // `at` undefined, so at least one of `toMatcher` and `fromMatcher` are not
                // undefined
                if(to < 0 && toMatcher){
                    to = evalMatcher(toMatcher, i);
                    if(args.at){ from = to; }
                } 
                if(from < 0 && fromMatcher){ from = evalMatcher(fromMatcher, i); }
                if(from > 0 && to > 0){ 
                    value = history.slice(from, to+1); 
                    break;
                }
            }
        }
        followup(value);
    }
}
commands['master-key.pushHistoryToStack'] = (args: unknown) => {
    selectHistoryCommand('master-key.pushHistoryToStack', args, (commands) => {
        if(commands){ state.values.macro.push(commands); }
    });
};
commands['master-key.replayFromHistory'] = (args: unknown) => {
    selectHistoryCommand('master-key.replayFromHistory', args, commands => {
        if(commands){ runCommandHistory(commands); }
    });
};

const replayFromStackArgs = z.object({
    index: z.number().min(0).optional().default(0),
    register: z.string().optional()
});
const REPLAY_DELAY = 50;
async function runCommandHistory(commands: RunCommandsArgs[]){
    for(let cmd of commands){
        await runCommands(cmd); 
        // replaying actions too fast messes up selection
        await new Promise(res => setTimeout(res, REPLAY_DELAY));
    }
}
async function replayFromStack(args_: unknown){
    let args = validateInput('master-key.replayFromStack', args_, replayFromStackArgs);
    if(args){
        let commands = state.values.macro[state.values.macro.length-args.index-1];
        if(commands){
            runCommandHistory(commands);
            return;
        }
    }
}
commands['master-key.replayFromStack'] = replayFromStack;

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
    doAfter: strictDoArgs
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
            runCommands({ do: regularizeCommands(args.doAfter) });
        }
    }
}
commands['master-key.restoreNamed'] = restoreNamed;

export function activate(context: vscode.ExtensionContext) {
    modeStatusBar = vscode.window.createStatusBarItem('mode', vscode.StatusBarAlignment.Left);
    modeStatusBar.accessibilityInformation = { label: "Keybinding Mode" };
    modeStatusBar.show();

    countStatusBar = vscode.window.createStatusBarItem('count', vscode.StatusBarAlignment.Left);
    countStatusBar.accessibilityInformation = { label: "Current Repeat Count" };
    countStatusBar.show();

    keyStatusBar = vscode.window.createStatusBarItem('keys', vscode.StatusBarAlignment.Left);
    keyStatusBar.accessibilityInformation = { label: "Keys Typed" };
    keyStatusBar.show();

    searchStatusBar = vscode.window.createStatusBarItem('capture', vscode.StatusBarAlignment.Left);
    searchStatusBar.accessibilityInformation = { label: "Search Text" };
    searchStatusBar.show();

    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

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
