import * as vscode from 'vscode';
import { cloneDeep } from 'lodash';
import { boolean } from 'zod';

// OLD THINGS THAT GOT UPDATED IN `set` THAT MUST GO ELSEWHERE
// - call the command `setContext (in `runCommand` final result)
// - status bar / various other ux changes that happen due to state changes
// - update cursor appearance

export interface ListenerResult{
    states: States,
    close: boolean
}

export type Listener = (states: CommandState) => ListenerResult;

interface State{
    value: unknown,
    resetTo: unknown,
    listeners: Listener[]
}
type States = Record<string, State>;

// TODO: update this and use it for both resolve listeners and nomral listeners
function triggerListeners(listeners: Listener[]){
    listeners = listeners.filter(fn => {
        let result = fn(this);
        this.states = result.states;
        return result.close;
    });

}

export class CommandState{
    private states: States = {};

    constructor(states: States = {}) {
        this.states = states;
    }

    set(key: string, value: unknown, transient: boolean = false){
        let resetTo = undefined;
        if(transient && this.states[key] !== undefined){
            resetTo = this.states[key].value;
        }
        let listeners = this.states[key]?.listeners || [];
        this.states[key] = {value, resetTo, listeners};

        listeners = listeners.filter(fn => {
            let result = fn(this);
            this.states = result.states;
            return result.close;
        });

        this.states[key].listeners = listeners;
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
}

let resolveListeners: Listener[] = [];
function onStateResolves(listener: Listener){
    resolveListeners.push(listener);
}

let state: undefined | Thenable<CommandState> = undefined;
const WRAPPING_STATEFUL = 'wrappingStateful';
export function wrapStateful(fn: (state: CommandState, ...args: any[]) => Promise<CommandState>) {
    return async function (...args: any[]) {
        if (!state) { state = Promise.resolve(new CommandState()); }
        let state_ = await state;
        let globalWrapper = state_.get<boolean>(WRAPPING_STATEFUL, false)
        if(globalWrapper){ state_.set(WRAPPING_STATEFUL, true); }
        state = fn(state_, ...args);
        if(globalWrapper){
            state_ = await state;
            state_.set(WRAPPING_STATEFUL, false);
            resolveListeners = resolveListeners.filter(fn => {
                let result = fn(state_);

            })
        }
        return state_;
    };
}
