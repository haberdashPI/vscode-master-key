import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from './utils';
import { Map, List, RecordOf, Record as IRecord } from 'immutable';

export type Listener = (states: Map<string, unknown>) => boolean;

interface IStateOptions{
    transient?: { reset: unknown },
    listeners: List<Listener>,
    public: boolean
}
// eslint-disable-next-line @typescript-eslint/naming-convention
const StateOptions = IRecord<IStateOptions>({
    transient: undefined,
    listeners: List<Listener>(),
    public: false
});
type RStateOptions = RecordOf<IStateOptions>;

interface ISetOptions {
    transient?: { reset: unknown },
    public?: boolean
}

type ChangeFn<T> = (state: Map<string, unknown>) => T;

interface ICommandState{
    options: Map<string, RStateOptions>;
    resolveListeners: Map<string, Listener>;
    values: Map<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const CommandStateFactory = IRecord({
    options: Map<string, RStateOptions>(),
    resolveListeners: Map<string, Listener>(),
    values: Map<string, unknown>(),
});
type RCommandState = RecordOf<ICommandState>;

export class CommandState {
    private record: RCommandState;
    constructor(record: RCommandState = CommandStateFactory()){
        this.record = record;
    }

    withMutations(fn: (x: CommandState) => void) {
        let rec = this.record.withMutations(rec => {
            rec.update('values', v => v.asMutable());
            fn(new CommandState(rec));
            rec.update('values', v => v.asImmutable());
        });
        return new CommandState(rec);
    }

    // todo: re-write `update` as set, find all calls to `update` and replace
    set<T>(key: string, opt: ISetOptions, val: T): CommandState;
    set<T>(key: string, val: T): CommandState;
    set<T>(key: string, optOrVal: ISetOptions | T, val_?: T){
        let opt: ISetOptions;
        let val: T;
        if(arguments.length === 2){
            opt = {};
            val = <T>optOrVal;
        }else{
            opt = <ISetOptions>optOrVal;
            val = <T>(val_);
        }

        let values = this.record.values.set(key, val);
        return this.setHelper_(key, opt, values);
    }

    private setHelper_(key: string, opt: ISetOptions, values: Map<string, unknown>){
        let listeners = this.record.options.get(key, StateOptions()).listeners;
        listeners = listeners.filter((listener) => listener(values));

        let options = this.record.options.set(key, StateOptions({
            transient: opt.transient,
            listeners,
            public: opt.public
        }));

        let resolveListeners = this.record.resolveListeners;
        // NOTE: we set `record` in this way so that `update` can be used
        // both inside and outside of `withMutations`;
        let record = this.record.
            set('options', options).
            set('resolveListeners', resolveListeners).
            set('values', values);
        if(record.wasAltered()){
            return this;
        }else{
            return new CommandState(record);
        }
    }

    update<T>(key: string, opt: ISetOptions & { notSetValue?: T }, change: (x: T) => T): CommandState;
    update<T>(key: string, change: (x: T) => T): CommandState;
    update<T>(key: string, optOrChange: ISetOptions | ((x: T) => T), change_?: (x: T) => T){
        let opt: ISetOptions & { notSetValue?: T };
        let change: (x: T) => T;
        if(arguments.length === 2){
            opt = {};
            change = <(x: T) => T>(optOrChange);
        }else{
            opt = <ISetOptions | {notSetValue: T }>optOrChange;
            change = <(x: T) => T>(change_);
        }
        let values = this.record.values.update(key, opt.notSetValue, x => change(<T>x));
        return this.setHelper_(key, opt, values);
    }

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.record.get(key, defaultValue);
    }

    reset(){
        let values = this.record.values.map((v, k) => {
            let transient = this.record.options.get(k)?.transient;
            if(transient){
                return transient.reset;
            }else{
                return v;
            }
        });
        let record = this.record.set('values', values);
        if(record.wasAltered()){
            return this;
        }else{
            return new CommandState(record);
        }
    }

    onSet(key: string, listener: Listener){
        let options = this.record.options.get(key, StateOptions());
        options.update('listeners', ls => ls.push(listener));
        let record = this.record.setIn(['options', key], options);
        if(record.wasAltered()){
            return this;
        }else{
            return new CommandState(record);
        }
    }

