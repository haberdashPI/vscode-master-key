import { CommandState } from '../state';
import { withState } from '../state';
import * as vscode from 'vscode';
import { MODE } from './mode';
import { IConfigKeyBinding } from '../keybindings/parsing';
import { Bindings } from '../keybindings/processing';
import { normalizeLayoutIndependentBindings } from '../keybindings/layout';
import { filterBindingFn } from '../keybindings';
import { bindings, onChangeBindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import { reverse, uniqBy } from 'lodash';
import { modifierKey, prettifyPrefix } from '../utils';
import { Map } from 'immutable';

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

const KEY_ABBREV: Record<string, string> = {};

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

// generates the webview for a provider
export class DocViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'masterkey.visualDoc';
    _view?: vscode.WebviewView;
    _bindingMap: Record<string, IConfigKeyBinding> = {};
    _keymap?: ((IConfigKeyBinding & { label: string }) | { empty: true })[] = [];
    _kinds?: Record<string, KindDocEl> = {};
    _topModifier: readonly string[] = ['⇧'];
    _bottomModifier: readonly string[] = [];
    _oldBindings: IConfigKeyBinding[] = [];
    _modifierSetIndex: number = -1;
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
        return this._topModifier;
    }

    public get bottomModifier(): readonly string[] {
        return this._bottomModifier;
    }

    public set topModifier(strs: string[]) {
        this._topModifier = strs.sort();
        this._modifierSetIndex = -1;
        this.updateKeyHelper();
        this.refresh();
    }

    public set bottomModifier(strs: string[]) {
        this._bottomModifier = strs.sort();
        this._modifierSetIndex = -1;
        this.updateKeyHelper();
        this.refresh();
    }

    public toggleModifier() {
        if (this._modifierSetIndex + 1 >= this._modifierOrder.length) {
            this._modifierSetIndex = 0;
        } else {
            if (this._modifierSetIndex + 2 >= this._modifierOrder.length) {
                this._modifierSetIndex++;
            } else {
                this._modifierSetIndex += 2;
            }
        }
        const a = this._modifierOrder[this._modifierSetIndex];
        const b = this._modifierOrder[(this._modifierSetIndex + 1) %
            this._modifierOrder.length];
        const aLength = a.map(x => x.length).reduce((x, y) => x + y);
        const bLength = b.map(x => x.length).reduce((x, y) => x + y);
        if (aLength > bLength) {
            this._topModifier = a;
            this._bottomModifier = b;
        } else {
            this._topModifier = b;
            this._bottomModifier = a;
        }

        this.updateKeyHelper();
        this.refresh();
    }

    private updateKeys(values: CommandState | Map<string, unknown>) {
        const allBindings = bindings?.bind || [];
        if (this._oldBindings !== allBindings) {
            this._modifierSetIndex = 0;
            const modifierCounts: Record<string, number> = {};
            for (const binding of allBindings) {
                const key = modifierKey(binding.args.key).sort().join('.');
                modifierCounts[key] = get(modifierCounts, key, 0) + 1;
            }

            // handle cases where there are fewer than 2 modifier keys in the
            // binding set
            if (Object.keys(modifierCounts).length < 1) {
                modifierCounts[''] =
                    modifierCounts[''] === undefined ? 0 : modifierCounts[''];
            }
            if (Object.keys(modifierCounts).length < 2) {
                const modifier = Object.keys(modifierCounts)[0];
                if (modifierCounts[modifier + '⇧'] === undefined) {
                    modifierCounts[modifier] = 0;
                } else {
                    modifierCounts[modifier] = modifierCounts[modifier + '⇧'];
                }
            }

            const modifiers = Object.keys(modifierCounts);
            modifiers.sort((x, y) => modifierCounts[y] - modifierCounts[x]);
            this._modifierOrder = modifiers.map(x => x.split('.'));
            this._bottomModifier = this._modifierOrder[0];
            this._topModifier = this._modifierOrder[(0 + 1) % this._modifierOrder.length];
        }

        let curBindings = allBindings.filter(
            filterBindingFn(<string>values.get(MODE),
            <number>values.get(PREFIX_CODE), true),
        );
        curBindings = normalizeLayoutIndependentBindings(curBindings, { noBrackets: true });
        curBindings = reverse(uniqBy(reverse(curBindings), b => b.args.key));
        this._bindingMap = {};
        for (const binding of curBindings) {
            this._bindingMap[prettifyPrefix(binding.args.key)] = binding;
        }

        this.updateKeyHelper();
        this.refresh();
    }

    private updateKeyHelper() {
        let i = 0;
        this._keymap = [];
        for (const row of keyRows(this._topModifier, this._bottomModifier)) {
            for (const key of row) {
                if (key.top) {
                    this._keymap[i++] = {
                        label: key.top,
                        ...this._bindingMap[get(KEY_ABBREV, key.top, key.top)],
                    };
                } else {
                    this._keymap[i++] = { empty: true };
                }
                if (key.bottom) {
                    this._keymap[i++] = {
                        label: key.bottom,
                        ...this._bindingMap[get(KEY_ABBREV, key.bottom, key.bottom)],
                    };
                } else {
                    this._keymap[i++] = { empty: true };
                }
            }
        }
    }

    private updateKinds(bindings: Bindings) {
        this._kinds = {};
        let index = 0;
        for (const kind of bindings.kind) {
            this._kinds[kind.name] = { ...kind, index };
            index++;
        }
        this.refresh();
    }

    public async attach(state: CommandState) {
        this.updateKeys(state);
        state = state.onSet(MODE, (vals) => {
            this.updateKeys(vals);
            return true;
        });
        state = state.onSet(PREFIX_CODE, (vals) => {
            this.updateKeys(vals);
            return true;
        });
        if (bindings) {
            this.updateKinds(bindings);
        }
        onChangeBindings(async (x) => {
            if (x) {
                this.updateKinds(x);
                await withState(async (state) => {
                    this.updateKeys(state);
                    return state;
                });
            }
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

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.showVisualDoc', showVisualDoc),
    );
    const docProvider = new DocViewProvider(context.extensionUri);
    await withState(async (state) => {
        return await docProvider.attach(state);
    });
    vscode.window.registerWebviewViewProvider(DocViewProvider.viewType, docProvider);
    // TODO: only show command in os x
    // TODO: make a meta key for linux (and windows for windows)
    // TODO: the modifiers need to be able to be combined...
    /**
     * @userCommand toggleVisualDocModifiers
     * @name Toggle Visual Doc Modifier by frequency
     *
     * Cycle through the possible keybinding modifiers based on how frequently they are used
     * in the current set of keybindings.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.toggleVisualDocModifiers', _args =>
            docProvider.toggleModifier(),
        ),
    );
}
