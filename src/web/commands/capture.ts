import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { CommandResult, CommandState } from '../state';
import { MODE } from './mode';
import { withState, recordedCommand } from '../state';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return await onTypeFn(event.text);
}

const CAPTURE = 'capture';

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
        oldMode = state.get<string>(MODE, 'insert')!;
        if(!typeSubscription){
            try{
                typeSubscription = vscode.commands.registerCommand('type', onType);
                return state.set(MODE, {public: true}, 'capture').resolve();
            }catch(e){
                vscode.window.showErrorMessage(`Failed to capture keyboard input. You
                    might have an extension that is already listening to type events
                    (e.g. vscodevim).`);
            }
        }
        return state;
    });

    let resolveFn: ((x: string | PromiseLike<string>) => void) | undefined = undefined;
    let stringResult = '';
    await withState(async state => {
        return state.onSet(MODE, state => {
            if(state.get(MODE, 'insert') !== 'capture'){
                clearTypeSubscription();
                if(resolveFn){
                    resolveFn(stringResult);
                    return false;
                }
            }
            return true;
        });
    });

    return new Promise<string>((resolve, reject) => {
        try{
            resolveFn = resolve;
            onTypeFn = async (str: string) => {
                let stop;
                [stringResult, stop] = onUpdate(stringResult, str);
                if(stop){
                    clearTypeSubscription();
                    await withState(async state =>
                        state.set(MODE, {public: true}, oldMode).resolve()
                    );
                    resolve(stringResult);
                }
            };
        }catch(e){
            reject(e);
        }
    });
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

async function replaceChar(editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: unknown): Promise<CommandResult> {

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

async function insertChar(editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: unknown): Promise<CommandResult> {

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
