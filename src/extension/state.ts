import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from './utils';
import { Map, List, RecordOf, Record as IRecord } from 'immutable';
import { onChangeBindings } from './keybindings/config';
import { Bindings } from './keybindings/processing';

export type Listener = (states: Map<string, unknown>) => boolean;

interface IStateOptions {
    transient?: { reset: unknown };
    listeners: List<Listener>;
    public: boolean;
}

const StateOptions = IRecord<IStateOptions>({
    transient: undefined,
    listeners: List<Listener>(),
    public: false,
});
type RStateOptions = RecordOf<IStateOptions>;

interface ISetOptions {
    transient?: { reset: unknown };
    public?: boolean;
}

interface ICommandState {
    options: Map<string, RStateOptions>;
    resolveListeners: Map<string, Listener>;
    values: Map<string, unknown>;
}

const CommandStateFactory = IRecord({
    options: Map<string, RStateOptions>(),
    resolveListeners: Map<string, Listener>(),
    values: Map<string, unknown>(),
});
type RCommandState = RecordOf<ICommandState>;

export class CommandState {
    private record: RCommandState;
    constructor(record: RCommandState = CommandStateFactory()) {
        this.record = record;
    }

    withMutations(fn: (x: CommandState) => void) {
        const rec = this.record.withMutations((rec) => {
            rec.update('values', v => v.asMutable());
            fn(new CommandState(rec));
            rec.update('values', v => v.asImmutable());
        });
        return new CommandState(rec);
    }

    set<T>(key: string, opt: ISetOptions, val: T): CommandState;
    set<T>(key: string, val: T): CommandState;
    set<T>(key: string, optOrVal: ISetOptions | T, val_?: T) {
        let opt: ISetOptions;
        let val: T;
        if (arguments.length === 2) {
            opt = {};
            val = <T>optOrVal;
        } else {
            opt = <ISetOptions>optOrVal;
            val = <T>val_;
        }

        if (this.record.values.get(key) !== val) {
            const values = this.record.values.set(key, val);
            return this.setHelper_(key, opt, values);
        } else {
            return this;
        }
    }

    private setHelper_(key: string, opt: ISetOptions, values: Map<string, unknown>) {
        let listeners = this.record.options.get(key, StateOptions()).listeners;
        listeners = listeners.filter(listener => listener(values));

        const options = this.record.options.set(
            key,
            StateOptions({
                transient: opt.transient,
                listeners,
                public: opt.public,
            }),
        );

        const resolveListeners = this.record.resolveListeners;
        // NOTE: we set `record` in this way so that `update` can be used
        // both inside and outside of `withMutations`;
        const record = this.record.
            set('options', options).
            set('resolveListeners', resolveListeners).
            set('values', values);
        if (record.wasAltered()) {
            return this;
        } else {
            return new CommandState(record);
        }
    }

    update<T>(
        key: string,
        opt: ISetOptions & { notSetValue?: T },
        change: (x: T) => T
    ): CommandState;
    update<T>(key: string, change: (x: T) => T): CommandState;
    update<T>(
        key: string,
        optOrChange: ISetOptions | ((x: T) => T),
        change_?: (x: T) => T,
    ) {
        let opt: ISetOptions & { notSetValue?: T };
        let change: (x: T) => T;
        if (arguments.length === 2) {
            opt = {};
            change = <(x: T) => T>optOrChange;
        } else {
            opt = <ISetOptions | { notSetValue: T }>optOrChange;
            change = <(x: T) => T>change_;
        }
        const oldValue = this.record.values.get(key);
        let newValue;
        const values = this.record.values.update(key, opt.notSetValue, (x) => {
            newValue = change(<T>x);
            return newValue;
        });
        if (newValue !== oldValue) {
            return this.setHelper_(key, opt, values);
        } else {
            return this;
        }
    }

    get<T>(key: string, defaultValue?: T): T | undefined {
        return <T | undefined> this.record.values.get(key, defaultValue);
    }

    reset() {
        const changedValues = new Set();
        const values = this.record.values.map((v, k) => {
            const transient = this.record.options.get(k)?.transient;
            if (transient && transient.reset !== v) {
                changedValues.add(k);
                return transient.reset;
            } else {
                return v;
            }
        });

        const options = this.record.options.withMutations(opt =>
            opt.map((v, k) =>
                v.update('listeners', (l) => {
                    if (changedValues.has(k)) {
                        return l.filter(listener => listener(values));
                    } else {
                        return l;
                    }
                }),
            ),
        );

        const record = this.record.set('options', options).set('values', values);
        if (record.wasAltered()) {
            return this;
        } else {
            return new CommandState(record);
        }
    }

