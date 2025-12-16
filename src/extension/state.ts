import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from './utils';
import { Map, List, RecordOf, Record as IRecord } from 'immutable';
import { bindings, onChangeBindings } from './keybindings/config';
import { KeyFileResult, ParseError } from '../rust/parsing/lib/parsing';
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
        // console.log(`key: ${key}, values: ${JSON.stringify(values, null, 4)}`);
        let listeners = this.record.options.get(key, StateOptions()).listeners;
        listeners = listeners.filter(listener => listener(values));

        const jsValues: Record<string, unknown> = {};
        for (const k of values.keys()) {
            // NOTE: expressions already know about `val` entries, and they don't need to be
            // added here again
            if (k != 'val') {
                jsValues[k] = values.get(k);
            }
        }

        try {
            bindings.set_value('key', jsValues);
        } catch (e) {
            if ((<ParseError>e).report_string) {
                const msg = (<ParseError>e).report_string();
                vscode.window.showErrorMessage(
                    `While setting 'key' to '${JSON.stringify(jsValues, null, 4)}' ${msg}.`,
                );
            }
        }

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
            syncStateWithBindings(this);
            return this;
        } else {
            const result = new CommandState(record);
            syncStateWithBindings(result);
            return result;
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
    definitions: unknown,
) {
    return state.withMutations((state) => {
        state.set('val', { public: true }, definitions);
        syncStateWithBindings(state);
    });
}

function syncStateWithBindings(state: CommandState) {
    const jsValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.values)) {
        // NOTE: expressions already know about `val` entries, and they don't need to be
        // added here again
        if (k != 'val') {
            jsValues[k] = v;
        }
    }
    try {
        bindings.set_value('key', jsValues);
        bindings.set_value('code', codeState);
    } catch (e) {
        if ((<ParseError>e).report_string) {
            const msg = (<ParseError>e).report_string();
            vscode.window.showErrorMessage(
                `While setting 'key' to '${JSON.stringify(jsValues, null, 4)}'
                 \nand setting 'code' to '${JSON.stringify(codeState, null, 4)}'
                 \nerror: ${msg}.`,
            );
        }
    }
}

async function updateDefinitions(bindings: KeyFileResult) {
    await withState(async state => addDefinitions(state, bindings.values()));
}

const setFlagArgs = z.
    object({
        name: z.string(),
        value: z.any(),
        transient: z.boolean().default(false).optional(),
    }).
    strict();

/**
 * @command setValue
 * @order 101
 * @section State Management
 *
 * Sets a a value named `name` that can be accessed in [expressions](/expressions/index)
 * using `val.[name]`. The value must be defined in a `[[define.val]]` block
 * or an error occurs.
 *
 * **Arguments**:
 * - `name`: String denoting the name of this flag
 * - `value`: any valid json value
 * - `transient`: (default = `false`) whether the variable will reset to its original
 *    value in the `[[define.val]]` block it was created in after the current key
 *    sequence is complete. See [`master-key.prefix`](/commands/prefix) for more details.
 */
async function setValue(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.setValue', args_, setFlagArgs);
    if (args) {
        const values = bindings.values();
        values[args.name] = args.value;
        bindings.set_value('val', values);
        await withState(async state => addDefinitions(state, bindings.values()));
    }
    return;
}

interface ICodeState {
    editorHasSelection: boolean;
    editorHasMultipleSelections: boolean;
    editorLangId: string;
    firstSelectionOrWord: string;
}

let codeState: ICodeState = {
    editorHasSelection: false,
    editorHasMultipleSelections: false,
    editorLangId: '',
    firstSelectionOrWord: '',
};

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
    codeState = {
        editorHasSelection: selCount > 0,
        editorHasMultipleSelections: selCount > 1,
        editorLangId: editorLangId || '',
        firstSelectionOrWord,
    };
    try {
        bindings.set_value('code', codeState);
    } catch (e) {
        if ((<ParseError>e).report_string) {
            const msg = (<ParseError>e).report_string();
            vscode.window.showErrorMessage(
                `While setting 'code' to '${JSON.stringify(codeState, null, 4)}' ${msg}.`,
            );
        }
    }
}

export async function activate(_context: vscode.ExtensionContext) {
    onChangeBindings(updateDefinitions);

    updateCodeVariables({ textEditor: vscode.window.activeTextEditor });
    vscode.window.onDidChangeTextEditorSelection(updateCodeVariables);
    vscode.window.onDidChangeActiveTextEditor(e => updateCodeVariables({ textEditor: e }));
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setValue', recordedCommand(setValue)),
    );
}
