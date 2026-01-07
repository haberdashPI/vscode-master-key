import * as vscode from 'vscode';
import z from 'zod';
import { defineState as defineExtensionState } from './index';
import { validateInput } from './utils';
import { bindings, onSetBindings } from './keybindings/config';
import { ParseError } from '../rust/parsing/lib/parsing';
import { cloneDeep } from 'lodash';

// A listener triggered when a value is set
export type SetListener = (value: unknown) => boolean;
// A listener triggered when `resolve` is called, at the completion/cancelation of a
// sequence of commands for a single keybinding (see `do.ts` and `prefix.ts`)
export type ResolveListener = () => boolean;

interface IStateOptions {
    transient?: { reset: unknown }; // does the state reset once a complete keybinding has been pressed
    private?: boolean; // is the state visible to when clauses?
}

interface ISetOptions {
    namespace?: string; // determines parent object in an expression: one of `key.`, `code.` or `val.`
    // private property used only in this file
    // that prevents `bidnings.set_value` from being called
    // (used for `val.` fields, which have already been set)
    __dont_update_bindings__?: boolean;
}

export class CommandState {
    // record key: `namespace:variable-name`
    private options: Record<string, IStateOptions> = {};
    // record key: a unique string specific to the listener
    private resolveListeners: Record<string, ResolveListener> = {};
    // record key: `namespace:variable-name`
    private setListeners: Record<string, Array<SetListener>> = {};
    private definedValues: Set<string> = new Set();
    // a queue of values to set. When bootstrapping the initial setup of keybinding state,
    // we need to wait before actually setting values until `resolve` is called
    private onSetQueued: Record<string, unknown[]> | undefined;

    clear() {
        this.definedValues.clear();
        this.options = {};
        // when we clear variables, we only want to trigger onSet values when resolve is
        // called, because not all variables will be defined until we've run all
        // `defineState` functions
        this.onSetQueued = {};
    }

    // define that a value exists in `state`; should only be called from `defineState`
    define<T>(
        key: string,
        initialValue: T,
        opt: IStateOptions = {},
        setOpt: ISetOptions = {},
    ) {
        const fullKey = (setOpt.namespace || 'key') + '.' + key;
        if (this.definedValues.has(fullKey)) {
            throw Error(`${fullKey} already exists`);
        }
        if (key.includes('.')) {
            throw Error('Variables names can\'t include `.`');
        }
        this.definedValues.add(fullKey);
        this.options[fullKey] = opt;
        this.set(key, initialValue, setOpt);
    }

    // gets a value defined in the state, must be `define`ed
    get<T>(key: string, opt: ISetOptions = {}): T | undefined {
        const namespace = opt.namespace || 'key';
        const fullKey = namespace + '.' + key;
        if (!this.definedValues.has(fullKey)) {
            throw Error(`\`${fullKey}\` is not defined`);
        }
        try {
            const result = bindings.get_value(namespace, key);
            if (Object.keys(result).length === 0 && result.constructor === Object) {
                return undefined;
            }
            return result;
        } catch (e) {
            if ((<ParseError>e).report_string) {
                const msg = (<ParseError>e).report_string();
                vscode.window.showErrorMessage(
                    `While getting \`${namespace}.${key}\` ${msg}.`,
                );
            } else {
                throw e;
            }
            return undefined;
        }
    }

