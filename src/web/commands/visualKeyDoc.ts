import { CommandState } from '../state';
import { withState } from '../state';
import * as vscode from 'vscode';
import { MODE } from './mode';
import z from 'zod';
import { IConfigKeyBinding } from '../keybindings/processing';
import { currentKeybindings, filterBindingFn } from '../keybindings';
import { PREFIX_CODE } from './prefix';
import { uniqBy } from 'lodash';
import { prettifyPrefix, validateInput } from '../utils';
import { Map } from 'immutable';

// TODO: use KeyboardLayoutMap to improve behavior
// across different layouts

interface IKeyTemplate{
    name?: string
    length?: string
    modifier?: true
}

interface IKeyRow{
    top?: string
    bottom?: string
    length?: string
}

const keyRowsTemplate: IKeyTemplate[][] = [
    [
        {name: "`"},
        {name: "1"},
        {name: "2"},
        {name: "3"},
        {name: "4"},
        {name: "5"},
        {name: "6"},
        {name: "7"},
        {name: "8"},
        {name: "9"},
        {name: "0"},
        {name: "-"},
        {name: "="},
        {name: "DELETE", length: '1-5', modifier: true}
    ],
    [
        {name: 'TAB', length: '1-5', modifier: true},
        {name: "Q"},
        {name: "W"},
        {name: "E"},
        {name: "R"},
        {name: "T"},
        {name: "Y"},
        {name: "U"},
        {name: "I"},
        {name: "O"},
        {name: "P"},
        {name: "["},
        {name: "]"},
        {name: "\\"}
    ],
    [
        {name: "CAPS LOCK", length: '1-75', modifier: true},
        {name: "A"},
        {name: "S"},
        {name: "D"},
        {name: "F"},
        {name: "G"},
        {name: "H"},
        {name: "J"},
        {name: "K"},
        {name: "L"},
        {name: ";"},
        {name: "'"},
        {name: "RETURN", length: '1-75', modifier: true}
    ],
    [
        {name: "SHIFT", length: '2-25', modifier: true},
        {name: "Z"},
        {name: "X"},
        {name: "C"},
        {name: "V"},
        {name: "B"},
        {name: "N"},
        {name: "M"},
        {name: ","},
        {name: "."},
        {name: "/"},
        {name: "SHIFT", length: '2-25', modifier: true}
    ],
    [
        {}, {}, {},
        {length: '1-25'},
        {length: '5', name: "SPACE"},
        {length: '1-25'},
        {}, {}, {}, {}
    ]
];

function keyRows(topModifier?: string, bottomModifier?: string): IKeyRow[][]{
    return keyRowsTemplate.map(row => row.map(key => {
        if(key.name && !key.modifier){
            return {
                top: topModifier+key.name,
                bottom: bottomModifier+key.name,
                length: key.length
            };
        }else{
            return {
                top: key.name,
                length: key.length
            };
        }
    }));
}

function get(x: any, key: string, def: any){
    if(key in x){
        return x[key];
    }else{
        return def;
    }
}

const kindDoc = z.array(z.object({
    name: z.string(),
    description: z.string(),
}));
interface KindDocEl {
    name: string,
    description: string,
    index: number
}

