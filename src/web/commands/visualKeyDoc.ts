import {CommandState} from '../state';
import {withState} from '../state';
import * as vscode from 'vscode';
import {MODE} from './mode';
import z from 'zod';
import {Bindings, IConfigKeyBinding} from '../keybindings/processing';
import {filterBindingFn} from '../keybindings';
import {bindings, onChangeBindings} from '../keybindings/config';
import {PREFIX_CODE} from './prefix';
import {reverse, uniqBy} from 'lodash';
import {modifierKey, prettifyPrefix, validateInput} from '../utils';
import {Map} from 'immutable';

// TODO: use KeyboardLayoutMap to improve behavior
// across different layouts

interface IKeyTemplate {
    name?: string;
    length?: string;
    modifier?: true;
}

interface IKeyRow {
    top?: string;
    bottom?: string;
    length?: string;
}

const keyRowsTemplate: IKeyTemplate[][] = [
    [
        {name: '`'},
        {name: '1'},
        {name: '2'},
        {name: '3'},
        {name: '4'},
        {name: '5'},
        {name: '6'},
        {name: '7'},
        {name: '8'},
        {name: '9'},
        {name: '0'},
        {name: '-'},
        {name: '='},
        {name: 'DELETE', length: '1-5'},
    ],
    [
        {name: 'TAB', length: '1-5'},
        {name: 'Q'},
        {name: 'W'},
        {name: 'E'},
        {name: 'R'},
        {name: 'T'},
        {name: 'Y'},
        {name: 'U'},
        {name: 'I'},
        {name: 'O'},
        {name: 'P'},
        {name: '['},
        {name: ']'},
        {name: '\\'},
    ],
    [
        {name: 'CAPS LOCK', length: '1-75', modifier: true},
        {name: 'A'},
        {name: 'S'},
        {name: 'D'},
        {name: 'F'},
        {name: 'G'},
        {name: 'H'},
        {name: 'J'},
        {name: 'K'},
        {name: 'L'},
        {name: ';'},
        {name: "'"},
        {name: 'ENTER', length: '1-75'},
    ],
    [
        {name: 'SHIFT', length: '2-25', modifier: true},
        {name: 'Z'},
        {name: 'X'},
        {name: 'C'},
        {name: 'V'},
        {name: 'B'},
        {name: 'N'},
        {name: 'M'},
        {name: ','},
        {name: '.'},
        {name: '/'},
        {name: 'SHIFT', length: '2-25', modifier: true},
    ],
    [
        {},
        {},
        {},
        {length: '1-25'},
        {length: '5', name: 'SPACE'},
        {length: '1-25'},
        {},
        {},
        {},
        {},
    ],
];

