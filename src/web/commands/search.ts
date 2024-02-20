import * as vscode from 'vscode';
import z from 'zod';
import { validateInput, wrappedTranslate } from '../utils';
import { doArgs } from '../keybindings/parsing';
import { CommandResult, CommandState, wrapStateful } from '../state';
import { MODE } from './mode';
import { captureKeys } from './capture';

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

export function* searchMatches(doc: vscode.TextDocument, start: vscode.Position,
    end: vscode.Position | undefined, target: string, args: SearchArgs) {

    let matchesFn: (line: string, offset: number | undefined) => Generator<[number, number]>;
    if (args.regex) {
        let matcher = RegExp(target, "g" + (args.caseSensitive ? "" : "i"));
        matchesFn = (line, offset) => regexMatches(matcher, line, !args.backwards, offset);
    } else {
        let matcher = args.caseSensitive ? target : target.toLowerCase();
        matchesFn = (line, offset) => stringMatches(matcher, !!args.caseSensitive, line,
            !args.backwards, offset);
    }

    let offset: number | undefined = start.character;
    for (const [line, i] of linesOf(doc, start, args.wrapAround || false, !args.backwards)) {
        if (end && i > end.line) { return; }

        let matchesItr = matchesFn(line, offset);
        let matches = !args.backwards ? matchesItr : Array.from(matchesItr).reverse();

        yield* mapIter(matches, ([start, len]) => new vscode.Range(
            new vscode.Position(i, start),
            new vscode.Position(i, start + len)
        ));
        offset = undefined;
    }
}

function* mapIter<T, R>(iter: Iterable<T>, fn: (x: T) => R){
    for(const x of iter){
        yield fn(x);
    }
}

function* linesOf(doc: vscode.TextDocument, pos: vscode.Position,
    wrap: boolean, forward: boolean): Generator<[string, number]>{

    yield [doc.lineAt(pos).text, pos.line];
    let line = pos.line + (forward ? 1 : -1);
    while(forward ? line < doc.lineCount : line >= 0){
        yield [doc.lineAt(line).text, line];
        line += (forward ? 1 : -1);
    }
    if(wrap){
        line = forward ? 0 : doc.lineCount - 1;
        while(forward ? line < doc.lineCount : line > 0){
            yield [doc.lineAt(line).text, line];
            line += (forward ? 1 : -1);
        }
    }
}

function* regexMatches(matcher: RegExp, line: string, forward: boolean,
    offset: number | undefined): Generator<[number, number]>{
    matcher.lastIndex = 0;
    let match = matcher.exec(line);
    while(match){
        if(offset && !forward && match.index > offset){ return; }
        if(offset === undefined || !forward || match.index > offset){
            yield [match.index, match[0].length];
        }
        let newmatch = matcher.exec(line);
        if(newmatch && newmatch.index > match.index){
            match = newmatch;
        }else{
            match = null;
        }
    }
}

function* stringMatches(matcher: string, caseSensitive: boolean, line: string, forward: boolean,
    offset: number | undefined): Generator<[number, number]>{

    let searchMe = offset === undefined ? line :
        (forward ? line.substring(offset) : line.substring(0, offset - 1));
    let fromOffset = offset === undefined ? 0 : (forward ? offset : 0);
    if(!caseSensitive){ searchMe = searchMe.toLowerCase(); }
    let from = searchMe.indexOf(matcher, 0);
    while(from >= 0){
        yield [from + fromOffset, matcher.length];
        from = searchMe.indexOf(matcher, from+1);
    }
}

let searchDecorator: vscode.TextEditorDecorationType;
let searchOtherDecorator: vscode.TextEditorDecorationType;

interface SearchState{
    args: SearchArgs;
    text: string;
    searchFrom: readonly vscode.Selection[];
    oldMode: string;
}

let searchStates: Map<vscode.TextEditor, Record<string, SearchState>> = new Map();
let currentSearch: string = "default";
let searchStateUsed = false;
export function trackSearchUsage(){ searchStateUsed = false; }
export function wasSearchUsed(){ return searchStateUsed; }
function getSearchState(state: CommandState, editor: vscode.TextEditor, register: string): SearchState{
    searchStateUsed = true;
    let statesForEditor = searchStates.get(editor);
    statesForEditor = statesForEditor ? statesForEditor : {};
    if(!statesForEditor[register]){
        let searchState: SearchState = {
            args: searchArgs.parse({}),
            text: "",
            searchFrom: [],
            oldMode: state.get<string>(MODE, 'insert')!
        };
        statesForEditor[register] = searchState;
        searchStates.set(editor, statesForEditor);
        return searchState;
    }else{
        return statesForEditor[register];
    }
}

