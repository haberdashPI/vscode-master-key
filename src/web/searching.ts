import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from './utils';
import { setKeyContext, runCommands, state as keyState, updateArgs } from "./commands";
import { doArgs } from './keybindingParsing';
import { wrappedTranslate } from './utils';
import { captureKeys } from './captureKeys';

export const searchArgs = z.object({
    backwards: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    wrapAround: z.boolean().optional(),
    acceptAfter: z.number().min(1).optional(),
    selectTillMatch: z.boolean().optional(),
    highlightMatches: z.boolean().default(true).optional(),
    offset: z.enum(["inclusive", "exclusive", "start", "end"]).default("exclusive"),
    text: z.string().min(1).optional(),
    regex: z.boolean().optional(),
    register: z.string().default("default"),
    skip: z.number().optional().default(0),
    doAfter: doArgs.optional(),
}).strict();
export type SearchArgs = z.infer<typeof searchArgs>;

async function search(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, args_: any[]){
    let args = validateInput('master-key.search', args_, searchArgs);
    if(!args){ return; }

    currentSearch = args.register;
    let state = getSearchState(editor);
    state.args = args;
    state.text = args.text || "";
    state.searchFrom = editor.selections;

    if(state.text.length > 0){
        navigateTo(state, editor);
        await acceptSearch(editor, edit, state);
        return;
    }

    setKeyContext({name: 'mode', value: 'capture', transient: false});
    // when there are a fixed number of keys use `type` command
    if(state.args.acceptAfter){
        let acceptAfter = state.args.acceptAfter;
        captureKeys((key, stop) => {
            state.stop = stop;
            if(key === "\n") { acceptSearch(editor, edit, state); }
            else {
                state.text += key;
                navigateTo(state, editor, false);
                if(state.text.length >= acceptAfter){ acceptSearch(editor, edit, state); }
                // there are other-ways to cancel key capturing so we need to update
                // the arguments on every keypress
                else{ updateArgs( {...state.args, text: state.text }); }
            }
        });
    }else{
        // if there are not a fixed number of characters use a UX element that makes the
        // keys visible
        state.stop = undefined;
        let inputBox = vscode.window.createInputBox();
        if(state.args.regex){
            inputBox.title = "Regex Search";
            inputBox.prompt = "Enter regex to search for";
        }else{
            inputBox.title = "Search";
            inputBox.prompt = "Enter text to search for";
        }
        inputBox.onDidChangeValue((str: string) => {
            state.text = str;
            updateArgs({ ...state.args, text: state.text });
            navigateTo(state, editor, false);
        });
        inputBox.onDidAccept(() => {
            acceptSearch(editor, edit, state);
            inputBox.dispose();
        });
        inputBox.onDidHide(() => {
            if(state.stop){
                updateArgs("CANCEL");
                cancelSearch(editor, edit);
            }
        });
        inputBox.show();
    }
}

async function acceptSearch(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, state: SearchState) {
    updateArgs({ ...state.args, text: state.text });
    if(state.stop){ state.stop(); }
    state.searchFrom = editor.selections;
    await setKeyContext({name: 'mode', value: state.oldMode, transient: false});

    let skip = (state.args.skip || 0);
    if(skip > 0){
        await nextMatch(editor, edit, {register: state.args.register, repeat: state.args.skip});
    }
    if(state.args.doAfter){
        await runCommands({do: state.args.doAfter});
    }
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.search', search));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.acceptSearch', acceptSearch));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.cancelSearch', cancelSearch));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.deleteLastSearchChar', deleteLastSearchCharacter));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.nextMatch', nextMatch));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.previousMatch', previousMatch));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.clearSearchDecorations', clearSearchDecorations));
    updateSearchHighlights();
    vscode.workspace.onDidChangeConfiguration(updateSearchHighlights);
}

async function cancelSearch(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
    let state = getSearchState(editor);
    if (keyState.values.mode === 'capture'){
        setKeyContext({name: 'mode', value: state.oldMode, transient: false});
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            if(state.searchFrom){ editor.selections = state.searchFrom; }
            revealActive(editor);
        }
    }
    if(state.stop){ state.stop(); }
}

function deleteLastSearchCharacter(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
    let state = getSearchState(editor);
    state.text = state.text.slice(0, -1);
    navigateTo(state, editor);
}


export function revealActive(editor: vscode.TextEditor){
    let act = new vscode.Range(editor.selection.active, editor.selection.active);
    // TODO: make this customizable
    editor.revealRange(act, vscode.TextEditorRevealType.InCenter);
}

const matchStepArgs = z.object({register: z.string().default("default"), repeat: z.number().min(0).optional() });
async function nextMatch(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, args_: unknown){
    let args = validateInput('master-key.nextMatch', args_, matchStepArgs);
    if(!args) { return; }
    let state = getSearchState(editor, args!.register);
    if (state.text) {
        for(let i=0; i<(args.repeat || 1); i++){ navigateTo(state, editor); }
        revealActive(editor);
    }
}

async function previousMatch(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, args_: unknown){
    let args = validateInput('master-key.previousMatch', args_, matchStepArgs);
    if(!args) { return; }
    let state = getSearchState(editor, args!.register);
    if (state.text) {
        state.args.backwards = !state.args.backwards;
        for(let i=0; i<(args.repeat || 1); i++){ navigateTo(state, editor); }
        revealActive(editor);
        state.args.backwards = !state.args.backwards;
    }
}
