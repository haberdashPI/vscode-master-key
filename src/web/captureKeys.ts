import * as vscode from 'vscode';

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