    onSet(key: string, listener: Listener) {
        let options = this.record.options.get(key, StateOptions());
        options = options.update('listeners', ls => ls.push(listener));
        const record = this.record.setIn(['options', key], options);
        if (record.wasAltered()) {
            return this;
        } else {
            return new CommandState(record);
        }
    }

    onResolve(name: string, listener: Listener) {
        const record = this.record.setIn(['resolveListeners', name], listener);
        if (record.wasAltered()) {
            return this;
        } else {
            return new CommandState(record);
        }
    }

    resolve() {
        const listeners = this.record.resolveListeners.filter(li => li(this.record.values));
        this.record.values.forEach((v, k) => {
            if (this.record.options.get(k)?.public) {
                vscode.commands.executeCommand('setContext', 'master-key.' + k, v);
            }
        });
        const record = this.record.set('resolveListeners', listeners);
        if (record.wasAltered()) {
            return this;
        } else {
            return new CommandState(record);
        }
    }

    get values() {
        return this.record.values.toJS();
    }
}

type StateSetter = (x: CommandState) => Promise<CommandState>;
async function* generateStateStream(): AsyncGenerator<CommandState, void, StateSetter> {
    let state = new CommandState();
    while (true) {
        let newState;
        try {
            const setter = yield state;
            newState = await setter(state);
            state = newState;
        } catch (e) {
            vscode.window.showErrorMessage('Error while processing master-key state: ' + e);
            console.dir(e);
        }
    }
}
const stateStream = (() => {
    const stream = generateStateStream();
    stream.next();
    return stream;
})();

export async function onResolve(key: string, listener: Listener) {
    return await stateStream.next(async state => state.onResolve(key, listener));
}

export async function onSet(name: string, listener: Listener) {
    return await stateStream.next(async state => state.onSet(name, listener));
}

export async function withState(
    fn: StateSetter = async x => x,
): Promise<CommandState | void> {
    const result = await stateStream.next(fn);
    if (!result.done) {
        return result.value;
    } else {
        return;
    }
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

function addDefinitions(
    state: CommandState,
    definitions: Record<string, unknown> | undefined,
) {
    return state.withMutations((state) => {
        for (const [k, v] of Object.entries(definitions || {})) {
            state.set(k, { public: true }, v);
        }
    });
}

async function updateDefinitions(bindings: Bindings | undefined) {
    // TODO: ideally we clear the old definitions here
    await withState(async state => addDefinitions(state, bindings?.define));
}

const setFlagArgs = z.
    object({
        name: z.string().endsWith('_on'),
        value: z.boolean(),
        transient: z.boolean().default(false).optional(),
    }).
    strict();

/**
 * @command setFlag
 * @order 101
 * @section State Management
 *
 * Sets a boolean flag named `name` that can be accessed in when clauses using
 * `master-key.[name]` and in [expressions](/expressions/index) using
 * `[name]`.
 *
 * **Arguments**:
 * - `name`: String denoting the name of this flag, must end with the suffix `_on`.
 * - `value`: true or false
 * - `transient`: (default = `false`) whether the variable will reset to false
 *    when a key sequence is complete. See [`master-key.prefix`](/commands/prefix)
 *    for more details.
 */
async function setFlag(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.setFlag', args_, setFlagArgs);
    if (args) {
        const opt: ISetOptions = !args.transient ?
                { public: true } :
                { public: true, transient: { reset: false } };
        const a = args;
        await withState(async (state) => {
            return state.set(a.name, opt, a.value);
        });
    }
    return;
}

export async function activate(context: vscode.ExtensionContext) {
    onChangeBindings(updateDefinitions);

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setFlag', recordedCommand(setFlag)),
    );

    vscode.window.onDidChangeTextEditorSelection(async (e) => {
        let selCount = 0;
        for (const sel of e.selections) {
            if (!sel.isEmpty) {
                selCount += 1;
            }
            if (selCount > 1) {
                break;
            }
        }
        await withState(async (state) => {
            return state.withMutations((state) => {
                state.set('editorHasSelection', selCount > 0);
                state.set('editorHasMultipleSelections', selCount > 1);
                const doc = e.textEditor.document;

                let firstSelectionOrWord: string;
                if (e.selections[0].isEmpty) {
                    const wordRange = doc.getWordRangeAtPosition(e.selections[0].start);
                    firstSelectionOrWord = doc.getText(wordRange);
                } else {
                    firstSelectionOrWord = doc.getText(e.selections[0]);
                }
                state.set('firstSelectionOrWord', { public: true }, firstSelectionOrWord);
            });
        });
    });

    vscode.window.onDidChangeActiveTextEditor(async (e) => {
        await withState(async state =>
            state.set('editorLangId', e?.document?.languageId || ''),
        );
    });
}