    // sets the value, triggering all set listeners, must be `define`ed
    set<T>(key: string, val: T, opt: ISetOptions = {}) {
        const namespace = opt.namespace || 'key';
        const fullKey = namespace + '.' + key;
        if (!this.definedValues.has(fullKey)) {
            throw Error(`\`${fullKey}\` is not defined`);
        }

        // if we have a queue set up, don't trigger listeners right away
        if (this.onSetQueued) {
            let queue: unknown[] = [];
            if (this.onSetQueued[fullKey]) {
                queue = this.onSetQueued[fullKey];
            }
            queue.push(cloneDeep(val));
            this.onSetQueued[fullKey] = queue;
            return;
        }

        if (this.get(key, opt) !== val) {
            try {
                if (!opt.__dont_update_bindings__) {
                    bindings.set_value(namespace, key, val);
                }
            } catch (e) {
                if ((<ParseError>e).report_string) {
                    const msg = (<ParseError>e).report_string();
                    vscode.window.showErrorMessage(
                        `While setting \`${namespace}.${key}\` ${msg}.
                        Value to assign:\n${JSON.stringify(val, null, 4)}.`,
                    );
                } else {
                    throw e;
                }
            }
            if (!this.options[fullKey].private) {
                if (namespace === 'val') {
                    vscode.commands.executeCommand(
                        'setContext',
                        'master-key.val.' + key,
                        val,
                    );
                } else if (namespace === 'key') {
                    vscode.commands.executeCommand(
                        'setContext',
                        'master-key.' + key,
                        val,
                    );
                } else {
                    throw Error(
                        'All public state must exist in the \`key\` or \`val\` ' +
                        'namespace.',
                    );
                }
            }
            const listeners = this.setListeners[fullKey] || [];
            this.setListeners[fullKey] = listeners.filter(listener => listener(val));
        }
    }

    // returns all transient values back to their default value (see IStateOptions)
    reset() {
        for (const fullKey of this.definedValues.keys()) {
            const transient = this.options[fullKey]?.transient;
            // key is guaranteed to not include `.`
            const [namespace, key] = fullKey.split('.');
            const value = this.get(key, { namespace });
            if (transient && transient.reset !== value) {
                this.set(key, transient.reset, { namespace });
            }
        }
    }

    // add a `set` listener
    onSet(key: string, listener: SetListener, opt: ISetOptions = {}) {
        const fullKey = (opt.namespace || 'key') + '.' + key;
        if (!this.setListeners[fullKey]) {
            this.setListeners[fullKey] = [];
        }
        this.setListeners[fullKey].push(listener);
    }

    // add a `resolve` listener
    onResolve(resolveId: string, listener: ResolveListener) {
        this.resolveListeners[resolveId] = listener;
    }

    // called at the completion of a key sequence (see `do.ts` and `prefix.ts`)
    resolve() {
        // if we have a set of queued value updates, trigger those as well
        const queued = this.onSetQueued;
        this.onSetQueued = undefined;
        for (const [fullKey, vals] of Object.entries(queued || {})) {
            for (const val of vals) {
                const [namespace, key] = fullKey.split('.', 2);
                this.set(key, val, { namespace });
            }
        }
        const listenerResult = Object.entries(this.resolveListeners).
            map(([k, f]) => [k, f, f()]);
        this.resolveListeners = Object.fromEntries(
            listenerResult.
                filter(([_k, _f, keep]) => keep).
                map(([k, f, _keep]) => [k, f]),
        );
    }
}

export const state: CommandState = new CommandState();

// TODO: remove these two functions
export function onResolve(resolveId: string, listener: ResolveListener) {
    state.onResolve(resolveId, listener);
}

export function onSet(name: string, listener: SetListener) {
    state.onSet(name, listener);
}

// PROBLEM: we want to our commands to return any user-entered data so that this can be
// stored as part of the history of the command
//
// SOLUTION: we return this value when `do` calls `vscode.commands.executeCommand`. Since
// `master-key.do` can run any command we could receive any arbitrary data from other
// extensions when reading the return value of `executeCommand`, we therefor use a unique
// tag when reading the result of a command.
//
// TODO: move this code to another file; it is unrelated and is really a pun on the word
// "state"
const WRAPPED_UUID = '28509bd6-8bde-4eef-8406-afd31ad11b43';
export type WrappedCommandResult = {
    id: '28509bd6-8bde-4eef-8406-afd31ad11b43';
    args?: object | 'cancel';
};
// extract the arguments returned by our command
export function commandArgs(x: unknown): undefined | object | 'cancel' {
    if ((<WrappedCommandResult>x)?.id === WRAPPED_UUID) {
        return (<WrappedCommandResult>x).args;
    } else {
        return undefined;
    }
}

