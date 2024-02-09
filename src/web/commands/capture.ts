import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from './utils';
import { CommandState } from '../state';
import { MODE } from './mode';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return onTypeFn(event.text);
}

const CAPTURE = 'capture';

type UpdateFn = (captured: string, nextChar: string, stop: (result: string) => void) => string;
export function captureKeys(state: CommandState, onUpdate: UpdateFn) {
    let oldMode = state.get<string>(MODE, 'insert');
    if(!typeSubscription){
        try{
            typeSubscription = vscode.commands.registerCommand('type', onType);
            state.set(MODE, 'capture');
        }catch(e){
            vscode.window.showErrorMessage(`Failed to capture keyboard input. You
                might have an extension that is already listening to type events
                (e.g. vscodevim).`);
        }
    }
    return new Promise<string>((resolve, reject) => {
        try{
            let result = '';
            let stop = (result: string) => {
                if(typeSubscription){
                    typeSubscription.dispose();
                    typeSubscription = undefined;
                    state.set(MODE, oldMode);
                }
                resolve(result);
            };
            state.onSet(MODE, async state => {
                if(state.get<string>(MODE, 'insert') !== 'capture'){
                    if(typeSubscription){
                        typeSubscription.dispose();
                        typeSubscription = undefined;
                    }
                    resolve(result);
                    return false;
                }
                return true;
            });
            onTypeFn = (str: string) => { result = onUpdate(result, str, stop); };
        }catch(e){
            reject(e);
        }
    });
}

function captureOneKey(state: CommandState){
    return captureKeys(state, (result, char, stop) => {
        result += char;
        stop(result);
        return result;
    });
}

const charArgs = z.object({
    char: z.string().optional()
}).strict();

async function replaceChar(state: CommandState, editor: vscode.TextEditor, edit: vscode.TextEditorEdit,
    args_: unknown){

    let args = validateInput(name, args_, charArgs);
    if(args){
        let char = args.char === undefined ? await captureOneKey(state) : args.char;
        editor.edit(edit => {
            for (let s of editor.selections) {
                edit.replace(new vscode.Range(s.active, s.active.translate(0, 1)), char);
            }
        });
    }

}
