import * as vscode from 'vscode';
import z from 'zod';
import { validateInput, wrappedTranslate } from '../utils';
import { state as keyState, CommandResult, recordedCommand } from '../state';
import { MODE } from './mode';
import { captureKeys } from './capture';
import { bindings } from '../keybindings/config';
import { onCommandComplete, showCommandWarnings } from './do';

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
 *   up until the searched-to position will be highlighted. (Technically this means that the
 *   final character position of the cursor is one character further)
 * - `highlightMatches` (default=true): If true search-string matches visible in the editor
 *   will be highlighted.
 * - `offset` (default=`'closerBoundary'`): determines where the cursor will land with
 *   respect to the search match. The possible values are:
 *   - `'closerBoundary'`: move selection or cursor to the boundary of the search term which
 *      is closer to the starting position. When moving forward this is at the
 *      start of the search term, and when moving backwards this is at the end of the search
 *      term.
 *   - `'fartherBoundary'`: move selection or cursor to the boundary of the search term that
 *      is farther from the starting position. When moving forward this is at
 *      the end of the search term, and when moving backwards this is at the start of the
 *      search term.
 *   - `'start'`: cursor will land on the first character of the match
 *   - `'end'`: cursor will land on the last character of the match
 *   - `{'from': [string], by: [number]}`: land on the character that is `by` steps away
 *     from the offset specified in 'from'. When `by` is 0, this is identical to specifying
 *     `from` as the `offset` (e.g. `{'from': 'start', 'by': 0}` is the same as `'start'`).
 *     The direction of movement implied by a positive value depends on the offset
 *     specified. The two boundary offsets (`closertBoundary` and `fartherBoundary`) imply
 *     an offset where positive values move in the same direction as search moved. `start`
 *     and `end` imply an offset where positive values move forward in the file and negative
 *     backwards.
 * - `register` (default="default"): A unique name determining where search state will be
 *    stored. Calls to (`nextMatch`/`previousMatch`) use this state to determine where to
 *    jump. If you have multiple search commands you can use registers to avoid the two
 *    commands using a shared search state.
 * - `skip` (default=0): the number of matches to skip before stopping.
 */

const offsets = z.enum([
    'fartherBoundary',
    'closerBoundary',
    'start',
    'end',
]);
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
        offset: offsets.default('closerBoundary').or(z.object({
            from: offsets,
            by: z.number(),
        })),
        register: z.string().default('default'),
        skip: z.number().optional().default(0),
    }).
    strict();
export type SearchArgs = z.infer<typeof searchArgs>;