    onResolve(name: string, listener: Listener){
        let record = this.record.setIn(['resolveListeners', name], listener);
        if(record.wasAltered()){
            return this;
        }else{
            return new CommandState(record);
        }
    }

    resolve() {
        let listeners = this.record.resolveListeners.filter(li => li(this.record.values));
        this.record.values.forEach((v, k) => {
            if (this.record.options.get(k)?.public) {
                vscode.commands.executeCommand('setContext', 'master-key.' + k, v);
            }
        });
        let record = this.record.setIn(['options', 'resolveListeners'], listeners);
        if(record.wasAltered()){
            return this;
        }else{
            return new CommandState(record);
        }
    }

    get values(){ return this.record.values.toJS(); }
}

type StateSetter = (x: CommandState) => Promise<CommandState>;
async function* generateStateStream(): AsyncGenerator<CommandState, void, StateSetter>{
    let state = Promise.resolve(new CommandState());
    while(true){
        try{
            let setter = yield state;
            state = state.then(setter);
        }catch(e){
            vscode.window.showErrorMessage("Error while processing master-key state: "+e);
            console.dir(e);
            throw e;
        }
    }
}
let stateStream = generateStateStream();

export async function onResolve(key: string, listener: Listener){
    return await stateStream.next(async state => state.onResolve(key, listener));
}

export async function onSet(name: string, listener: Listener){
    return await stateStream.next(async state => state.onSet(name, listener));
}

export async function withState(fn: StateSetter = async x => x): Promise<CommandState | void>{
    let result = await stateStream.next(fn);
    if(!result.done){
        return result.value;
    }else{
        return;
    }
}

const WRAPPED_UUID = "28509bd6-8bde-4eef-8406-afd31ad11b43";
export type WrappedCommandResult = {
    id: "28509bd6-8bde-4eef-8406-afd31ad11b43",
    args?: object | "cancel"
};
export function commandArgs(x: unknown): undefined | object | "cancel" {
    if((<any>x)?.id === WRAPPED_UUID){
        return (<WrappedCommandResult>x).args;
    }
}

export type CommandResult = object | undefined | "cancel";
type CommandFn = (...args: any[]) => Promise<CommandResult>;
export function recordedCommand(fn: CommandFn) {
    return async function (...args: any[]): Promise<WrappedCommandResult | undefined> {
        let rargs;
        rargs = await fn(...args);
        return { id: WRAPPED_UUID, args: rargs };
    };
}

function addDefinitions(state: CommandState, definitions: any){
    return state.withMutations(state => {
        for(let [k, v] of Object.entries(definitions || {})){
            state.set(k, { public: true }, v);
        }
    });
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if(!event || event?.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let definitions = config.get<object[]>('definitions');
        withState(async state => addDefinitions(state, definitions));
    }
}

const setFlagArgs = z.object({
    name: z.string().endsWith('_on'),
    value: z.boolean(),
    transient: z.boolean().default(false).optional()
}).strict();
type SetFlagArgs = z.infer<typeof setFlagArgs>;

async function setFlag(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.setFlag', args_, setFlagArgs);
    if (args) {
        let opt = !args.transient ? {} : {
            transient: { reset: false }
        };
        let a = args;
        withState(async state => { return state.set(a.name, opt, a.value); });
    }
    return;
}

export function activate(context: vscode.ExtensionContext){
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setFlag',
        recordedCommand(setFlag)));

    vscode.window.onDidChangeTextEditorSelection(async e => {
        let selCount = 0;
        for(let sel of e.selections){
            if(!sel.isEmpty){ selCount += 1; }
            if(selCount > 1){ break; }
        }
        withState(async state => {
            return state.withMutations(state => {
                state.set('editorHasSelection', selCount > 0);
                state.set('editorHasMultipleSelections', selCount > 1);
                let doc = e.textEditor.document;

                let firstSelectionOrWord: string;
                if(e.selections[0].isEmpty){
                    let wordRange = doc.getWordRangeAtPosition(e.selections[0].start);
                    firstSelectionOrWord = doc.getText(wordRange);
                }else{
                    firstSelectionOrWord = doc.getText(e.selections[0]);
                }
                state.set('firstSelectionOrWord', firstSelectionOrWord);
            });
        });
    });

    vscode.window.onDidChangeActiveTextEditor(e => {
        withState(async state =>
            state.set('editorLangId', (e?.document?.languageId || ''))
        );
    });
}
