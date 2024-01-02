import * as vscode from 'vscode';
import z from 'zod';
import { doArgs } from './keybindingParsing';
import { validateInput } from './utils';
import { state, runCommands, setKeyContext, updateArgs } from './commands';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return onTypeFn(event.text);
}

type UpdateFn = (str: string, stop: () => void) => void;
export function captureKeys(onUpdate: UpdateFn): void {
    let oldMode = state.values.mode;
    if(!typeSubscription){
        try{
            typeSubscription = vscode.commands.registerCommand('type', onType);
            setKeyContext({name: 'mode', value: 'capture'});
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
            setKeyContext({name: 'mode', value: oldMode});
        }
    };
    state.onContextChange(values => {
        if(values.mode !== 'capture'){
            if(typeSubscription){
                typeSubscription.dispose();
                typeSubscription = undefined;
            }
            // TODO: we need to somehow "update" args here to indicate
            // that capturing was canceled
            return "close";
        }
        return "keepOpen";
    });
    onTypeFn = (str: string) => onUpdate(str, stop);
}

const captureKeysArgs = z.object({
    keys: z.string().optional(),
    acceptAfter: z.number().min(1),
    doAfter: doArgs,
});
function captureKeysCmd(args_: unknown){
    let args = validateInput('master-key.captureKeys', args_, captureKeysArgs);
    if(args){
        let a = args;
        if(args.keys){ 
            runCommands({ do: a.doAfter });
        }else{
            let captured = "";
            captureKeys((key, stop) => {
                let doStop = false;
                if(key === "\n"){ doStop = true; }
                else{
                    captured += key;
                    setKeyContext({ name: 'captured', value: captured, transient: true });
                    if(captured.length >= a?.acceptAfter){
                        doStop = true;
                    }
                }
                updateArgs({ ...a, keys: captured });
                if(doStop){
                    stop();
                    runCommands({ do: a.doAfter }); 
                }
            });
        }
    }
}

const charArgs = z.object({
    char: z.string().optional()
}).strict();


function doChar(editor: vscode.TextEditor, name: string, 
                action: (editor: vscode.TextEditor, char: string) => void, 
                args_: unknown = {}) {

    let char: string | undefined = undefined;
    if(args_){
        let args = validateInput(name, args_, charArgs);
        if(args){ 
            if(args.char){ char = args.char; } 
        }else{
            // validation error, stop trying to run this command
            return;
        }
    }
    if(char){
        action(editor, char);
    }else{

        captureKeys((key, stop) => {
            action(editor, key);
            updateArgs({ char: key });
            stop();
        });
    }
}

function replaceCharHelper(editor: vscode.TextEditor, char: string){
    editor.edit(edit => {
        for (let s of editor.selections) {
            edit.replace(new vscode.Range(s.active, s.active.translate(0, 1)), char);
        }
    });
}

function replaceChar(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, 
    args_: unknown){

    doChar(editor, 'master-key.replaceChar', replaceCharHelper, args_);
}

function insertCharHelper(editor: vscode.TextEditor, char: string){
    editor.edit(edit => {
        for(let s of editor.selections){ edit.insert(s.active, char); }
    });
}

function insertChar(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, 
    args_: unknown = {}){

    doChar(editor, 'master-key.insertChar', insertCharHelper);
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.captureKeys', captureKeysCmd));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.replaceChar', replaceChar));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.insertChar', insertChar));
}
