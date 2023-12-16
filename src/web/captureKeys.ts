import * as vscode from 'vscode';
import z from 'zod';
import { strictDoArgs } from './keybindingParsing';
import { validateInput } from './utils';
import { runCommands, setKeyContext } from './commands';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return onTypeFn(event.text);
}

type UpdateFn = (str: string, stop: () => void) => void;
export function captureKeys(onUpdate: UpdateFn): void {
    if(!typeSubscription){
        try{
            typeSubscription = vscode.commands.registerCommand('type', onType);
        }catch(e){
            vscode.window.showErrorMessage(`Failed to capture keyboard input. You 
                might have an extension that is already listening to type events 
                (e.g. vscodevim).`);
        }
    }
    let stop = () => {
        if(typeSubscription){
            typeSubscription.dispose();
            typeSubscription = undefined;
        }
    };
    onTypeFn = (str: string) => onUpdate(str, stop);
}

const captureKeysArgs = z.object({
    acceptAfter: z.number().min(1),
    doAfter: strictDoArgs,
});
function captureKeysCmd(args_: unknown){
    let args = validateInput('master-key.captureKeys', args_, captureKeysArgs);
    if(args){
        let a = args;
        let captured = "";
        captureKeys((key, stop) => {
            let doStop = false
            if(key === "\n"){ doStop; }
            else{
                captured += key;
                setKeyContext({ name: 'captured', value: captured, transient: true });
                if(captured.length >= a?.acceptAfter){
                    doStop;
                }
            }
            if(doStop){
                stop();
                if(a.doAfter){ 
                    runCommands({ do: a.doAfter, resetTransient: true }); 
                }
            }
        });
    }
}

function replaceChar(editor: vscode.TextEditor, edit: vscode.TextEditorEdit){
    captureKeys((key, stop) => {
        for(let s of editor.selections){
            edit.replace(new vscode.Range(s.active, s.active.translate(0, 1)), key);
        }
        stop();
    });
}

function insertChar(editor: vscode.TextEditor, edit: vscode.TextEditorEdit){
    captureKeys((key, stop) => {
        for(let s of editor.selections){ edit.insert(s.active, key); }
        stop();
    });
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.captureKeys', captureKeys));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.replaceChar', replaceChar));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.insertChar', insertChar));
}