function keyRows(
    topModifier?: readonly string[],
    bottomModifier?: readonly string[]
): IKeyRow[][] {
    return keyRowsTemplate.map(row =>
        row.map(key => {
            if (key.name && !key.modifier) {
                return {
                    top: topModifier?.join() + key.name,
                    bottom: bottomModifier?.join() + key.name,
                    length: key.length,
                };
            } else {
                return {
                    top: key.name,
                    length: key.length,
                };
            }
        })
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
    _keymap?: ((IConfigKeyBinding & {label: string}) | {empty: true})[] = [];
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
                config: {colorBlind: false}, // TODO: remove or customize
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
        this._bottomModifier = this._modifierOrder[this._modifierSetIndex];
        this._topModifier =
            this._modifierOrder[(this._modifierSetIndex + 1) % this._modifierOrder.length];
        this.updateKeyHelper();
        this.refresh();
    }

    private updateKeys(values: CommandState | Map<string, unknown>) {
        // TODO: prevent this from being updated on every keypress
        // e.g. when pressing single-key commands
        const allBindings = bindings?.bind || [];
        if (this._oldBindings !== allBindings) {
            this._modifierSetIndex = 0;
            const modifierCounts: Record<string, number> = {};
            for (const binding of allBindings) {
                const key = modifierKey(binding.args.key).sort().join('.');
                modifierCounts[key] = get(modifierCounts, key, 0) + 1;
            }
            const modifiers = Object.keys(modifierCounts);
            modifiers.sort((x, y) => modifierCounts[y] - modifierCounts[x]);
            this._modifierOrder = modifiers.map(x => x.split('.'));
            this._bottomModifier = this._modifierOrder[0];
            this._topModifier = this._modifierOrder[(0 + 1) % this._modifierOrder.length];
        }

        let curBindings = allBindings.filter(
            filterBindingFn(<string>values.get(MODE), <number>values.get(PREFIX_CODE))
        );
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
                    this._keymap[i++] = {label: key.top, ...this._bindingMap[key.top]};
                } else {
                    this._keymap[i++] = {empty: true};
                }
                if (key.bottom) {
                    this._keymap[i++] = {
                        label: key.bottom,
                        ...this._bindingMap[key.bottom],
                    };
                } else {
                    this._keymap[i++] = {empty: true};
                }
            }
        }
    }

    private updateKinds(bindings: Bindings) {
        this._kinds = {};
        let index = 0;
        for (const kind of bindings.kind) {
            this._kinds[kind.name] = {...kind, index};
            index++;
        }
        this.refresh();
    }

    public async attach(state: CommandState) {
        this.updateKeys(state);
        state = state.onSet(MODE, vals => {
            this.updateKeys(vals);
            return true;
        });
        state = state.onSet(PREFIX_CODE, vals => {
            this.updateKeys(vals);
            return true;
        });
        if (bindings) {
            this.updateKinds(bindings);
        }
        onChangeBindings(async x => (x ? this.updateKinds(x) : undefined));
        return state;
    }

    public visible() {
        this._view?.visible;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'docview')],
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);
        webviewView.onDidChangeVisibility(_ => this.refresh());
        this.refresh();
    }

    public _getHtml(webview: vscode.Webview) {
        const style = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'docview', 'style.css')
        );
        const script = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'docview', 'script.js')
        );
        let num = 0;
        // TODO: we need to dynamically update the top and bottom labels depending on
        // modifiers this will require updating the key-label- divs in `script.js`
        const keys = `
        <div class="container">
            <div class="keyboard">
                ${keyRows(['⇧'], [''])
                    .map(
                        row => `
                    <div class="keyboard-row">
                        ${row
                            .map((key: IKeyRow) => {
                                const topId = num++;
                                const bottomId = num++;
                                const topLabel = get(key, 'top', '');
                                return `
                                <div class="key key-length-${get(key, 'length', '1')}">
                                    ${
                                        topLabel &&
                                        `
                                        <div id="key-label-${topId}" class="top label">${topLabel}</div>
                                        <div id="key-name-${topId}" class="top name"></div>
                                        <div id="key-detail-${topId}" class="detail"></div>
                                    `
                                    }

                                    <div id="key-label-${bottomId}" class="bottom label ${topLabel ? '' : 'no-top'}">
                                        ${get(key, 'bottom', '')}
                                    </div>
                                    <div id="key-name-${bottomId}" class="bottom name ${topLabel ? '' : 'no-top'}">
                                    </div>
                                    <div id="key-detail-${bottomId}" class="detail"></div>
                                </div>`;
                            })
                            .join('\n')}
                    </div>
                `
                    )
                    .join('\n')}
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
    }
}

const visualDocModifierArgs = z.object({
    modifiers: z.array(z.string()).optional(),
});
async function setVisualDocModifier(
    pos: 'top' | 'bottom',
    provider: DocViewProvider,
    args_: unknown
) {
    let modifiers: string[];
    if (args_) {
        const args = validateInput(
            `master-key.setVisualDoc${pos}Modifiers`,
            args_,
            visualDocModifierArgs
        );
        if (args?.modifiers) {
            modifiers = args.modifiers;
        } else {
            return;
        }
    } else {
        // TODO: make this list specific to the platform
        const items: vscode.QuickPickItem[] = [
            {label: '^', description: 'control'},
            {label: '⌘', description: 'command'},
            {label: '⌥', description: 'alt'},
            {label: '⇧', description: 'shift'},
        ];
        const picked = pos === 'top' ? provider.topModifier : provider.bottomModifier;
        for (const item of items) {
            item.picked = picked.some(x => x === item.label);
        }
        const selections = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            matchOnDescription: true,
        });
        if (selections) {
            modifiers = selections.map(sel => sel.label);
        } else {
            return;
        }
    }
    if (pos === 'top') {
        provider.topModifier = modifiers;
    } else {
        provider.bottomModifier = modifiers;
    }
}

async function showVisualDoc() {
    const editor = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand('workbench.view.extension.masterKeyVisualDoc');
    // keep focus on current editor, if there was one
    editor && vscode.window.showTextDocument(editor.document);
}

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.showVisualDoc', showVisualDoc)
    );
    const docProvider = new DocViewProvider(context.extensionUri);
    await withState(async state => {
        return await docProvider.attach(state);
    });
    vscode.window.registerWebviewViewProvider(DocViewProvider.viewType, docProvider);
    // TODO: only show command in os x
    // TODO: make a meta key for linux (and windows for windows)
    // TODO: the modifiers need to be able to be combined...
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setVisualDocTopModifiers', args =>
            setVisualDocModifier('top', docProvider, args)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.setVisualDocBottomModifiers', args =>
            setVisualDocModifier('bottom', docProvider, args)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.toggleVisualDocModifiers', _args =>
            docProvider.toggleModifier()
        )
    );
}