/**
 * The actual search functionality is located in this helper function. It is
 * used by the actual search command plus the commands that jump to next and
 * previous match.
 *
 * The search starts from positions specified by the `selections` argument. If
 * there are multilple selections (cursors) active, multiple searches are
 * performed. Each cursor location is considered separately, and the next match
 * from that position is selected. The function does *not* make sure that found
 * matches are unique. In case the matches overlap, the number of selections
 * will decrease.
 */
function navigateTo(state: SearchState, editor: vscode.TextEditor, updateSearchFrom: boolean = true) {
    if (state.text === ""){
        /**
         * If search string is empty, we return to the start positions.
         * (clearing the decorators)
         */
        editor.selections = state.searchFrom;
        editor.setDecorations(searchDecorator, []);
        editor.setDecorations(searchOtherDecorator, []);
    }else {
        let doc = editor.document;

        /**
         * searchRanges keeps track of where the searches land
         * (so we can highlight them later on)
         */
        let searchRanges: vscode.Range[] = [];

        if(updateSearchFrom){ state.searchFrom = editor.selections; }

        editor.selections = state.searchFrom.map(sel => {
            let matches = searchMatches(doc, sel.active, undefined, state.text, state.args);
            let result = matches.next();
            let newSel = sel;
            while(!result.done){
                let [active, anchor] = state.args.backwards ?
                    [result.value.start, result.value.end] :
                    [result.value.end, result.value.start];
                newSel = adjustSearchPosition(new vscode.Selection(anchor, active), doc,
                    result.value.end.character - result.value.start.character,
                    state.args);
                if (state.args.selectTillMatch){
                    newSel = new vscode.Selection(sel.anchor, newSel.active);
                }

                if(!newSel.start.isEqual(sel.start) || !newSel.end.isEqual(sel.end)) { break; }

                result = matches.next();
            }
            if(result.done){
                // TODO: have a discreted place to say "Pattern not found"
                // this is what gets called when there is no match
                return sel;
            }else{
                searchRanges.push(result.value);

                return newSel;
            }
        });

        revealActive(editor);

        /**
         * Finally, we highlight all search matches to make them stand out in the document.
         * To accomplish this, we look for any matches that are currently visible and mark
         * them; we want to mark those that aren't a "current" match (found above)
         * differently so we make sure that they are not part of `searchRanges`
         */
         if(state.args.highlightMatches !== false){
            let searchOtherRanges: vscode.Range[] = [];
            editor.visibleRanges.forEach(range => {
                let matches = searchMatches(doc, range.start, range.end, state.text,
                    {...state.args, backwards: false});
                for(const matchRange of matches){
                    if(!searchRanges.find(x =>
                        x.start.isEqual(matchRange.start) && x.end.isEqual(matchRange.end))){
                        searchOtherRanges.push(matchRange);
                    }
                }
            });

            /**
             * Now, we have the search ranges; so highlight them appropriately
             */
            editor.setDecorations(searchDecorator, searchRanges);
            editor.setDecorations(searchOtherDecorator, searchOtherRanges);
        }
    }
}

/**
 * ### Search Decorations
 *
 * We determine how searches are highlighted whenever the configuration changes by callin
 * this function; searches are highlighted by default using the same colors as used for
 * built-in search commands.
 */
function updateSearchHighlights(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let matchBackground = config.get<string>('searchMatchBackground');
        let matchBorder = config.get<string>('searchMatchBorder');
        let highlightBackground = config.get<string>('searchOtherMatchesBackground');
        let highlightBorder = config.get<string>('searchOtherMatchesBorder');

        searchDecorator = vscode.window.createTextEditorDecorationType({
            backgroundColor: matchBackground ||
                new vscode.ThemeColor('editor.findMatchBackground'),
            borderColor: matchBorder ||
                new vscode.ThemeColor('editor.findMatchBorder'),
            borderStyle: "solid"
        });

        searchOtherDecorator = vscode.window.createTextEditorDecorationType({
            backgroundColor: highlightBackground ||
                new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            borderColor: highlightBorder ||
                new vscode.ThemeColor('editor.findMatchHighlightBorder'),
            borderStyle: "solid"
        });
    }
}

function adjustSearchPosition(sel: vscode.Selection, doc: vscode.TextDocument, len: number, args: SearchArgs){
    let offset = 0;
    let forward = !args.backwards;
    if(args.offset === 'exclusive'){
        offset = forward ? -len : len;
        if(!args.selectTillMatch) { offset += forward ? -1 : 0; }
    }else if(args.offset === 'start'){
        if(forward){ offset = -len; }
    }else if(args.offset === 'end'){
        if(!forward){ offset = len; }
    }else{ // args.offset === 'inclusive' (default)
        if(!args.selectTillMatch){
            offset += forward ? -1 : 0;
        }
    }

    if(offset !== 0){
        let newpos = wrappedTranslate(sel.active, doc, offset);
        return new vscode.Selection(args.selectTillMatch ? sel.anchor : newpos, newpos);
    }
    return sel;
}

