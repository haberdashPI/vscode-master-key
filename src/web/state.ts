import * as vscode from 'vscode';
import { Map, List } from 'immutable';
import { boolean } from 'zod';

// OLD THINGS THAT GOT UPDATED IN `set` THAT MUST GO ELSEWHERE
// - call the command `setContext (in `runCommand` final result)
// - status bar / various other ux changes that happen due to state changes
// - update cursor appearance

interface ListenerResult{
    state: Map<string, unknown>
    close: boolean
}

type Listener = (state: State) => ListenerResult;
type State = Map<string, unknown>;

class CommandState{
    private state: State = Map();
    private transient: State = Map();
    private listeners: Map<string, List<Listener>> = Map();

    constructor(state: State = Map(), transient: State = Map(),
        listeners = Map<string, List<Listener>>()) {

        this.state = state;
        this.transient = transient;
        this.listeners = listeners;
    }

    set(key: string, value: unknown, transient: boolean = false){
        let newTransient = this.transient;
        if(transient && this.transient.get(key) !== undefined){
            newTransient = this.transient.set(key, this.state.get(key));
        }

        let newState = this.state.set(key, value);
        let newListeners = this.listeners;
        let keyListeners = this.listeners.get(key);
        if(keyListeners){
            let newKeyListeners = keyListeners.filter(fn => {
                let result = fn(newState);
                newState = result.state;
                return result.close;
            });
            newListeners = this.listeners.set(key, newKeyListeners);
        }
        return new CommandState(newState, newTransient, newListeners);
    }
    get(key: string){ return this.state.get(key); }
}
