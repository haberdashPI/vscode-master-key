import * as vscode from 'vscode';
import { StrictDoArg, strictDoArgs, validModes } from './keybindingParsing';
import { reifyStrings, EvalContext } from './expressions';
import { validateInput } from './utils';
import z from 'zod';
import { clearSearchDecorations, trackSearchUsage, wasSearchUsed } from './searching';

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

// TODO: as a user it is confusing that when clause context scope
// differs from evaluation scope; anything below that requires
// a qualifier in a when clause (e.g. master-key.prefix)
// should also require a qualifier below
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
    firstSelectionOrWord: string
};

const keyContextKey = z.string().regex(/[a-zA-Z_]+[0-9a-zA-Z_]*/);

// TODO: we will need to implement API equivalent flags
// for each 'when' clause context variable we want to use

// TODO: we should make a task to make it possible
// to register new variables here that extensions can hook into

class CommandState {
    values: KeyContext = {
        prefix: '',
        prefixCode: 1,
        count: 0,
        mode: 'insert',
        search: '',
        validModes: ['insert'],
        editorHasSelection: false,
        editorHasMultipleSelections: false,
        editorHasMultiLineSelection: false,
        editorLangId: undefined,
        firstSelectionOrWord: ""
    };
    transientValues: Record<string, any> = {};
    constructor(){ 
        for(let [k, v] of Object.entries(this.values)){
            vscode.commands.executeCommand('setContext', 'master-key.'+k, v);
        }
        updateStatusBar();
    }
    // TODO: have a setKeyContext and setKeyContextForUser to validate those things that
    // aren't from code
    setKeyContext(key: string, value: any){
        // key validation
        validateInput('master-key.set', { key }, z.object({key: keyContextKey}));

        // value validation
        if((<any>keyContext.shape)[key]){
            validateInput('master-key.set', value, (<any>keyContext.shape)[key]);
        }
        if(key === 'mode'){
            if(!this.values.validModes.some(m => m === value)){
                vscode.window.showErrorMessage(`Invalid mode '${value}'`);
            }
        }

        // assignment
        this.values[key] = value;
        vscode.commands.executeCommand('setContext', 'master-key.'+key, value);
        updateStatusBar();
    }
}
export let state = new CommandState();

async function runCommand(command: StrictDoArg){
    if(typeof command === 'string'){
        vscode.commands.executeCommand(command);
    }else{
        let finalArgs: Record<string, any> = command.args || {};
        if(command.computedArgs !== undefined){
            finalArgs = {...finalArgs, 
                        ...reifyStrings(command.computedArgs, str => evalContext.evalStr(str, state.values))};
        }
        await vscode.commands.executeCommand(command.command, finalArgs);
    }
}

const runCommandArgs = z.object({ 
    do: strictDoArgs, 
    resetTransient: z.boolean().default(true) 
}).strict();
type RunCommandsArgs = z.infer<typeof runCommandArgs>;

async function runCommandsCmd(args_: unknown){
    let args = validateInput('master-key.do', args_, runCommandArgs);
    if(args){ return await runCommands(args); }
}
export async function runCommands(args: RunCommandsArgs){
    // run the commands
    trackSearchUsage();
    if (Array.isArray(args.do)) { for (let arg of args.do) { await runCommand(arg); } }
    else { await runCommand(args.do); }

    if(args.resetTransient){ 
        reset(); 
        if(!wasSearchUsed() && vscode.window.activeTextEditor){ 
            clearSearchDecorations(vscode.window.activeTextEditor) ;
        }
    }
    evalContext.reportErrors();
}
commands['master-key.do'] = runCommandsCmd;

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
        if(state.values.prefix.length > 0){
            state.setKeyContext('prefixCode', args.code);
            // TODO: have to do the inverse here... feels messy
            state.setKeyContext('prefix', state.values.prefxCodes[]
        }else{
            state.setKeyContext('prefix', args.key);
        }
        if(args.flag){
            let oldValue = state.values[args.flag];
            state.setKeyContext(args.flag, true);
            state.transientValues[args.flag] = oldValue;
        }
    }
}
commands['master-key.prefix'] = prefix;

// TODO: there needs to be more data validation for the standard state values; only
// arbitrary values should be free to be any value
const setArgs = z.object({
    name: z.string(),
    value: z.any(),
    transient: z.boolean().default(false)
}).strict();
type SetArgs = z.infer<typeof setArgs>;

function setCmd(args_: unknown){
    let args = validateInput('master-key.set', args_, setArgs);
    if(args){ setKeyContext(args); }
}
export function setKeyContext(args: SetArgs){
    let oldValue = state.values[args.name];
    state.setKeyContext(args.name, args.value);
    if(args.transient){ state.transientValues[args.name] = oldValue; }
}
commands['master-key.set'] = setCmd;
commands['master-key.setMode'] = (x) => setKeyContext({name: 'mode', value: 'insert', transient: false});
commands['master-key.enterInsert'] = (x) => setKeyContext({name: 'mode', value: 'insert', transient: false});
commands['master-key.enterNormal'] = (x) => setKeyContext({name: 'mode', value: 'normal', transient: false});

function reset(){
    // clear any relevant state
    state.setKeyContext('count', 0);
    state.setKeyContext('prefix', '');
    for (let [k, v] of Object.entries(state.transientValues)) { state.setKeyContext(k, v); }
    state.transientValues = {};
}
commands['master-key.reset'] = reset;

commands['master-key.ignore'] = () => undefined;

function updateDefinitions(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let definitions = config.get<object[]>('definitions');
        for(let [k, v] of Object.entries(definitions || {})){ state.setKeyContext(k, v); }
    }
}

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

    searchStatusBar = vscode.window.createStatusBarItem('search', vscode.StatusBarAlignment.Left);
    searchStatusBar.accessibilityInformation = { label: "Search Text" };
    searchStatusBar.show();

    updateDefinitions();
    vscode.workspace.onDidChangeConfiguration(updateDefinitions);

    vscode.window.onDidChangeTextEditorSelection(e => {
        let selCount = 0;
        for(let sel of e.selections){
            if(!sel.isEmpty){ selCount += 1; }
            if(selCount > 1){ break; }
        }
        state.values.editorHasSelection = selCount > 0;
        state.values.editorHasMultipleSelections = selCount > 1;
        let doc = e.textEditor.document;
        if(selCount === 0){
            state.values.firstSelectionOrWord = "";
        }else if(e.selections[0].isEmpty){
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
    });

    for (let [name, fn] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }
}
