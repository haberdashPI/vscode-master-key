import * as vscode from 'vscode';
import z from 'zod';
import { validateInput, wrappedTranslate } from '../utils';
import { withState, CommandResult, recordedCommand, onSet } from '../state';
import { MODE, defaultMode } from './mode';
import { captureKeys } from './capture';
import { COMMAND_HISTORY } from './do';

/**
 * @command search
 * @section Searching for Strings
 * @order 120
 *
 * Moves cursor (and possibly the selection) to matching string (or regex).
 *
 * **Arguments**
 * - `text`: The text to search for; if left blank, search string is requested from user
 * - `acceptAfter` (optional): If specified, limits the number of characters required from
 *   the user to the given number.
 * - `backwards` (default=false): Whether to search forward (default) or backwards from
 *   cursor position
 * - `caseSensitive` (default=false): Whether the search-string matching is sensitive to the
 *   case of letters.
 * - `regex` (default=false): If true the provided search text will be interpreted as a
 *   regular expression
 * - `wrapAround`: (default=false): If true search will wrap back to the top of the file
 *    when hitting the end of the file, and back to the bottom when hitting the top.
 * - `selectTillMatch` (default=false): If true, all text from the current cursor position
 *   up until the searched-to position will be highlighted.
 * - `highlightMatches` (default=true): If true search-string matches visible in the editor
 *   will be highlighted.
 * - `offset` (default='exclusive'): determines where the cursor will land with respect to
 *   the search match. The possible values are:
 *   - `inclusive`: when search is moving forward the cursor will land right before the
 *      first character and otherwise it will land right after the last character
 *   - `exclusive`: like inclusive` except the cursor lands directly on the target character
 *      rather than to one side or the other
 *   - `start`: cursor will land on the first character of the match
 *   - `end`: cursor will land on the last character of the match
 * - `register` (default="default"): Determine what storage register repeated search
 *    commands (`nextMatch`/`previousMatch`) use. If you have multiple search commands you
 *    can use registers to avoid the two commands using the same search state.
 * - `skip` (default=0): the number of matches to skip before stopping.
 */

export const searchArgs = z.
    object({
        text: z.string().min(1).optional(),
        acceptAfter: z.number().min(1).optional(),
        backwards: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        regex: z.boolean().optional(),
        wrapAround: z.boolean().optional(),
        selectTillMatch: z.boolean().optional(),
        highlightMatches: z.boolean().default(true).optional(),
        offset: z.enum(['inclusive', 'exclusive', 'start', 'end']).default('exclusive'),
        register: z.string().default('default'),
        skip: z.number().optional().default(0),
    }).
    strict();
export type SearchArgs = z.infer<typeof searchArgs>;

export function* searchMatches(
    doc: vscode.TextDocument,
    start: vscode.Position,
    end: vscode.Position | undefined,
    target: string,
    args: SearchArgs,
) {
    let matchesFn: (
        line: string,
        offset: number | undefined
    ) => Generator<[number, number]>;
    if (args.regex) {
        const matcher = RegExp(target, 'g' + (args.caseSensitive ? '' : 'i'));
        matchesFn = (line, offset) => regexMatches(matcher, line, !args.backwards, offset);
    } else {
        const matcher = args.caseSensitive ? target : target.toLowerCase();
        matchesFn = (line, offset) =>
            stringMatches(matcher, !!args.caseSensitive, line, !args.backwards, offset);
    }

    let offset: number | undefined = start.character;
    for (const [line, i] of linesOf(
        doc,
        start,
        args.wrapAround || false,
        !args.backwards,
    )) {
        if (end && i > end.line) {
            return;
        }

        const matchesItr = matchesFn(line, offset);
        const matches = !args.backwards ? matchesItr : Array.from(matchesItr).reverse();

        yield* mapIter(
            matches,
            ([start, len]) =>
                new vscode.Range(
                    new vscode.Position(i, start),
                    new vscode.Position(i, start + len),
                ),
        );
        offset = undefined;
    }
}

function* mapIter<T, R>(iter: Iterable<T>, fn: (x: T) => R) {
    for (const x of iter) {
        yield fn(x);
    }
}

function* linesOf(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    wrap: boolean,
    forward: boolean,
): Generator<[string, number]> {
    yield [doc.lineAt(pos).text, pos.line];
    let line = pos.line + (forward ? 1 : -1);
    while (forward ? line < doc.lineCount : line >= 0) {
        yield [doc.lineAt(line).text, line];
        line += forward ? 1 : -1;
    }
    if (wrap) {
        line = forward ? 0 : doc.lineCount - 1;
        while (forward ? line < doc.lineCount : line > 0) {
            yield [doc.lineAt(line).text, line];
            line += forward ? 1 : -1;
        }
    }
}

