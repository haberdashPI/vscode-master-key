import * as vscode from 'vscode';
import z from 'zod';
import { cloneDeep, mapValues } from 'lodash';
import { validateInput } from './utils';

// OLD THINGS THAT GOT UPDATED IN `set` THAT MUST GO ELSEWHERE
// - status bar / various other ux changes that happen due to state changes
// - update cursor appearance

export type Listener = (states: CommandState) => Promise<boolean>;

interface State{
    value: unknown,
    resetTo: unknown,
    listeners: Listener[]
}
type States = Record<string, State>;

export class CommandState{
    private states: States = {};
    private resolveListeners: Record<string, Listener> = {};

    async set(key: string, value: unknown, transient: boolean = false){
        let resetTo = undefined;
        if(transient && this.states[key] !== undefined){
            resetTo = this.states[key].value;
        }
        let listeners = this.states[key]?.listeners || [];
        this.states[key] = {value, resetTo, listeners};

        let newListeners: Listener[] = [];
        for(let listener of listeners){
            let keep = await listener(this);
            if(keep){ newListeners.push(listener); }
        }

        this.states[key].listeners = newListeners;
    }

    get<T>(key: string, defaultValue?: T): T | undefined {
        let val = <T>this.states[key]?.value;
        if(val === undefined){
            this.states[key] = {value: cloneDeep(defaultValue), resetTo: defaultValue, listeners: []};
            return defaultValue;
        }
        else{ return val; }
    }

    reset(){
        for(let state of Object.values(this.states)){ state.value = state.resetTo; }
    }

    onSet(key: string, listener: Listener){
        let state = this.states[key];
        if(!state){
            state = {value: undefined, resetTo: undefined, listeners: []};
        }
        state.listeners.push(listener);
        this.states[key] = state;
    }

    onResolve(name: string, listener: Listener){
        this.resolveListeners[name] = listener;
    }
    async resolve(){
        let newListeners: Record<string, Listener> = {};
        for(let [name, fn] of Object.entries(this.resolveListeners)){
            let keep = await fn(this);
            if(keep){ newListeners[name] = fn; }
        }

        this.resolveListeners = newListeners;
        for(let [key, state] of Object.entries(this.states)){
            vscode.commands.executeCommand('setContext', 'master-key.'+key, state.value);
        }
    }

    evalContext(extra: object = {}){
        return { ...mapValues(this.states, val => val.value), extra };
    }
}

let state: Thenable<CommandState> = Promise.resolve(new CommandState());
const NESTED_CALL = 'nestedCall';

const WRAPPED_UUID = "28509bd6-8bde-4eef-8406-afd31ad11b43";
export type WrappedCommandResult = {
    id: "28509bd6-8bde-4eef-8406-afd31ad11b43",
    args?: object | "cancel"
    state: CommandState
};
export function commandArgs(x: unknown): undefined | object | "cancel" {
    if((<any>x)?.id === WRAPPED_UUID){
        return (<WrappedCommandResult>x).args;
    }
}
export function commandState(x: unknown): undefined | CommandState {
    if((<any>x)?.id === WRAPPED_UUID){
        return (<WrappedCommandResult>x).state;
    }
}

export async function onResolve(key: string, listener: Listener){
    let state_;
    state_ = await state;
    state_.onResolve(key, listener);
    state = Promise.resolve(state_);
}

export async function setState<T>(str: string, def: T, transient: boolean, fn: (x: T) => T){
    let state_;
    state_ = await state;
    state_.set(str, fn(state_.get<T>(str, def)!), transient);
    state = Promise.resolve(state_);
}

export type CommandResult = [object | undefined | "cancel", CommandState];
type CommandFn = (state: CommandState, ...args: any[]) => Promise<CommandResult>;
export function wrapStateful(fn: CommandFn) {
    return async function (...args: any[]): Promise<WrappedCommandResult> {
        let state_;
        let passArgs;
        if(args[0] instanceof CommandState){
            state_ = args[0];
            passArgs = args.slice(1);
        }else{
            state_ = await state;
            passArgs = args;
        }

        let nestedCall = state_.get<boolean>(NESTED_CALL, false);
        if(!nestedCall){ state_.set(NESTED_CALL, true); }

        let rargs;
        [rargs, state_] = await fn(state_, ...args);

        if(!nestedCall){
            state_ = await state;
            state_.resolve();
            state_.set(NESTED_CALL, false);
            state_.reset();
        }
        state = Promise.resolve(state_);
        return { id: WRAPPED_UUID, args: rargs, state: state_ };
    };
}

async function addDefinitions(state: Thenable<CommandState> | undefined, definitions: any){
    let state_ = state ? await state : new CommandState();

    for(let [k, v] of Object.entries(definitions || {})){
        state_.set(k, v);
    }
    return state_;
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if(!event || event?.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let definitions = config.get<object[]>('definitions');
        state = addDefinitions(state, definitions);
    }
}

const setFlagArgs = z.object({
    name: z.string().endsWith('_on'),
    value: z.boolean(),
    transient: z.boolean().default(false).optional()
}).strict();
type SetFlagArgs = z.infer<typeof setFlagArgs>;

async function setFlag(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.setFlag', args_, setFlagArgs);
    if(args){ state.set(args.name, args.value, args.transient || false); }
    return [undefined, state];
}

export function activate(context: vscode.ExtensionContext){
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setFlag',
        wrapStateful(setFlag)));

    vscode.window.onDidChangeTextEditorSelection(async e => {
        let selCount = 0;
        for(let sel of e.selections){
            if(!sel.isEmpty){ selCount += 1; }
            if(selCount > 1){ break; }
        }
        let state_ = await state;
        state_.set('editorHasSelection', selCount > 0);
        state_.set('editorHasMultipleSelections', selCount > 1);
        let doc = e.textEditor.document;

        let firstSelectionOrWord;
        if(e.selections[0].isEmpty){
            let wordRange = doc.getWordRangeAtPosition(e.selections[0].start);
            firstSelectionOrWord = doc.getText(wordRange);
        }else{
            firstSelectionOrWord = doc.getText(e.selections[0]);
        }
        state_.set('firstSelectionOrWord', firstSelectionOrWord);
        vscode.commands.executeCommand('setContext', 'master-key.firstSelectionOrWord',
            firstSelectionOrWord);
    });

    vscode.window.onDidChangeActiveTextEditor(e => {
        setState('editorLangId', '', false, val => e?.document?.languageId || '');
    });
}
