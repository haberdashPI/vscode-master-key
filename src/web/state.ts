import * as vscode from 'vscode';
import z from 'zod';
import { cloneDeep, mapValues } from 'lodash';
import { pickBy } from 'lodash';
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
        let val = <T>this.states[key].value;
        if(val === undefined){
            this.states[key] = {value: cloneDeep(defaultValue), resetTo: defaultValue, listeners: []};
            return defaultValue;
        }
        else{ return val; }
    }

    reset(){ this.states = {}; }

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

export function wrapStateful(fn: (state: CommandState, ...args: any[]) => Promise<CommandState>) {
    return async function (...args: any[]) {
        if (!state) { state = Promise.resolve(new CommandState()); }
        let state_ = await state;

        let globalWrapper = state_.get<boolean>(WRAPPING_STATEFUL, false);
        if(globalWrapper){ state_.set(WRAPPING_STATEFUL, true); }

        state = fn(state_, ...args);

        if(globalWrapper){
            state_ = await state;
            state_.set(WRAPPING_STATEFUL, false);
            state_.resolve();
        }
        return state_;
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

async function setFlag(state: CommandState, args_: unknown){
    let args = validateInput('master-key.set', args_, setFlagArgs);
    if(args){ state.set(args.name, args.value, args.transient || false); }
    return state;
}

export function activate(context: vscode.ExtensionContext){
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setFlag',
        wrapStateful(setFlag)));
}