export function* searchMatches(
    // the document to search
    doc: vscode.TextDocument,
    // the starting position to search from
    start: vscode.Position,
    // the limit on how far we can search to
    end: vscode.Position | undefined,
    // the string or regex we're searching for
    target: string,
    // arguments that configure the search behavior (as per `master-key.search` docs)
    args: SearchArgs,
) {
    // define what counts as a search match
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

    // loop through the document, finding matches and yielding them
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

// returns lines of the text document, with their line numbers
function* linesOf(
    // the document to process
    doc: vscode.TextDocument,
    // the position to start from
    pos: vscode.Position,
    // whether to wrap to the other side of a document when hitting the start or end
    wrap: boolean,
    // which direction to search
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

// extract regex matches from a line of text, returning the range of character indices
// on that line
function* regexMatches(
    // regex to match
    matcher: RegExp,
    // text to match to
    line: string,
    // direction to move
    forward: boolean,
    // from which character to start form (undefined implies we use match.index)
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

// extract regex matches from a line of text, returning the range of character indices
// on that line
function* stringMatches(
    // string to match
    matcher: string,
    // whether matching is case sensitive
    caseSensitive: boolean,
    // text to match to
    line: string,
    // direction to move
    forward: boolean,
    // from which character to start form (undefined implies we use match.index)
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

// holds state we need between steps of searching (e.g. for next and previous match)
class SearchState {
    // the original arguments used to search
    args: SearchArgs;
    // text to search by (maybe interpreted as a regex)
    _text: string = '';
    // where to start searching from next time
    _searchFrom: readonly vscode.Selection[] = [];
    // the keybinding mode prior to executing a search the mode during search execution may
    // be changed to `captured`, but when we're done searching we should revert to `oldMode`
    oldMode: string;
    // has the state changed? we use this to determine when to clear search decorators
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

// state is specific to the editor we're using
//
// TODO: does this really work well? I think using the hash here didn't help us much when we
// were trying to store edit state, so it may just never work for search either
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

// find the right search state for a given editor
function getOldSearchState(
    editor: vscode.TextEditor,
    register: string,
): SearchState | undefined {
    let statesForEditor = searchStates.get(editor);
    statesForEditor = statesForEditor ? statesForEditor : {};
    return statesForEditor[register];
}

// actually executes a search and updates decorators for that search as needed
function navigateToNextMatch(
    state: SearchState,
    editor: vscode.TextEditor,
    updateSearchFrom: boolean = true,
) {
    if (state.text === '') {
        // clear decorators that no longer apply
        editor.selections = state.searchFrom;
        clearSearchDecorations(editor);
    } else {
        state.modified = true;
        const doc = editor.document;

        // NOTE: searching operates on all cursors simultaneously; so we track a range where
        // the search landed for each cursor
        const searchRanges: vscode.Range[] = [];

        if (updateSearchFrom) {
            state.searchFrom = editor.selections;
        }

        // for each cursor...
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

// the actual updates for search decorators
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

// the exact location where the cursor/selection lands relative to the search match depends
// on the field `offset`. This is implemented by adjusting the search position given a
// search match
function adjustSearchPosition(
    // the current selection, prior to adjusting the search position
    sel: vscode.Selection,
    // the document where search is happening
    doc: vscode.TextDocument,
    // the length of the match
    len: number,
    // the original arguments for search
    args: SearchArgs,
) {
    let offset = 0;
    const forward = !args.backwards;
    const offsetType = typeof args.offset === 'string' ? args.offset : args.offset.from;
    const offsetAdjust = typeof args.offset === 'string' ? 0 : args.offset.by;

    if (offsetType === 'closerBoundary') {
        const dir = forward ? 1 : -1;
        offset = -dir * len;
        if (!args.selectTillMatch) {
            // WHY: because we want the *selection* to be at the boundary, not the cursor,
            // and when moving forward the cursor is at the start of a search term while the
            // selection is one before the start of the search term
            offset += forward ? -1 : 0;
        }
        offset += offsetAdjust * dir;
    } else if (offsetType === 'start') {
        if (forward) {
            offset = -len;
        }
        offset += offsetAdjust;
    } else if (offsetType === 'end') {
        if (!forward) {
            offset = len;
        }
        offset += offsetAdjust;
    } else {
        // offsetType === 'fartherBoundary'
        const dir = forward ? 1 : -1;
        if (!args.selectTillMatch) {
            // WHY: because we want the *selection* to be at the boundary, not the cursor,
            // and when moving forward the cursor is at the start of a search term while the
            // selection is one before the start of the search term
            offset += forward ? -1 : 0;
        }
        offset += offsetAdjust * dir;
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

// search can skip 0 or more matches, so we need to repeatedly jump to matches until we have
// skipped enough
function navigatePastSkippedMatches(state: SearchState, editor: vscode.TextEditor) {
    const skip = state.args.skip || 0;
    if (skip > 0) {
        for (let i = 0; i < skip; i++) {
            navigateToNextMatch(state, editor);
        }
    }
}

export function clearDecoratorsIfUnchanged() {
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

// the actual search command
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

    const mode: string = keyState.get(MODE) || bindings.default_mode();
    const state = getSearchState(editor, mode, currentSearch);
    state.args = args;
    state.text = args.text || '';
    state.searchFrom = editor.selections;

    if (state.text.length > 0) {
        navigateToNextMatch(state, editor);
        navigatePastSkippedMatches(state, editor);
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
                    navigateToNextMatch(state, editor, false);
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
            navigatePastSkippedMatches(state, editor);
        } else {
            keyState.set(MODE, 'capture');
            keyState.resolve();
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
                        navigateToNextMatch(state, editor, false);
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
            await navigatePastSkippedMatches(state, editor);
        }
        keyState.set(MODE, state.oldMode);
        keyState.resolve();
    }
    if (state.text) {
        return { ...state.args, text: state.text };
    } else {
        editor.selections = state.searchFrom;
        revealActive(editor, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        keyState.set(MODE, state.oldMode);
        keyState.resolve();
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
 * - `register` (default="default"): A unique name determining what search state will be
 *    used to determine where to jump. If you have multiple search commands you can use
 *    registers to avoid the two commands using a shared search state.
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
    const mode: string = keyState.get(MODE) || bindings.default_mode();
    const state = getSearchState(editor, mode, args!.register);
    if (state.text) {
        for (let i = 0; i < (args.repeat || 1); i++) {
            navigateToNextMatch(state, editor);
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
 * - `register` (default="default"): A unique name determining what search state will be
 *    used to determine where to jump. If you have multiple search commands you can use
 *    registers to avoid the two commands using a shared search state.
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
    const mode: string = keyState.get(MODE) || bindings.default_mode();
    const state = getSearchState(editor, mode, args!.register);
    if (state.text) {
        state.args.backwards = !state.args.backwards;
        for (let i = 0; i < (args.repeat || 1); i++) {
            navigateToNextMatch(state, editor);
        }
        revealActive(editor);
        state.args.backwards = !state.args.backwards;
    }
    return;
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
}

export async function activate(_context: vscode.ExtensionContext) {
    updateSearchHighlights();
    vscode.workspace.onDidChangeConfiguration(updateSearchHighlights);

    onCommandComplete(async () => {
        // after any command that does nothing to affect search state, we want to stop
        // displaying the matched search terms (e.g. `t s` will jump to the first `s`
        // character and `j` will move down a line. At that point no `s` characters should
        // be highlighted)
        clearDecoratorsIfUnchanged();
        return true;
    });
}

export async function defineCommands(context: vscode.ExtensionContext) {
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
}
