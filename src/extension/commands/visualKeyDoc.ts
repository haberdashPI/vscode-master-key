import { CommandState } from '../state';
import { state, onResolve } from '../state';
import * as vscode from 'vscode';
import { MODE } from './mode';
import { simplifyLayoutIndependentString } from '../keybindings/layout';
import { onSetBindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import {
    getRequiredMode,
    getRequiredPrefixCode,
    modifierKey,
    prettifyPrefix,
} from '../utils';
import { KeyFileResult } from '../../rust/parsing/lib/parsing';

// TODO: use KeyboardLayoutMap to improve behavior
// across different layouts

// properties of each key board key
interface IKeyTemplate {
    // the key name (e.g. A)
    name?: string;
    // the length (e.g. space is longer)
    length?: string;
    // what modifier does this key position have (e.g. shift, ctrl?)
    modifier?: boolean;
    // is this key on the first row? (it only has one binding instead of two for top and
    // bottom like the other rows)
    firstRow?: boolean;
    // the height of the key
    height?: string;
}

// the labels on individual keys
interface IKey {
    // what documentation is on the top half
    top?: string;
    // what documentation is on the bottom half
    bottom?: string;
    // the length of the key (e.g. space is longer)
    length?: string;
    // how tall is the key
    height?: string;
}

// define the keyboard
const keyRowsTemplate: IKeyTemplate[][] = [
    [
        { name: 'ESC', height: '0-5', firstRow: true },
        { name: 'F1', height: '0-5', firstRow: true },
        { name: 'F2', height: '0-5', firstRow: true },
        { name: 'F3', height: '0-5', firstRow: true },
        { name: 'F4', height: '0-5', firstRow: true },
        { name: 'F5', height: '0-5', firstRow: true },
        { name: 'F6', height: '0-5', firstRow: true },
        { name: 'F7', height: '0-5', firstRow: true },
        { name: 'F8', height: '0-5', firstRow: true },
        { name: 'F9', height: '0-5', firstRow: true },
        { name: 'F10', height: '0-5', firstRow: true },
        { name: 'F11', height: '0-5', firstRow: true },
        { name: 'F12', height: '0-5', firstRow: true },
    ],
    [
        { name: '`' },
        { name: '1' },
        { name: '2' },
        { name: '3' },
        { name: '4' },
        { name: '5' },
        { name: '6' },
        { name: '7' },
        { name: '8' },
        { name: '9' },
        { name: '0' },
        { name: '-' },
        { name: '=' },
        { name: 'DELETE', length: '1-5' },
    ],
    [
        { name: 'TAB', length: '1-5' },
        { name: 'Q' },
        { name: 'W' },
        { name: 'E' },
        { name: 'R' },
        { name: 'T' },
        { name: 'Y' },
        { name: 'U' },
        { name: 'I' },
        { name: 'O' },
        { name: 'P' },
        { name: '[' },
        { name: ']' },
        { name: '\\' },
    ],
    [
        { name: 'CAPS LOCK', length: '1-75', modifier: true },
        { name: 'A' },
        { name: 'S' },
        { name: 'D' },
        { name: 'F' },
        { name: 'G' },
        { name: 'H' },
        { name: 'J' },
        { name: 'K' },
        { name: 'L' },
        { name: ';' },
        { name: '\'' },
        { name: 'ENTER', length: '1-75' },
    ],
    [
        { name: 'SHIFT', length: '2-25', modifier: true },
        { name: 'Z' },
        { name: 'X' },
        { name: 'C' },
        { name: 'V' },
        { name: 'B' },
        { name: 'N' },
        { name: 'M' },
        { name: ',' },
        { name: '.' },
        { name: '/' },
        { name: 'SHIFT', length: '2-25', modifier: true },
    ],
    [
        {},
        {},
        {},
        { length: '1-25' },
        { length: '5', name: 'SPACE' },
        { length: '1-25' },
        {},
        {},
        {},
        {},
    ],
];

// given the modifiers for each row, generate the keys
function keyRows(
    topModifier?: readonly string[],
    bottomModifier?: readonly string[],
): IKey[][] {
    return keyRowsTemplate.map(row =>
        row.map((key) => {
            if (key.name && !key.modifier && !key.firstRow) {
                return {
                    top: topModifier?.join() + key.name,
                    bottom: bottomModifier?.join() + key.name,
                    length: key.length,
                    height: key.height,
                };
            } else {
                return {
                    bottom: key.name,
                    length: key.length,
                    height: key.height,
                };
            }
        }),
    );
}

// get the key from x if it exists, otherwise return def
function get<T extends object, K extends keyof T>(x: T, key: K, def: T[K]) {
    if (key in x && x[key] !== undefined) {
        return x[key];
    } else {
        return def;
    }
}

// [[kind]] information
interface KindDocEl {
    // the name of this `kind`
    name: string;
    // the longer description of this `kind`
    description: string;
    // the order in the TOML file of this `kind`
    index: number;
}

// the details of the binding as extracted from `[[bind]]`
interface IVisualKeyBinding {
    name?: string;
    description?: string;
    label?: string;
    kind?: string;
}

// generates the webview for a provider
export class DocViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'masterkey.visualDoc';
    _mode?: string;
    _prefixCode?: number;
    _view?: vscode.WebviewView;
    // nested map of prefix:mode -> key -> [[bind]] details
    _bindingMap: Record<string, Record<string, IVisualKeyBinding>> = {};
    _currentBindingKey: string = '0:';
    //  array of key descriptions as currently shown on the keyboard
    _keymap?: (IVisualKeyBinding | { empty: true })[] = [];
    _kinds?: Record<string, KindDocEl> = {};
    // modifiers are listed from most to least common, and the index indicates which of
    // these shows up first in the currently display of keybindings
    _modifierIndex: number = 0;
    // tracks the order of all modifiers for a given `prefix:mode` setting
    _modifierOrderMap: Record<string, string[][]> = {};
    // the ordering for the current `prefix:mode` (one of the values
    // of the above bindings)
    _modifierOrder: string[][] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    // let the webview know about updated bindings
    private refresh() {
        if (this._view?.webview) {
            this._view?.webview.postMessage({
                keymap: this._keymap,
                kinds: this._kinds,
                config: { colorBlind: false }, // TODO: remove or customize
            });
        }
    }

    // the modifiers that should show up on the top of the key
    public get topModifier(): readonly string[] {
        // get modifiers for current context
        const modifiers = this._modifierOrder || [[''], ['⇧']];
        const aModifiers = modifiers[this._modifierIndex % modifiers.length];
        const bModifiers = modifiers[(this._modifierIndex + 1) % modifiers.length];
        const aLength = aModifiers.map(x => x.length).reduce((x, y) => x + y);
        const bLength = bModifiers.map(x => x.length).reduce((x, y) => x + y);
        if (aLength > bLength) {
            return aModifiers;
        } else {
            return bModifiers;
        }
    }

    // the modifiers that should show up on the bottom of the key
    public get bottomModifier(): readonly string[] {
        // get modifiers for current context
        const modifiers = this._modifierOrder || [[''], ['⇧']];
        const aModifiers = modifiers[this._modifierIndex % modifiers.length];
        const bModifiers = modifiers[(this._modifierIndex + 1) % modifiers.length];
        const aLength = aModifiers.map(x => x.length).reduce((x, y) => x + y);
        const bLength = bModifiers.map(x => x.length).reduce((x, y) => x + y);
        if (aLength > bLength) {
            return bModifiers;
        } else {
            return aModifiers;
        }
    }

    // change which modifiers to show; we cycle from most to least common modifiers
    public toggleModifier() {
        this._modifierIndex = (this._modifierIndex + 2) % this._modifierOrder.length;

        // if there are an odd number of available modifiers the top / bottom will show both
        // the last key and the first key. So when we wrap around again we want to reset
        // back to the start (otherwise there will be a redundant, odd parity cycle through
        // all modifiers)
        if (this._modifierIndex % 2 == 1) {
            this._modifierIndex = 0;
        }
        this.updateKeyHelper();
        this.refresh();
    }

    // update all the private properties of this object to be consistent with
    // the newly defined `bindings`
    private updateKeys(bindings: KeyFileResult) {
        const modifierCounts: Record<string, Record<string, number>> = {};
        // compute the frequency of each combination of modifiers
        // conditioned on each `prefix:mode`
        for (let i = 0; i < bindings.n_bindings(); i++) {
            const binding = bindings.binding(i);
            if (binding?.command == 'master-key.ignore') {
                continue;
            }
            const mode = getRequiredMode(binding.when);
            const prefixCode = getRequiredPrefixCode(binding.when);
            const key = modifierKey(binding.key).sort().join('.');
            const countKey = `${prefixCode}:${mode}`;
            const countsForContext =
                modifierCounts[countKey] || { '': 0, '⇧': 0 };
            countsForContext[key] = get(countsForContext, key, 0) + 1;
            modifierCounts[countKey] = countsForContext;
        }
        // use the frequencies to construct an order
        this._modifierOrderMap = {};
        for (const [key, counts] of Object.entries(modifierCounts)) {
            let modifiers = Object.keys(counts);
            modifiers.sort((x, y) => counts[y] - counts[x]);
            if (modifiers.length > 2) {
                const front = modifiers.slice(0, 2);
                const back = modifiers.slice(2).filter(k => counts[k] > 0);
                modifiers = front.concat(back);
            }
            this._modifierOrderMap[key] = modifiers.map(x => x.split('.'));
        }
        this._modifierIndex = 0;

        // scan through all bindings to construct key binding documentation to visualize
        const bindingMap: Record<string, Record<string, IVisualKeyBinding>> = {};
        for (let i = 0; i < bindings.n_bindings(); i++) {
            const binding = bindings.binding(i);
            if (binding.command === 'master-key.ignore') {
                continue;
            }
            let label = prettifyPrefix(binding.key);
            label = simplifyLayoutIndependentString(label, { noBrackets: true });
            const prefixCode = getRequiredPrefixCode(binding.when);
            const mode = getRequiredMode(binding.when);
            const key = `${prefixCode}:${mode}`;
            const mapping = bindingMap[key] || {};
            const oldKey = mapping[label] || {};
            if (binding.command === 'master-key.do') {
                mapping[label] = {
                    name: binding.args.name || oldKey.name || '',
                    description: binding.args.description || oldKey.description || '',
                    kind: binding.args.kind || oldKey.kind || '',
                };
            } else if (binding.command === 'master-key.prefix') {
                mapping[label] = {
                    name: oldKey.name || 'prefix',
                    description: oldKey.description || '',
                    kind: oldKey.kind || '',
                };
            }
            bindingMap[key] = mapping;
        }

        this._bindingMap = bindingMap;
    }

    // adjust visual display with changes to the prefix and mode
    private updateState(state: CommandState) {
        this._modifierIndex = 0;
        const prefixCode: number = state.get(PREFIX_CODE) || 0;
        const mode: string = state.get(MODE) || '';
        if (this._prefixCode !== prefixCode || this._mode !== mode) {
            this._prefixCode = prefixCode;
            this._mode = mode;
            const key = `${prefixCode}:${mode}`;
            this._currentBindingKey = key;
            this._modifierOrder = this._modifierOrderMap[key];
            this._modifierIndex = 0;
            this.updateKeyHelper(this._bindingMap[key]);
            this.refresh();
        }
    }

    // scan through all visualized keys and update them with any newly changed documentation
    // state
    private updateKeyHelper(
        bindingMap: Record<string, IVisualKeyBinding> =
            this._bindingMap[this._currentBindingKey],
    ) {
        let i = 0;
        this._keymap = [];
        const topModifier = this.topModifier;
        const bottomModifier = this.bottomModifier;
        for (const row of keyRows(topModifier, bottomModifier)) {
            for (const key of row) {
                if (key.top && bindingMap && bindingMap[key.top]) {
                    this._keymap[i++] = {
                        label: key.top,
                        ...bindingMap[key.top],
                    };
                } else if (key.top) {
                    this._keymap[i++] = { label: key.top };
                } else {
                    this._keymap[i++] = { empty: true };
                }
                if (key.bottom && bindingMap && bindingMap[key.bottom]) {
                    this._keymap[i++] = {
                        label: key.bottom,
                        ...bindingMap[key.bottom],
                    };
                } else if (key.bottom) {
                    this._keymap[i++] = { label: key.bottom };
                } else {
                    this._keymap[i++] = { empty: true };
                }
            }
        }
    }

    // change what `[[kind]]` data is visible
    private updateKinds(bindings: KeyFileResult) {
        this._kinds = {};
        let index = 0;
        for (const kind of bindings.kinds()) {
            this._kinds[kind.name] = {
                name: kind.name,
                description: kind.description,
                index,
            };
            index++;
        }
        this.refresh();
    }

    // make sure this object response to changes in the state of the binding
    public async attach(state: CommandState) {
        onSetBindings(async (x) => {
            this.updateKinds(x);
            this.updateKeys(x);
            this.updateState(state);
        });
        onResolve('visualDocs', () => {
            this.updateState(state);
            return true;
        });
        return state;
    }

    // can the user see these bindings?
    public visible() {
        return this._view?.visible;
    }

    // actually render the view, loading the html and javascript we need
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        const keyDir = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'keys');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [keyDir],
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);
        webviewView.onDidChangeVisibility(_ => this.refresh());
        this.refresh();
    }

    // render the html needed to show the keyboard
    public _getHtml(webview: vscode.Webview) {
        const style = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'keys', 'style.css'),
        );
        const script = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'keys', 'script.js'),
        );
        let num = 0;
        /* eslint-disable @stylistic/max-len */
        const keys = `
        <div id="master-key-visual-doc" class="container">
            <p>To see additional bindings use the command \`Mater Key: Toggle Visual
                Doc Modifier by frequency\` (default keybinding
                ctrl/cmd+k ctrl/cmd+shift+m)</p>

            <div class="keyboard">
                ${keyRows(['⇧'], ['']).
                    map(row => `
                    <div class="keyboard-row">
                        ${row.
                            map((key: IKey) => {
                                const topId = num++;
                                const bottomId = num++;
                                const topLabel = get(key, 'top', '');
                                const noTop = !(topLabel || false);
                                return `
                                <div class="key key-height-${get(key, 'height', '1')} key-length-${get(key, 'length', '1')}">
                                    ${
                                        topLabel &&
                                        `
                                        <div id="key-label-${topId}" class="top label">${topLabel}</div>
                                        <div id="key-name-${topId}" class="top name"></div>
                                        <div id="key-detail-${topId}" class="detail"></div>
                                    `
                                    }

                                    <div id="key-label-${bottomId}" class="bottom label ${noTop ? 'no-top' : ''}">
                                        ${get(key, 'bottom', '')}
                                    </div>
                                    <div id="key-name-${bottomId}" class="bottom name ${noTop ? 'no-top' : ''}">
                                    </div>
                                    <div id="key-detail-${bottomId}" class="detail"></div>
                                </div>`;
                            }).
                            join('\n')}
                    </div>
                `,
                    ).
                    join('\n')}
            </div>
        </div>`;

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>

            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource}; ">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${style}" rel="stylesheet">
            <script type="text/javascript" src="${script}"></script>
            </head>
            <body>
            ${keys}
            </body>
            </html>
        `;
        /* eslint-enable @stylistic/max-len */
    }
}

/**
 * @userCommand showVisualDoc
 * @name Show Visual Documentation
 * @order 10
 *
 * Documents keybindings on a keyboard layout shown in the bottom panel of your editor.
 */
async function showVisualDoc() {
    const editor = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand('workbench.view.extension.masterKeyVisualDoc');
    // keep focus on current editor, if there was one
    if (editor) {
        vscode.window.showTextDocument(editor.document);
    }
    return;
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
}

let docProvider: DocViewProvider | undefined;
export async function activate(context: vscode.ExtensionContext) {
    docProvider = new DocViewProvider(context.extensionUri);
    await docProvider.attach(state);
    vscode.window.registerWebviewViewProvider(DocViewProvider.viewType, docProvider);
    // TODO: only show `command` in os x
    // TODO: make a meta key for linux (and windows for windows)
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.showVisualDoc', showVisualDoc),
    );
    /**
     * @userCommand toggleVisualDocModifiers
     * @name Toggle Visual Doc Modifier by frequency
     *
     * In the visual documentation view, cycle through the possible keybinding modifiers
     * based on how frequently they are used in the current set of keybindings.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.toggleVisualDocModifiers', _args =>
            docProvider?.toggleModifier(),
        ),
    );
}