function* regexMatches(
    matcher: RegExp,
    line: string,
    forward: boolean,
    offset: number | undefined,
): Generator<[number, number]> {
    matcher.lastIndex = 0;
    let match = matcher.exec(line);
    while (match) {
        if (offset && !forward && match.index > offset) {
            return;
        }
        if (offset === undefined || !forward || match.index > offset) {
            yield [match.index, match[0].length];
        }
        const newmatch = matcher.exec(line);
        if (newmatch && newmatch.index > match.index) {
            match = newmatch;
        } else {
            match = null;
        }
    }
}

function* stringMatches(
    matcher: string,
    caseSensitive: boolean,
    line: string,
    forward: boolean,
    offset: number | undefined,
): Generator<[number, number]> {
    let searchMe =
        offset === undefined ?
            line :
            forward ?
                    line.substring(offset) :
                    line.substring(0, offset - 1);
    const fromOffset = offset === undefined ? 0 : forward ? offset : 0;
    if (!caseSensitive) {
        searchMe = searchMe.toLowerCase();
    }
    let from = searchMe.indexOf(matcher, 0);
    while (from >= 0) {
        yield [from + fromOffset, matcher.length];
        from = searchMe.indexOf(matcher, from + 1);
    }
}

let searchDecorator: vscode.TextEditorDecorationType;
let searchOtherDecorator: vscode.TextEditorDecorationType;

class SearchState {
    args: SearchArgs;
    _text: string = '';
    _searchFrom: readonly vscode.Selection[] = [];
    oldMode: string;
    modified = false;
    constructor(args: SearchArgs, mode: string) {
        this.args = args;
        this.oldMode = mode;
    }

    get text() {
        return this._text;
    }

    set text(str: string) {
        this._text = str;
        this.modified = true;
    }

    get searchFrom() {
        return this._searchFrom;
    }

    set searchFrom(sel: readonly vscode.Selection[]) {
        this._searchFrom = sel || [];
        this.modified = true;
    }
}

const searchStates: Map<vscode.TextEditor, Record<string, SearchState>> = new Map();
let currentSearch: string = 'default';
function getSearchState(
    editor: vscode.TextEditor,
    mode: string,
    register: string,
): SearchState {
    let statesForEditor = searchStates.get(editor);
    statesForEditor = statesForEditor ? statesForEditor : {};
    if (!statesForEditor[register]) {
        const searchState = new SearchState(searchArgs.parse({}), mode);
        statesForEditor[register] = searchState;
        searchStates.set(editor, statesForEditor);
        return searchState;
    } else {
        const state = statesForEditor[register];
        state.oldMode = mode !== 'capture' ? mode : state.oldMode;
        return state;
    }
}