// generates the webview for a provider
export class DocViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'masterkey.visualDoc';
    _view?: vscode.WebviewView;
    _bindingMap: Record<string, IConfigKeyBinding> = {};
    _keymap?: (IConfigKeyBinding | {empty: true})[] = [];
    _kinds?: Record<string, KindDocEl> = {};
    _topModifier: string = "⇧";
    _bottomModifier: string = "";

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ){}

    private refresh(){
        if(this._view?.webview){
            this._view?.webview.postMessage({
                keymap: this._keymap,
                kinds: this._kinds,
                config: {colorBlind: false} // TODO: remove or customize
            });
        }
    }

    public set topModifier(str: string){
        this._topModifier = str;
        this.updateKeyHelper();
        this.refresh();
    }

    public set bottomModifier(str: string){
        this._bottomModifier = str;
        this.updateKeyHelper();
        this.refresh();
    }

    private updateKeys(values: CommandState | Map<string, unknown>){
        // TODO: prevent this from being updated on every keypress
        // e.g. when pressing single-key commands
        let bindings = currentKeybindings();
        bindings = bindings.filter(filterBindingFn(<string>(values.get(MODE)),
            <number>(values.get(PREFIX_CODE))));
        bindings = uniqBy(bindings, b => b.args.key);
        this._bindingMap = {};
        for(let binding of bindings){
            this._bindingMap[prettifyPrefix(binding.args.key)] = binding;
        }

        this.updateKeyHelper();
        this.refresh();
    }

    private updateKeyHelper(){
        let i = 0;
        this._keymap = [];
        for(let row of keyRows(this._topModifier, this._bottomModifier)){
            for(let key of row){
                if(key.top){
                    this._keymap[i++] = this._bindingMap[key.top];
                }else{
                    this._keymap[i++] = {empty: true};
                }
                if(key.bottom){
                    this._keymap[i++] = this._bindingMap[key.bottom];
                }else{
                    this._keymap[i++] = {empty: true};
                }
            }
        }
    }

    private updateKinds(values: CommandState | Map<string, unknown>){
        let kinds = validateInput('visual-documentation',
            (<any>values.get('kinds')) || [], kindDoc);
        this._kinds = {};
        let index = 0;
        for(let kind of (kinds || [])){
            this._kinds[kind.name] = {...kind, index};
            index++;
        }
        this.refresh();
    }

    public async attach(state: CommandState){
        this.updateKeys(state);
        state = state.onSet(MODE, vals => {
            this.updateKeys(vals);
            return true;
        });
        state = state.onSet(PREFIX_CODE, vals => {
            this.updateKeys(vals);
            return true;
        });
        this.updateKinds(state);
        state = state.onSet('kinds', vals => {
            this.updateKinds(state);
            return true;
        });
        return state;
    }

    public visible(){ this._view?.visible; }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken){

        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [ vscode.Uri.joinPath(this._extensionUri, 'docview')]
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);
        webviewView.onDidChangeVisibility(event => this.refresh());
        this.refresh();
    }

    public _getHtml(webview: vscode.Webview){
        let style = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'docview', 'style.css'));
        let script = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'docview', 'script.js'));
        let num = 0;
        let keys = `
        <div class="container">
            <div class="keyboard">
                ${keyRows.map(row => `
                    <div class="keyboard-row">
                        ${row.map((key: any) => {
                            let topId = num++;
                            let bottomId = num++;
                            let topLabel = get(key, 'top', '');
                            return `
                                <div class="key key-length-${get(key, 'length', 1)}">
                                    ${topLabel && `
                                        <div id="key-label-${topId}" class="top label">${topLabel}</div>
                                        <div id="key-name-${topId}" class="top name"></div>
                                        <div id="key-detail-${topId}" class="detail"></div>
                                    `}

                                    <div id="key-label-${bottomId}" class="bottom label ${topLabel ? '' : 'no-top'}">
                                        ${get(key, 'bottom', '')}
                                    </div>
                                    <div id="key-name-${bottomId}" class="bottom name ${topLabel ? '' : 'no-top'}">
                                    </div>
                                    <div id="key-detail-${bottomId}" class="detail"></div>
                                </div>`;
                        }).join('\n')}
                    </div>
                `).join('\n')}
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

async function showVisualDoc(){
    let editor = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand('workbench.view.extension.masterKeyVisualDoc');
    // keep focus on current editor, if there was one
    editor && vscode.window.showTextDocument(editor.document);
}

export async function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.showVisualDoc',
        showVisualDoc));
	const docProvider = new DocViewProvider(context.extensionUri);
    await withState(async state => {
        return await docProvider.attach(state);
    });
    vscode.window.registerWebviewViewProvider(DocViewProvider.viewType, docProvider);
    // TODO: only show command in os x
    // TODO: make a meta key for linux (and windows for windows)
    for(let key of [{id: 'ctrl', name: '^'}, {id: 'cmd', name: '⌘'},
        {id: 'shift', name: '⇧'}, {id: 'alt', name: '⌥'}]){
        for(let pos of ['top', 'bottom']){
            // TODO: generify and call the right setter of `docProvider`
            context.subscriptions.push(vscode.commands.registerCommand('master-key.visualDocCtrlTop'))
        }
    }
}
