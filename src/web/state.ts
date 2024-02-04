import * as vscode from 'vscode';
import { cloneDeep, mapValues } from 'lodash';
import { boolean } from 'zod';
import { pickBy } from 'lodash';

// OLD THINGS THAT GOT UPDATED IN `set` THAT MUST GO ELSEWHERE
// - call the command `setContext (in `runCommand` final result)
// - status bar / various other ux changes that happen due to state changes
// - update cursor appearance

export type Listener = (states: CommandState) => boolean;

interface State{
    value: unknown,
    resetTo: unknown,
    listeners: Listener[]
}
type States = Record<string, State>;

export class CommandState{
    private states: States = {};
    private resolveListeners: Record<string, Listener> = {};

    set(key: string, value: unknown, transient: boolean = false){
        let resetTo = undefined;
        if(transient && this.states[key] !== undefined){
            resetTo = this.states[key].value;
        }
        let listeners = this.states[key]?.listeners || [];
        this.states[key] = {value, resetTo, listeners};

        listeners = listeners.filter(fn => fn(this));
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

    onResolve(name: string, listener: Listener){
        this.resolveListeners[name] = listener;
    }
    resolve(){ this.resolveListeners = pickBy(this.resolveListeners, fn => fn(this)); }
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
