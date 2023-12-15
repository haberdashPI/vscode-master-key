import * as vscode from 'vscode';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => Promise<void> = async function(text: string){
    return;
};
async function onType(event: {text: string}){
    return onTypeFn(event.text);
}

function captureKeys(count: number){
    
}