function clearSearchDecorations(editor: vscode.TextEditor){
    editor.setDecorations(searchDecorator, []);
    editor.setDecorations(searchOtherDecorator, []);
}

const SEARCH_CHANGED = 'searchChanged';

async function search(commandState: CommandState, editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: any[]): Promise<CommandResult> {

    let args = validateInput('master-key.search', args_, searchArgs);
    if(!args){ return [undefined, commandState]; }

    // clear old search decorators if they exist
    commandState.set(SEARCH_CHANGED, false, {});
    commandState.resolve();

    // set up to clear search decorators on a future command that doesn't set
    // `SEARCH_CHANGED`
    commandState.set(SEARCH_CHANGED, true, {transient: true});
    commandState.onResolve('search', async (state: CommandState) => {
        if(state.get<boolean>(SEARCH_CHANGED, false)){ clearSearchDecorations(editor); }
        return true;
    });

    currentSearch = args.register;
    let state = getSearchState(commandState, editor, args.register);
    state.args = args;
    state.text = args.text || "";
    state.searchFrom = editor.selections;

    if(state.text.length > 0){
        navigateTo(state, editor);
        state.searchFrom = editor.selections;
    } else {
        commandState.set(MODE, 'capture', {public: true});
        // when there are a fixed number of keys use `type` command
        if (state.args.acceptAfter) {
            let acceptAfter = state.args.acceptAfter;
            let stop = false;
            state.text = await captureKeys(commandState, (result, char) => {
                if (char === "\n") { stop = true; }
                else {
                    result += char;
                    navigateTo(state, editor, false);
                    if (state.text.length >= acceptAfter) { stop = true; }
                    // there are other-ways to cancel key capturing so we need to update
                    // the arguments on every keypress
                }
                return [result, stop];
            });
            if (!state.text) { return ["cancel", commandState]; }
        } else {
            let accepted = false;
            let inputResult = new Promise<string>((resolve, reject) => {
                let text = "";
                try {
                    let inputBox = vscode.window.createInputBox();
                    if (state.args.regex) {
                        inputBox.title = "Regex Search";
                        inputBox.prompt = "Enter regex to search for";
                    } else {
                        inputBox.title = "Search";
                        inputBox.prompt = "Enter text to search for";
                    }
                    inputBox.onDidChangeValue((str: string) => {
                        text = str;
                        navigateTo(state, editor, false);
                    });
                    inputBox.onDidAccept(() => {
                        state.searchFrom = editor.selections;
                        inputBox.dispose();
                        accepted = true;
                        resolve(text);
                    });
                    inputBox.onDidHide(() => { if (!accepted) { text = ""; } });
                    inputBox.show();
                } catch (e) {
                    reject(e);
                }
            });
            state.text = await inputResult;
        }
        commandState.set(MODE, state.oldMode, {public: true});
    }
    if(state.text){
        return [{...state.args, text: state.text}, commandState];
    }else{
        commandState.set(MODE, state.oldMode, {public: true});
        return ["cancel", commandState];
    }
}

export function revealActive(editor: vscode.TextEditor){
    let act = new vscode.Range(editor.selection.active, editor.selection.active);
    // TODO: make this customizable
    editor.revealRange(act, vscode.TextEditorRevealType.InCenter);
}

const matchStepArgs = z.object({register: z.string().default("default"), repeat: z.number().min(0).optional() });
async function nextMatch(commandState: CommandState, editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: unknown): Promise<CommandResult> {

    let args = validateInput('master-key.nextMatch', args_, matchStepArgs);
    if(!args) { return [undefined, commandState]; }
    commandState.set(SEARCH_CHANGED, true, {transient: true});
    let state = getSearchState(commandState, editor, args!.register);
    if (state.text) {
        for(let i=0; i<(args.repeat || 1); i++){ navigateTo(state, editor); }
        revealActive(editor);
    }
    return [undefined, commandState];
}

async function previousMatch(commandState: CommandState, editor: vscode.TextEditor,
    edit: vscode.TextEditorEdit, args_: unknown): Promise<CommandResult> {

    let args = validateInput('master-key.previousMatch', args_, matchStepArgs);
    if(!args) { return [undefined, commandState]; }
    commandState.set(SEARCH_CHANGED, true, {transient: true});
    let state = getSearchState(commandState, editor, args!.register);
    if (state.text) {
        state.args.backwards = !state.args.backwards;
        for(let i=0; i<(args.repeat || 1); i++){ navigateTo(state, editor); }
        revealActive(editor);
        state.args.backwards = !state.args.backwards;
    }
    return [undefined, commandState];
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.search', wrapStateful(search)));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.nextMatch', wrapStateful(nextMatch)));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.previousMatch', wrapStateful(previousMatch)));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('master-key.clearSearchDecorations', clearSearchDecorations));
    updateSearchHighlights();
    vscode.workspace.onDidChangeConfiguration(updateSearchHighlights);
}
