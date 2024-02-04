import * as vscode from 'vscode';
import { cloneDeep } from 'lodash';

// OLD THINGS THAT GOT UPDATED IN `set` THAT MUST GO ELSEWHERE
// - call the command `setContext (in `runCommand` final result)
// - status bar / various other ux changes that happen due to state changes
// - update cursor appearance

export interface ListenerResult{
    states: States,
    close: boolean
}

export type Listener = (states: States) => ListenerResult;

interface State{
    value: unknown,
    resetTo: unknown,
    listeners: Listener[]
}
type States = Record<string, State>;

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
            let result = fn(this.states);
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
}