function getOldSearchState(
    editor: vscode.TextEditor,
    register: string,
): SearchState | undefined {
    let statesForEditor = searchStates.get(editor);
    statesForEditor = statesForEditor ? statesForEditor : {};
    return statesForEditor[register];
}
function navigateTo(
    state: SearchState,
    editor: vscode.TextEditor,
    updateSearchFrom: boolean = true,
) {
    if (state.text === '') {
        /**
         * If search string is empty, we return to the start positions.
         * (clearing the decorators)
         */
        editor.selections = state.searchFrom;
        editor.setDecorations(searchDecorator, []);
        editor.setDecorations(searchOtherDecorator, []);
    } else {
        state.modified = true;
        const doc = editor.document;

        /**
         * searchRanges keeps track of where the searches land
         * (so we can highlight them later on)
         */
        const searchRanges: vscode.Range[] = [];

        if (updateSearchFrom) {
            state.searchFrom = editor.selections;
        }

        editor.selections = state.searchFrom.map((sel) => {
            const matches = searchMatches(
                doc,
                sel.active,
                undefined,
                state.text,
                state.args,
            );
            let result = matches.next();
            let newSel = sel;
            while (!result.done) {
                const [active, anchor] = state.args.backwards ?
                        [result.value.start, result.value.end] :
                        [result.value.end, result.value.start];
                newSel = adjustSearchPosition(
                    new vscode.Selection(anchor, active),
                    doc,
                    result.value.end.character - result.value.start.character,
                    state.args,
                );
                if (state.args.selectTillMatch) {
                    newSel = new vscode.Selection(sel.anchor, newSel.active);
                }

                if (!newSel.start.isEqual(sel.start) || !newSel.end.isEqual(sel.end)) {
                    break;
                }

                result = matches.next();
            }
            if (result.done) {
                // TODO: have a discreted place to say "Pattern not found"
                // this is what gets called when there is no match
                return sel;
            } else {
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
        if (state.args.highlightMatches !== false) {
            const searchOtherRanges: vscode.Range[] = [];
            editor.visibleRanges.forEach((range) => {
                const matches = searchMatches(doc, range.start, range.end, state.text, {
                    ...state.args,
                    backwards: false,
                });
                for (const matchRange of matches) {
                    if (
                        !searchRanges.find(
                            x =>
                                x.start.isEqual(matchRange.start) &&
                                x.end.isEqual(matchRange.end),
                        )
                    ) {
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

function updateSearchHighlights(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        const matchBackground = config.get<string>('searchMatchBackground');
        const matchBorder = config.get<string>('searchMatchBorder');
        const highlightBackground = config.get<string>('searchOtherMatchesBackground');
        const highlightBorder = config.get<string>('searchOtherMatchesBorder');

        searchDecorator = vscode.window.createTextEditorDecorationType({
            backgroundColor:
                matchBackground || new vscode.ThemeColor('editor.findMatchBackground'),
            borderColor: matchBorder || new vscode.ThemeColor('editor.findMatchBorder'),
            borderStyle: 'solid',
        });

        searchOtherDecorator = vscode.window.createTextEditorDecorationType({
            backgroundColor:
                highlightBackground ||
                new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            borderColor:
                highlightBorder || new vscode.ThemeColor('editor.findMatchHighlightBorder'),
            borderStyle: 'solid',
        });
    }
}

function adjustSearchPosition(
    sel: vscode.Selection,
    doc: vscode.TextDocument,
    len: number,
    args: SearchArgs,
) {
    let offset = 0;
    const forward = !args.backwards;
    if (args.offset === 'exclusive') {
        offset = forward ? -len : len;
        if (!args.selectTillMatch) {
            offset += forward ? -1 : 0;
        }
    } else if (args.offset === 'start') {
        if (forward) {
            offset = -len;
        }
    } else if (args.offset === 'end') {
        if (!forward) {
            offset = len;
        }
    } else {
        // args.offset === 'inclusive' (default)
        if (!args.selectTillMatch) {
            offset += forward ? -1 : 0;
        }
    }

    if (offset !== 0) {
        const newpos = wrappedTranslate(sel.active, doc, offset);
        return new vscode.Selection(args.selectTillMatch ? sel.anchor : newpos, newpos);
    }
    return sel;
}

function clearSearchDecorations(editor: vscode.TextEditor) {
    editor.setDecorations(searchDecorator, []);
    editor.setDecorations(searchOtherDecorator, []);
}

function skipTo(state: SearchState, editor: vscode.TextEditor) {
    const skip = state.args.skip || 0;
    if (skip > 0) {
        for (let i = 0; i < skip; i++) {
            navigateTo(state, editor);
        }
    }
}

function searchDecorationCheck() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const searchState = getOldSearchState(editor, currentSearch);
        if (searchState) {
            if (!searchState.modified) {
                clearSearchDecorations(editor);
            }
            searchState.modified = false;
        }
    }
    return true;
}

async function search(args_: unknown[]): Promise<CommandResult> {
    const editor_ = vscode.window.activeTextEditor;
    if (!editor_) {
        return;
    }
    const editor = editor_!;

    const args = validateInput('master-key.search', args_, searchArgs);
    if (!args) {
        return;
    }
    currentSearch = args.register;

    let mode = '';
    await withState(async (state) => {
        mode = state.get(MODE, defaultMode)!;
        return state;
    });
    const state = getSearchState(editor, mode, currentSearch);
    state.args = args;
    state.text = args.text || '';
    state.searchFrom = editor.selections;

    if (state.text.length > 0) {
        navigateTo(state, editor);
        skipTo(state, editor);
        state.searchFrom = editor.selections;
    } else {
        // when there are a fixed number of keys use `type` command
        if (state.args.acceptAfter) {
            const acceptAfter = state.args.acceptAfter;
            let stop = false;
            state.text = await captureKeys((result, char) => {
                if (char === '\n') {
                    stop = true;
                } else {
                    result += char;
                    state.text = result;
                    navigateTo(state, editor, false);
                    if (state.text.length >= acceptAfter) {
                        stop = true;
                    }
                    // there are other-ways to cancel key capturing so we need to update
                    // the arguments on every keypress
                }
                return [result, stop];
            });
            if (!state.text) {
                return 'cancel';
            }
            skipTo(state, editor);
        } else {
            await withState(async (state) => {
                return state.set(MODE, { public: true }, 'capture').resolve();
            });
            let accepted = false;
            const inputResult = new Promise<string>((resolve, reject) => {
                try {
                    const inputBox = vscode.window.createInputBox();
                    if (state.args.regex) {
                        inputBox.title = 'Regex Search';
                        inputBox.prompt = 'Enter regex to search for';
                    } else {
                        inputBox.title = 'Search';
                        inputBox.prompt = 'Enter text to search for';
                    }
                    inputBox.onDidChangeValue(async (str: string) => {
                        state.text = str;
                        navigateTo(state, editor, false);
                    });
                    inputBox.onDidAccept(() => {
                        state.searchFrom = editor.selections;
                        accepted = true;
                        inputBox.dispose();
                    });
                    inputBox.onDidHide(() => {
                        if (!accepted) {
                            state.text = '';
                        }
                        resolve(state.text);
                    });
                    inputBox.show();
                } catch (e) {
                    reject(e);
                }
            });
            await inputResult;
            await skipTo(state, editor);
        }
        await withState(async (st) => {
            return st.set(MODE, { public: true }, state.oldMode).resolve();
        });
    }
    if (state.text) {
        return { ...state.args, text: state.text };
    } else {
        editor.selections = state.searchFrom;
        revealActive(editor, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        await withState(async (st) => {
            return st.set(MODE, { public: true }, state.oldMode).resolve();
        });
        return 'cancel';
    }
}

export function revealActive(
    editor: vscode.TextEditor,
    revealType?: vscode.TextEditorRevealType,
) {
    const act = new vscode.Range(editor.selection.active, editor.selection.active);
    // TODO: make this customizable
    editor.revealRange(act, revealType);
}

const matchStepArgs = z.object({
    register: z.string().default('default'),
    repeat: z.number().min(0).optional(),
});

/**
 * @command nextMatch
 * @order 120
 *
 * Find the next match of the most recently executed run of `master-key.search`
 *
 * **Arguments**
 * - `register` (default="default"): Determine what storage register repeated search
 *    commands use. If you have multiple search commands you can use registers to avoid the
 *    two commands using the same search state.
 * - `repeat`: how many matches to skip before stopping
 */

async function nextMatch(
    editor: vscode.TextEditor,
    _edit: vscode.TextEditorEdit,
    args_: unknown,
): Promise<CommandResult> {
    const args = validateInput('master-key.nextMatch', args_, matchStepArgs);
    if (!args) {
        return;
    }
    let mode = '';
    await withState(async (state) => {
        mode = state.get(MODE, defaultMode)!;
        return state;
    });
    const state = getSearchState(editor, mode, args!.register);
    if (state.text) {
        for (let i = 0; i < (args.repeat || 1); i++) {
            navigateTo(state, editor);
        }
        revealActive(editor);
    }
    return;
}

/**
 * @command previousMatch
 * @order 120
 *
 * Find the previous match of the most recently executed run of `master-key.search`
 *
 * **Arguments**
 * - `register` (default="default"): Determine what storage register repeated search
 *    commands use. If you have multiple search commands you can use registers to avoid the
 *    two commands using the same search state.
 * - `repeat`: how many matches to skip before stopping
 */

async function previousMatch(
    editor: vscode.TextEditor,
    _edit: vscode.TextEditorEdit,
    args_: unknown,
): Promise<CommandResult> {
    const args = validateInput('master-key.previousMatch', args_, matchStepArgs);
    if (!args) {
        return;
    }
    let mode = '';
    await withState(async (state) => {
        mode = state.get(MODE, defaultMode)!;
        return state;
    });
    const state = getSearchState(editor, mode, args!.register);
    if (state.text) {
        state.args.backwards = !state.args.backwards;
        for (let i = 0; i < (args.repeat || 1); i++) {
            navigateTo(state, editor);
        }
        revealActive(editor);
        state.args.backwards = !state.args.backwards;
    }
    return;
}

export async function activate(context: vscode.ExtensionContext) {
    // NOTE: `search` must be registered as a normal command, so that its result is returned
    // we need it when call `executeCommand` in `doCommand`.
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.search', recordedCommand(search)),
    );
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(
            'master-key.nextMatch',
            recordedCommand(nextMatch),
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(
            'master-key.previousMatch',
            recordedCommand(previousMatch),
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(
            'master-key.clearSearchDecorations',
            clearSearchDecorations,
        ),
    );
    updateSearchHighlights();
    vscode.workspace.onDidChangeConfiguration(updateSearchHighlights);

    await onSet(COMMAND_HISTORY, _ => searchDecorationCheck());
}
