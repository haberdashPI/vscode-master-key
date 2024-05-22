import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { CommandResult, CommandState } from '../state';
import { MODE, defaultMode } from './mode';
import { withState, recordedCommand } from '../state';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return await onTypeFn(event.text);
}

const CAPTURE = 'captured';

function clearTypeSubscription(){
    if(typeSubscription){
        typeSubscription.dispose();
        typeSubscription = undefined;
    }
}

type UpdateFn = (captured: string, nextChar: string) => [string, boolean];
export async function captureKeys(onUpdate: UpdateFn) {
    let oldMode: string;
    await withState(async state => {
        oldMode = state.get<string>(MODE,
            )!;
        if(!typeSubscription){
            try{
                typeSubscription = vscode.commands.registerCommand('type', onType);
                return state.set(MODE, {public: true}, 'capture').resolve();
            }catch(e){
                vscode.window.showErrorMessage(`Master key failed to capture keyboard input. You
                    might have an extension that is already listening to type events
                    (e.g. vscodevim).`);
            }
        }
        return state;
    });

    let stringResult = '';
    let isResolved = false;
    let resolveFn: ((str: string) => void);
    let stringPromise = new Promise<string>((res, rej) => {
        resolveFn = res;
    });

    await withState(async state => {
        return state.onSet(MODE, state => {
            if(state.get(MODE, defaultMode) !== 'capture'){
                clearTypeSubscription();
                if(!isResolved){
                    isResolved = true;
                    resolveFn(stringResult);
                    return false;
                }
            }
            return !isResolved;
        });
    });

    onTypeFn = async (str: string) => {
        let stop;
        [stringResult, stop] = onUpdate(stringResult, str);
        if(stop){
            clearTypeSubscription();
            // setting the mode will call `resolveFn`
            await withState(async state =>
                state.set(MODE, {public: true}, oldMode).resolve()
            );
            // if the old mode wasn't 'capture', `resolveFn` will have already been called
            // (in the `onSet` block above)
            if(!isResolved){
                isResolved = true;
                resolveFn(stringResult);
            }
        }
    };

    return stringPromise;
}

const captureKeysArgs = z.object({
    text: z.string().optional(),
    acceptAfter: z.number().min(1),
});

async function captureKeysCmd(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.captureKeys', args_, captureKeysArgs);
    if(args){
        let a = args;
        let text: string;
        if(args.text){
            text = args.text;
        }else{
            text = await captureKeys((result, char) => {
                let stop = false;
                if(char === "\n"){ stop = true; }
                else{
                    result += char;
                    if(result.length >= a.acceptAfter){ stop = true; }
                }
                return [result, stop];
            });
        }
        await withState(async state => {
            return state.set(CAPTURE, {transient: {reset: ""}}, text);
        });
        args = {...args, text};
    }
    return args;
}

function captureOneKey(){
    return captureKeys((result, char) => [char, true]);
}

const charArgs = z.object({
    char: z.string().optional()
}).strict();

async function replaceChar(args_: unknown): Promise<CommandResult> {
    let editor_ = vscode.window.activeTextEditor;
    if(!editor_){ return; }
    let editor = editor_!;

    let args = validateInput(name, args_, charArgs);
    if(args){
        let char = args.char === undefined ? await captureOneKey() : args.char;
        editor.edit(edit => {
            for (let s of editor.selections) {
                edit.replace(new vscode.Range(s.active, s.active.translate(0, 1)), char);
            }
        });
        args = {...args, char};
    }
    return args;
}

async function insertChar(args_: unknown): Promise<CommandResult> {
    let editor_ = vscode.window.activeTextEditor;
    if(!editor_){ return; }
    let editor = editor_!;

    let args = validateInput(name, args_, charArgs);
    if(args){
        let char = args.char === undefined ? await captureOneKey() : args.char;
        editor.edit(edit => {
            for (let s of editor.selections) { edit.insert(s.active, char); }
        });
        args = {...args, char};
    }
    return args;
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.captureKeys',
        recordedCommand(captureKeysCmd)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.replaceChar',
        recordedCommand(replaceChar)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.insertChar',
        recordedCommand(insertChar)));
}