// wrap a function so that it properly returns the `WrappedCommandResult` object above
export type CommandResult = object | undefined | 'cancel';
type CommandFn<T extends Array<E>, E> = (...args: T) => Promise<CommandResult>;
export function recordedCommand<T extends Array<E>, E>(fn: CommandFn<T, E>) {
    return async function (...args: T): Promise<WrappedCommandResult | undefined> {
        const rargs: CommandResult = await fn(...args);
        return { id: WRAPPED_UUID, args: rargs };
    };
}

const setFlagArgs = z.
    object({
        name: z.string(),
        value: z.any(),
    }).
    strict();

/**
 * @command setValue
 * @order 101
 * @section State Management
 *
 * Sets a value named `name` that can be accessed in [expressions](/expressions/index)
 * using `val.[name]`. The value must be defined in a `[[define.val]]` block
 * or an error occurs.
 *
 * **Arguments**:
 * - `name`: The name of the variable
 * - `value`: any valid json value
 */
async function setValue(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.setValue', args_, setFlagArgs);
    if (args) {
        state.set(args.name, args.value, { namespace: 'val' });
    }
    return;
}

// `code.` variables are read-only values that expressions can inspect to know something
// about the current editor state
function updateCodeVariables(
    e: { textEditor?: vscode.TextEditor;
        selections?: readonly vscode.Selection[]; },
) {
    const doc = e.textEditor?.document;
    let selCount = 0;
    if (e.selections) {
        for (const sel of e.selections) {
            if (!sel.isEmpty) {
                selCount += 1;
            }
            if (selCount > 1) {
                break;
            }
        }
    }

    let firstSelectionOrWord: string;
    if (doc && e.selections && e.selections[0].isEmpty) {
        const wordRange = doc.getWordRangeAtPosition(e.selections[0].start);
        if (wordRange) {
            firstSelectionOrWord = doc.getText(wordRange);
        } else {
            firstSelectionOrWord = '';
        }
    } else if (doc && e.selections) {
        firstSelectionOrWord = doc.getText(e.selections[0]);
    } else {
        firstSelectionOrWord = '';
    }

    let editorLangId: string | undefined = '';
    if (doc) {
        editorLangId = e?.textEditor?.document?.languageId;
    }
    const opt = { namespace: 'code' };
    state.set('editorHasSelection', selCount > 0, opt);
    state.set('editorHasMultipleSelections', selCount > 1, opt);
    state.set('editorLangId', editorLangId || '', opt);
    state.set('firstSelectionOrWord', firstSelectionOrWord, opt);
}

export function defineState() {
    state.define(
        'editorHasSelection',
        false,
        { private: true },
        { namespace: 'code' },
    );
    state.define(
        'editorHasMultipleSelections',
        false,
        { private: true },
        { namespace: 'code' },
    );
    state.define(
        'editorLangId',
        '',
        { private: true },
        { namespace: 'code' },
    );
    state.define(
        'firstSelectionOrWord',
        '',
        { private: true },
        { namespace: 'code' },
    );

    if (bindings) {
        for (const val of bindings.get_defined_vals()) {
            state.define(
                val,
                bindings.get_value('val', val),
                {},
                { namespace: 'val', __dont_update_bindings__: false },
            );
        }
    }
}

export async function activate(_context: vscode.ExtensionContext) {
    onSetBindings(async (_bindings) => {
        // redefine all state so it is newly set in the updated, global `bindings` variable
        state.clear();
        defineExtensionState();
        state.resolve();
    });

    onSetBindings(async () => updateCodeVariables({
        textEditor: vscode.window.activeTextEditor,
    }));

    updateCodeVariables({ textEditor: vscode.window.activeTextEditor });
    vscode.window.onDidChangeTextEditorSelection(updateCodeVariables);
    vscode.window.onDidChangeActiveTextEditor(e => updateCodeVariables({ textEditor: e }));
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setValue', recordedCommand(setValue)),
    );
}
