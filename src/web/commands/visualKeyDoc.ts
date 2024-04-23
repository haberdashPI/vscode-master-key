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

const keyRows = [
    [
        {top: "⇧`", bottom: "`"},
        {top: "⇧1", bottom: "1"},
        {top: "⇧2", bottom: "2"},
        {top: "⇧3", bottom: "3"},
        {top: "⇧4", bottom: "4"},
        {top: "⇧5", bottom: "5"},
        {top: "⇧6", bottom: "6"},
        {top: "⇧7", bottom: "7"},
        {top: "⇧8", bottom: "8"},
        {top: "⇧9", bottom: "9"},
        {top: "⇧0", bottom: "0"},
        {top: "⇧-", bottom: "-"},
        {top: "⇧=", bottom: "="},
        {bottom: "DELETE", length: '1-5'}
    ],
    [
        {bottom: 'TAB', length: '1-5'},
        {top: "⇧Q", bottom: "Q"},
        {top: "⇧W", bottom: "W"},
        {top: "⇧E", bottom: "E"},
        {top: "⇧R", bottom: "R"},
        {top: "⇧T", bottom: "T"},
        {top: "⇧Y", bottom: "Y"},
        {top: "⇧U", bottom: "U"},
        {top: "⇧I", bottom: "I"},
        {top: "⇧O", bottom: "O"},
        {top: "⇧P", bottom: "P"},
        {top: "⇧[", bottom: "["},
        {top: "⇧]", bottom: "]"},
        {top: "⇧\\", bottom: "\\"}
    ],
    [
        {bottom: "CAPS LOCK", length: '1-75'},
        {top: "⇧A", bottom: "A"},
        {top: "⇧S", bottom: "S"},
        {top: "⇧D", bottom: "D"},
        {top: "⇧F", bottom: "F"},
        {top: "⇧G", bottom: "G"},
        {top: "⇧H", bottom: "H"},
        {top: "⇧J", bottom: "J"},
        {top: "⇧K", bottom: "K"},
        {top: "⇧L", bottom: "L"},
        {top: ":", bottom: ";"},
        {top: '"', bottom: "'"},
        {bottom: "RETURN", length: '1-75'}
    ],
    [
        {bottom: "shift", length: '2-25'},
        {top: "⇧Z", bottom: "Z"},
        {top: "⇧X", bottom: "X"},
        {top: "⇧C", bottom: "C"},
        {top: "⇧V", bottom: "V"},
        {top: "⇧B", bottom: "B"},
        {top: "⇧N", bottom: "N"},
        {top: "⇧M", bottom: "M"},
        {top: "⇧,", bottom: ","},
        {top: "⇧.", bottom: "."},
        {top: "⇧/", bottom: "/"},
        {bottom: "SHIFT", length: '2-25'}
    ],
    [
        {}, {}, {},
        {length: '1-25'},
        {length: '5', bottom: ""},
        {length: '1-25'},
        {}, {}, {}, {}
    ]
];

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
type KindDoc = z.input<typeof kindDoc>;

// generates the webview for a provider
export class DocViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'masterkey.visualDoc';
    _view?: vscode.WebviewView;
    _keymap?: Record<string, IConfigKeyBinding> = {};
    _kinds?: KindDoc = [];

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

    private updateKeys(values: CommandState | Map<string, unknown>){
        this._keymap = {};
        let bindings = currentKeybindings();
        bindings = bindings.filter(filterBindingFn(<string>(values.get(MODE)),
            <number>(values.get(PREFIX_CODE))));
        bindings = uniqBy(bindings, b => b.args.key);
        for(let bind of bindings){
            // TODO: convert to ids rather than using the name
            this._keymap[prettifyPrefix(bind.args.key)] = bind;
        }
        this.refresh();
    }

    private updateKinds(values: CommandState | Map<string, unknown>){
        this._kinds = validateInput('visual-documentation',
            (<any>values.get('kinds')) || [], kindDoc);
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
        let num = 0
        let keys = `
        <div class="container">
            <div class="keyboard">
                ${keyRows.map(row => `
                    <div class="keyboard-row">
                        ${row.map((key: any) => {
                            let topId = get(key, 'topId', get(key, 'top', "blank"+num++));
                            let bottomId = get(key, 'bottomId', get(key, 'bottom', "blank"+num++));
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
                                </div>`
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
}
