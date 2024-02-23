import * as vscode from 'vscode';
import z from 'zod';
import { doArgs } from '../keybindings/parsing';
import { validateInput } from '../utils';
import { CommandResult, CommandState } from '../state';
import { MODE } from './mode';
import { statefulFunction } from '../state';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return onTypeFn(event.text);
}

const CAPTURE = 'capture';

function clearTypeSubscription(){
    if(typeSubscription){
        typeSubscription.dispose();
        typeSubscription = undefined;
    }
}

type UpdateFn = (captured: string, nextChar: string) => [string, boolean];
export function captureKeys(state: CommandState, onUpdate: UpdateFn) {
    let oldMode = state.get<string>(MODE, 'insert');
    if(!typeSubscription){
        try{
            typeSubscription = vscode.commands.registerCommand('type', onType);
            state.set(MODE, 'capture', {public: true});
        }catch(e){
            vscode.window.showErrorMessage(`Failed to capture keyboard input. You
                might have an extension that is already listening to type events
                (e.g. vscodevim).`);
        }
    }
    return new Promise<string>((resolve, reject) => {
        try{
            let result = '';
            // other commands can interrupt user input to `captureKeys` by changing the mode
            // away from 'capture'
            state.onSet(MODE, state => {
                if(state.get(MODE) !== 'capture'){
                    clearTypeSubscription();
                    resolve(result);
                    return false;
                }
                return true;
            });
            onTypeFn = (str: string) => {
                let stop;
                [result, stop] = onUpdate(result, str);
                if(stop){
                    clearTypeSubscription();
                    state.set(MODE, oldMode, {public: true});
                    resolve(result);
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

async function captureKeysCmd(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.captureKeys', args_, captureKeysArgs);
    if(args){
        let a = args;
        let text: string;
        if(args.text){
            text = args.text;
        }else{
            text = await captureKeys(state, (result, char) => {
                let stop = false;
                if(char === "\n"){ stop = true; }
                else{
                    result += char;
                    if(result.length >= a.acceptAfter){ stop = true; }
                }
                return [result, stop];
            });
        }
        state.set(CAPTURE, args.text, {transient: true});
        args = {...args, text};
    }
    return [args, state];
}

function captureOneKey(state: CommandState){
    return captureKeys(state, (result, char) => [char, true]);
}

const charArgs = z.object({
    char: z.string().optional()
}).strict();

async function replaceChar(state: CommandState, editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: unknown): Promise<CommandResult> {

    let args = validateInput(name, args_, charArgs);
    if(args){
        let char = args.char === undefined ? await captureOneKey(state) : args.char;
        editor.edit(edit => {
            for (let s of editor.selections) {
                edit.replace(new vscode.Range(s.active, s.active.translate(0, 1)), char);
            }
        });
        args = {...args, char};
    }
    return [args, state];
}

async function insertChar(state: CommandState, editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: unknown): Promise<CommandResult> {

    let args = validateInput(name, args_, charArgs);
    if(args){
        let char = args.char === undefined ? await captureOneKey(state) : args.char;
        editor.edit(edit => {
            for (let s of editor.selections) { edit.insert(s.active, char); }
        });
        args = {...args, char};
    }
    return [args, state];
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.captureKeys',
        wrapStateful(captureKeysCmd)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.replaceChar',
        wrapStateful(replaceChar)));

    context.subscriptions.push(vscode.commands.registerCommand('master-key.insertChar',
        wrapStateful(insertChar)));
}
