import * as vscode from 'vscode';
import { StrictDoArg, strictDoArgs, validModes, strictBindingCommand, StrictBindingCommand } from './keybindingParsing';
import { PrefixCodes } from './keybindingProcessing';
import { reifyStrings, EvalContext } from './expressions';
import { validateInput } from './utils';
import z from 'zod';
import { clearSearchDecorations, trackSearchUsage, wasSearchUsed } from './searching';
import { match } from 'assert';

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
    prefixCodes: PrefixCodes
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
        firstSelectionOrWord: ""
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


async function runCommand(command: StrictDoArg){
    if(typeof command === 'string'){
        await vscode.commands.executeCommand(command);
    }else{
        if(command.if){
            if(!evalContext.evalStr(command.if, state.values)){
                return; // if the if check fails, don't run the command
            }
        }
        let reifyArgs: Record<string, any> = command.args || {};
        if(command.computedArgs !== undefined){
            reifyArgs = {...reifyArgs, 
                        ...reifyStrings(command.computedArgs, str => evalContext.evalStr(str, state.values))};
        }
        await vscode.commands.executeCommand(command.command, reifyArgs);
    }
}

const runCommandArgs = z.object({ 
    do: strictDoArgs, 
    resetTransient: z.boolean().default(true),
    kind: z.string(),
    path: z.string(),
}).strict();
type RunCommandsArgs = z.infer<typeof runCommandArgs>;

let argsUpdated = false;
async function runCommandsCmd(args_: unknown){
    argsUpdated = false;
    let args = validateInput('master-key.do', args_, runCommandArgs);
    if(args){ 
        commandHistory.push(args);
        await runCommands(args); 
    }
}

export function updateArgs(args: { [i: string]: unknown } | "CANCEL"){
    if(argsUpdated){
        vscode.window.showErrorMessage(`You cannot have more than one command that captures 
            input in a single 'master-key.do' block`);
    }else if(args === "CANCEL"){
        commandHistory.pop();
    }else{
        argsUpdated = true;
        let doCmd = commandHistory[commandHistory.length-1];
        if(Array.isArray(doCmd.do)){
            for(let i=0; i<doCmd.do.length; i++){
                doCmd.do[i] = updatedArgsFor(doCmd.do[i], args);
            }
        }else{
            doCmd.do = updatedArgsFor(doCmd.do, args);
        }
        commandHistory[commandHistory.length-1] = doCmd;
    }
}

const INPUT_CAPTURE_COMMANDS = ['captureKeys', 'replaceChar', 'insertChar', 'search'];

function updatedArgsFor(doArg: StrictDoArg, updatedArgs: { [i: string]: unknown }): StrictDoArg {
    let cmdName = typeof doArg === 'string' ? doArg : doArg.command;
    if(INPUT_CAPTURE_COMMANDS.some(c => `master-key.${c}` === cmdName)){
        if(typeof doArg === 'string'){
            return { command: doArg, args: updatedArgs };
        }else{
            return { ...doArg, args: updatedArgs };
        }
    }
    return doArg;
}

let commandHistory: RunCommandsArgs[] = [];

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

function updateDefinitions(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let definitions = config.get<object[]>('definitions');
        for(let [k, v] of Object.entries(definitions || {})){ state.setKeyContext(k, v); }
    }
}

const commandMatcher = z.object({
    command: z.string().or(z.object({regex: z.string()}).strict()).optional(),
    args: z.object({}).passthrough().optional(),
    kind: z.string().optional(),
    path: z.string().optional(), // TODO: need to store this in config or something
    inclusive: z.boolean().default(true)
});
type CommandMatcher = z.infer<typeof commandMatcher>;

function matcherToZod(matcher: CommandMatcher){
    let result = z.object({});
    if(matcher.command){
        if(typeof matcher.command === 'string'){
            let strmatch = z.object({ 
                command: z.literal(matcher.command)
            }).or(z.literal(matcher.command))
            result = result.extend({
                do: strmatch.or(z.array(z.string().or(z.object({command: z.string()}))).refine(xs => {
                    return xs.some(x => {
                        if(typeof x === 'string'){ x === matcher.command }
                        else{ x.command === matcher.command }
                    });
                }))
            })
        }else{
            result = result.extend({
                command: z.string().regex(RegExp(matcher.command.regex))
            });
        }
    }
    if(matcher.args){

    }
}

const repeatArgs = z.object({
    from: commandMatcher.optional(),
    to: commandMatcher.optional(),
    register: z.string().default("default")
});

let recordedCommands: Record<string, RunCommandsArgs[]> = {};
async function repeat(args_: unknown){
    let args = validateInput('master-key.repeat', args_, repeatArgs);
    if(args){
        if(!args.from && !args.to){
            for(let cmd of recordedCommands[args.register]){
                await runCommands(cmd);
            }
        }
        let from = -1;
        let to = -1;
        for(let i=commandHistory.length-1;i>=0;i--){
            if(to < 0 && commandMatches(args.to, commandHistory[i])){
                to = i;
            } else if(from < 0 && commandMatches(args.to, commandHistory[i])){
                from = i;
            }
        }
    }
}

function doMatches(matcherTest: (x: string) => boolean, cmd: StrictDoArg){
    if(typeof cmd === 'string'){
        if(!matcherTest(cmd)){ return false; }
    }
    else{
        if(!matcherTest(cmd.command)){ return false; }
    }
}

function argMatches(matcher)

function commandMatches(matcher_: CommandMatcher | undefined, args: RunCommandsArgs){
    if(matcher_ === undefined){ return true; }
    let matcher = <CommandMatcher>matcher_;

    if(matcher.command){
        let matcherTest; 
        if(typeof matcher.command === 'string'){
            matcherTest = (x: string) => x === matcher.command 
        }else if(matcher.command){
            let r = RegExp(matcher.command.regex);
            matcherTest = (x: string) => r.test(x);
        }else{
            matcherTest = undefined;
        }
        if(matcherTest){
            if(!Array.isArray(args.do)){
                if(!doMatches(matcherTest, args.do)){ return false; }
            }else{
                for(let cmd of args.do){
                    if(!doMatches(matcherTest, cmd)){ return false; }
                }
            }
        }
    }
    if(matcher.args){
        if(!Array.isArray(args.do)){
            argMatches()
        }else{

        }
        && !argsMatch(matcher.args, args.do.args || {})){
    } 
        return false;
    }
    if(matcher.kind && matcher.kind !== args.kind){
        return false;
    }
    if(matcher.path && !args.path.startsWith(matcher.path)){
        return false;
    }
}

function argsMatch(matcher: unknown, obj: unknown){
    if(matcher === undefined){ return true; }
    if(obj === undefined){ return false; }
    if(matcher === obj){ return true; }
    if(Array.isArray(matcher)){
        if(!Array.isArray(obj)){ return false; }
        else if(matcher.length !== obj.length){ return false; }
        else{
            for(let i=0;i<matcher.length;i++){
                if(!argsMatch(matcher[i], obj[i])){ return false; }
            }
        }
        return true;
    }
    if(typeof matcher === 'object'){
        if(typeof obj !== 'object'){ return false; }
        else{
            for(let [key, value] of Object.entries(matcher || {})){
                if(!argsMatch(value, (<any>obj)[key])){ return false; }
            }
        }
        return true;
    }
    return false;
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

    searchStatusBar = vscode.window.createStatusBarItem('capture', vscode.StatusBarAlignment.Left);
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
