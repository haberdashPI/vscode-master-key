import * as vscode from 'vscode';
import z from 'zod';
import { defineState as defineExtensionState } from './index';
import { validateInput } from './utils';
import { bindings, onChangeBindings } from './keybindings/config';
import { ParseError } from '../rust/parsing/lib/parsing';
import { cloneDeep } from 'lodash';
export type Listener = (value: unknown) => boolean;
export type ResolveListener = () => boolean;

interface IStateOptions {
    transient?: { reset: unknown };
    private?: boolean;
}

interface ISetOptions {
    namespace?: string;
    // private property used only in this file
    // that prevents `bidnings.set_value` from being called
    // (used for `val` fields that have already been set)
    __dont_update_bindings__?: boolean;
}

export class CommandState {
    private options: Record<string, IStateOptions> = {};
    private resolveListeners: Record<string, ResolveListener> = {};
    private setListeners: Record<string, Array<Listener>> = {};
    private defined: Set<string> = new Set();
    private onSetQueued: Record<string, unknown[]> | undefined;

    clear() {
        this.defined.clear();
        this.options = {};
        // when we clear variables, we only want to trigger onSet values when resolve is
        // called, because not all variables will be defined until we've run all
        // `defineState` functions
        this.onSetQueued = {};
    }

    define<T>(
        key: string,
        initialValue: T,
        opt: IStateOptions = {},
        setOpt: ISetOptions = {},
    ) {
        const fullKey = (setOpt.namespace || 'key') + '.' + key;
        if (this.defined.has(fullKey)) {
            throw Error(`${fullKey} already exists`);
        }
        if (key.includes('.')) {
            throw Error('Variables names can\'t include `.`');
        }
        this.defined.add(fullKey);
        this.options[fullKey] = opt;
        this.set(key, initialValue, setOpt);
    }

    get<T>(key: string, opt: ISetOptions = {}): T | undefined {
        const namespace = opt.namespace || 'key';
        const fullKey = namespace + '.' + key;
        if (!this.defined.has(fullKey)) {
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

    set<T>(key: string, val: T, opt: ISetOptions = {}) {
        const namespace = opt.namespace || 'key';
        const fullKey = namespace + '.' + key;
        if (!this.defined.has(fullKey)) {
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
            const listeners = this.setListeners[fullKey] || [];
            this.setListeners[fullKey] = listeners.filter(listener => listener(val));

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
        }
    }

    reset() {
        for (const fullKey of this.defined.keys()) {
            const transient = this.options[fullKey]?.transient;
            // key is guaranteed to not include `.`
            const [namespace, key] = fullKey.split('.');
            const value = this.get(key, { namespace });
            if (transient && transient.reset !== value) {
                this.set(key, transient.reset, { namespace });
            }
        }
    }

    onSet(key: string, listener: Listener, opt: ISetOptions = {}) {
        const fullKey = (opt.namespace || 'key') + '.' + key;
        if (!this.setListeners[fullKey]) {
            this.setListeners[fullKey] = [];
        }
        this.setListeners[fullKey].push(listener);
    }

    onResolve(resolveId: string, listener: ResolveListener) {
        this.resolveListeners[resolveId] = listener;
    }

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

export function onResolve(resolveId: string, listener: ResolveListener) {
    state.onResolve(resolveId, listener);
}

export function onSet(name: string, listener: Listener) {
    state.onSet(name, listener);
}

const WRAPPED_UUID = '28509bd6-8bde-4eef-8406-afd31ad11b43';
export type WrappedCommandResult = {
    id: '28509bd6-8bde-4eef-8406-afd31ad11b43';
    args?: object | 'cancel';
};
export function commandArgs(x: unknown): undefined | object | 'cancel' {
    if ((<WrappedCommandResult>x)?.id === WRAPPED_UUID) {
        return (<WrappedCommandResult>x).args;
    } else {
        return undefined;
    }
}

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
    onChangeBindings(async (_bindings) => {
        state.clear();
        defineExtensionState();
        state.resolve();
    });

    // TODO: what else do we need to update in the state when the bindings change??
    // TODO: I think we at least need to review any default state we might want to
    // reset
    onChangeBindings(async () => updateCodeVariables({
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
