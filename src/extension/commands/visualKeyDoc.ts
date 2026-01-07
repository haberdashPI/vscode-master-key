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

interface IKeyTemplate {
    name?: string;
    length?: string;
    modifier?: boolean;
    firstRow?: boolean;
    height?: string;
}

interface IKeyRow {
    top?: string;
    bottom?: string;
    length?: string;
    height?: string;
}

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

function keyRows(
    topModifier?: readonly string[],
    bottomModifier?: readonly string[],
): IKeyRow[][] {
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

function get<T extends object, K extends keyof T>(x: T, key: K, def: T[K]) {
    if (key in x && x[key] !== undefined) {
        return x[key];
    } else {
        return def;
    }
}

interface KindDocEl {
    name: string;
    description: string;
    index: number;
}

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
    _bindingMap: Record<string, Record<string, IVisualKeyBinding>> = {};
    _currentBindingKey: string = '0:';
    _keymap?: (IVisualKeyBinding | { empty: true })[] = [];
    _kinds?: Record<string, KindDocEl> = {};
    _modifierIndex: number = 0;
    _oldBindings: IVisualKeyBinding[] = [];
    _modifierSetIndex: number = -1;
    _modifierOrderMap: Record<string, string[][]> = {};
    _modifierOrder: string[][] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    private refresh() {
        if (this._view?.webview) {
            this._view?.webview.postMessage({
                keymap: this._keymap,
                kinds: this._kinds,
                config: { colorBlind: false }, // TODO: remove or customize
            });
        }
    }

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

    public toggleModifier() {
        this._modifierIndex = (this._modifierIndex + 2) % this._modifierOrder.length;

        // if there are an odd number of available modifiers the top / bottom will show both
        // the last key and the first key. So when we wrap around again we want to reset
        // back to the start (otherwise there will be a redundant odd parity cycle through
        // all modifiers)
        if (this._modifierIndex % 2 == 1) {
            this._modifierIndex = 0;
        }
        this.updateKeyHelper();
        this.refresh();
    }

    private updateKeys(bindings: KeyFileResult) {
        this._modifierSetIndex = 0;
        const modifierCounts: Record<string, Record<string, number>> = {};
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

    public visible() {
        return this._view?.visible;
    }

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
                            map((key: IKeyRow) => {
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
