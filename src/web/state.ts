import * as vscode from 'vscode';
import z from 'zod';
import { cloneDeep, mapValues } from 'lodash';
import { validateInput } from './utils';
import { Map, List, RecordOf, Record as IRecord } from 'immutable';
import { RunCommandsArgs } from './commands/do';

// OLD THINGS THAT GOT UPDATED IN `set` THAT MUST GO ELSEWHERE
// - status bar / various other ux changes that happen due to state changes
// - update cursor appearance

export type Listener = (states: Map<string, unknown>) => boolean;

interface IStateOptions{
    transient?: { reset: unknown },
    listeners: List<Listener>,
    public: boolean
}
const StateOptions = IRecord<IStateOptions>({
    transient: undefined,
    listeners: List<Listener>(),
    public: false
});
type RStateOptions = RecordOf<IStateOptions>;

const UNDEFINED_RESET_UUID = "21c64688-c3e6-4f44-bf57-d17f8d3a2d50";

interface ISetOptions {
    transient?: { reset: unknown },
    public?: boolean
}

type ChangeFn<T> = (state: Map<string, unknown>) => T;

interface ICommandState{
    options: Map<string, RStateOptions>;
    resolveListeners: Map<string, Listener>;
    values: Map<string, unknown>;
    nesting: boolean;
}

const CommandStateFactory = IRecord({
    options: Map<string, RStateOptions>(),
    resolveListeners: Map<string, Listener>(),
    values: Map<string, unknown>(),
    nesting: false
});
type RCommandState = RecordOf<ICommandState>;

export class CommandState {
    private record: RCommandState;
    constructor(record: RCommandState = CommandStateFactory()){
        this.record = record;
    }

    update<T>(key: string, change: ChangeFn<T>, opt: ISetOptions = {}){
        let values = this.record.values.set(key, change(this.record.values));
        let listeners = this.record.options.get(key, StateOptions()).listeners;
        listeners = listeners.filter((listener) => listener(values));

        let options = this.record.options.set(key, StateOptions({
            transient: opt.transient,
            listeners,
            public: opt.public
        }));

        let resolveListeners = this.record.resolveListeners;
        return new CommandState(CommandStateFactory({
            options,
            resolveListeners,
            values
        }));
    }

    reset(){
        let values = this.record.options.map(x => x.transient?.reset || x);
        return new CommandState(this.record.set('values', values));
    }

    onSet(key: string, listener: Listener){
        let options = this.record.options.get(key, StateOptions());
        options.update('listeners', ls => ls.push(listener));
        return new CommandState(this.record.setIn(['options', key], options));
    }

    onResolve(name: string, listener: Listener){
        return new CommandState(this.record.setIn(['resolveListeners', name], listener));
    }

    resolve() {
        let listeners = this.record.resolveListeners.filter(li => li(this.record.values));
        this.record.values.forEach((v, k) => {
            if (this.record.options.get(k)?.public) {
                vscode.commands.executeCommand('setContext', 'master-key.' + k, v);
            }
        });
        return new CommandState(this.record.setIn(['options', 'resolveListeners'], listeners));
    }

    get values(){ return this.record.values.toJS(); }

    nest<T>(fn: (state: CommandState) => [CommandState, T]): [CommandState, T] {
        let [state, others] = fn(new CommandState(this.record.set('nesting', true)));
        return [new CommandState(state.record.set('nesting', false)), others];
    }
}

type StateSetter = (x: CommandState) => CommandState;
function* generateStateStream(): Generator<Promise<CommandState>, void, StateSetter>{
    let state = Promise.resolve(new CommandState());
    while(true){
        let setter = yield state;
        state = state.then(setter);
    }
}
let stateStream = generateStateStream();

const WRAPPED_UUID = "28509bd6-8bde-4eef-8406-afd31ad11b43";
export type WrappedCommandResult = {
    id: "28509bd6-8bde-4eef-8406-afd31ad11b43",
    args?: object | "cancel"
    state: CommandState
};
export function commandArgs(x: unknown): undefined | object | "cancel" {
    if((<any>x)?.id === WRAPPED_UUID){
        return (<WrappedCommandResult>x).args;
    }
}
export function commandState(x: unknown): undefined | CommandState {
    if((<any>x)?.id === WRAPPED_UUID){
        return (<WrappedCommandResult>x).state;
    }
}

export async function onResolve(key: string, listener: Listener){
    await stateStream.next(state => state.onResolve(key, listener));
}

// TODO: stopped here

export async function setState<T>(str: string, def: T, opt: ISetOptions, fn: (x: T) => T){
    let state_;
    state_ = await state;
    state_.set(str, fn(state_.get<T>(str, def)!), opt);
    state = Promise.resolve(state_);
}

export type CommandResult = [object | undefined | "cancel", CommandState];
type CommandFn = (state: CommandState, ...args: any[]) => Promise<CommandResult>;
export function wrapStateful(fn: CommandFn) {
    return async function (...args: any[]): Promise<WrappedCommandResult> {
        let state_;
        let passArgs;
        if(args[1] instanceof CommandState){
            state_ = args[1];
            passArgs = args.slice(0, 1).concat(args.slice(2));
        }else{
            state_ = await state;
            passArgs = args;
        }

        let nestedCall = state_.get<boolean>(NESTED_CALL, false);
        if(!nestedCall){ state_.set(NESTED_CALL, true, {}); }

        let rargs;
        [rargs, state_] = await fn(state_, ...args);

        if(!nestedCall){
            state_ = await state;
            state_.resolve();
            state_.set(NESTED_CALL, false, {});
            state_.reset();
        }
        state = Promise.resolve(state_);
        return { id: WRAPPED_UUID, args: rargs, state: state_ };
    };
}

async function addDefinitions(state: Thenable<CommandState>, definitions: any){
    let state_ = await state;

    for(let [k, v] of Object.entries(definitions || {})){
        await state_.set(k, v, {public: true});
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
    name: z.string().endsWith('_on'),
    value: z.boolean(),
    transient: z.boolean().default(false).optional()
}).strict();
type SetFlagArgs = z.infer<typeof setFlagArgs>;

async function setFlag(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.setFlag', args_, setFlagArgs);
    if(args){ state.set(args.name, args.value, {transient: args.transient || false}); }
    return [undefined, state];
}

export function activate(context: vscode.ExtensionContext){
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    context.subscriptions.push(vscode.commands.registerCommand('master-key.setFlag',
        wrapStateful(setFlag)));

    vscode.window.onDidChangeTextEditorSelection(async e => {
        let selCount = 0;
        for(let sel of e.selections){
            if(!sel.isEmpty){ selCount += 1; }
            if(selCount > 1){ break; }
        }
        let state_ = await state;
        state_.set('editorHasSelection', selCount > 0, {});
        state_.set('editorHasMultipleSelections', selCount > 1, {});
        let doc = e.textEditor.document;

        let firstSelectionOrWord;
        if(e.selections[0].isEmpty){
            let wordRange = doc.getWordRangeAtPosition(e.selections[0].start);
            firstSelectionOrWord = doc.getText(wordRange);
        }else{
            firstSelectionOrWord = doc.getText(e.selections[0]);
        }
        state_.set('firstSelectionOrWord', firstSelectionOrWord, {public: true});
        vscode.commands.executeCommand('setContext', 'master-key.firstSelectionOrWord',
            firstSelectionOrWord);
    });

    vscode.window.onDidChangeActiveTextEditor(e => {
        setState('editorLangId', '', {}, val => e?.document?.languageId || '');
    });
}
