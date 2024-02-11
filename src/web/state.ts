import * as vscode from 'vscode';
import z from 'zod';
import { cloneDeep, mapValues } from 'lodash';
import { pickBy } from 'lodash';
import { validateInput } from './utils';
import { RunCommandsArgs } from './commands/do';
import { DoArgs } from './keybindingParsing';

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
        let val = <T>this.states[key].value;
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

    async evalContext(extra: object = {}){
        return { ...mapValues(this.states, val => val.value), extra };
    }
}

let state: undefined | Thenable<CommandState> = undefined;
const WRAPPING_STATEFUL = 'wrappingStateful';

const WRAPPED_UUID = "28509bd6-8bde-4eef-8406-afd31ad11b43";
export type WrappedCommandResult = { id: "28509bd6-8bde-4eef-8406-afd31ad11b43", args?: object | "cancel" };
export function commandArgs(x: unknown): undefined | object | "cancel" {
    if((<any>x)?.id === WRAPPED_UUID){
        return (<WrappedCommandResult>x).args;
    }
}

export async function onResolve(key: string, listener: Listener){
    let state_;
    if(!state){
        state = Promise.resolve(new CommandState());
    }
    state_ = await state;
    state_.onResolve(key, listener);
    state = Promise.resolve(state_);
}

export type CommandResult = [object | undefined | "cancel", CommandState];
type CommandFn = (state: CommandState, ...args: any[]) => Promise<CommandResult>;
export function wrapStateful(fn: CommandFn) {
    return async function (...args: any[]): Promise<WrappedCommandResult> {
        if (!state) { state = Promise.resolve(new CommandState()); }
        let state_ = await state;

        let globalWrapper = state_.get<boolean>(WRAPPING_STATEFUL, false);
        if(globalWrapper){ state_.set(WRAPPING_STATEFUL, true); }

        let rargs;
        [rargs, state_] = await fn(state_, ...args);

        if(globalWrapper){
            state_ = await state;
            state_.resolve();
            state_.set(WRAPPING_STATEFUL, false);
            state_.reset();
        }
        return { id: WRAPPED_UUID, args: rargs };
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
    name: z.string(),
    value: z.boolean(),
    transient: z.boolean().default(false).optional()
}).strict();
type SetFlagArgs = z.infer<typeof setFlagArgs>;

async function setFlag(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.set', args_, setFlagArgs);
    if(args){ state.set(args.name, args.value, args.transient || false); }
    return [undefined, state];
}

export function activate(context: vscode.ExtensionContext){
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setFlag',
        wrapStateful(setFlag)));

    // TODO: how to properly handle events like this, where we don't have ready
    // access to the state...
    // (maybe we need a different concept for what are essentially read only values
    // in the state, update by these event handlers)
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
    });
}
