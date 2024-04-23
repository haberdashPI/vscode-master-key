import { CommandResult, CommandState, DEFINITIONS } from '../state';
import { withState } from '../state';
import * as vscode from 'vscode';
import { MODE } from './mode';
import z from 'zod';
import { merge, cloneDeep } from 'lodash';
import { IConfigKeyBinding } from '../keybindings/processing';
import { currentKeybindings, filterBindingFn } from '../keybindings';
import { PREFIX_CODE } from './prefix';
import { uniqBy } from 'lodash';
import { prettifyPrefix, validateInput } from '../utils';

// TODO: use KeyboardLayoutMap to improve behavior
// across different layouts
const keyRows = [
    [
        {topId: "tilde", top: "⇧`", bottomId: "tick", bottom: "`"},
        {topId: "bang", top: "⇧1", bottom: "1"},
        {topId: "at", top: "⇧2", bottom: "2"},
        {topId: "hash", top: "⇧3", bottom: "3"},
        {topId: "dollar", top: "⇧4", bottom: "4"},
        {topId: "percent", top: "⇧5", bottom: "5"},
        {topId: "karat", top: "⇧6", bottom: "6"},
        {topId: "amper", top: "⇧7", bottom: "7"},
        {topId: "star", top: "⇧8", bottom: "8"},
        {topId: "paren-left", top: "⇧9", bottom: "9"},
        {topId: "paren-right", top: "⇧0", bottom: "0"},
        {topId: "underscore", top: "⇧-", bottom: "-"},
        {topId: "plus", top: "⇧=", bottomId: "equals", bottom: "="},
        {bottom: "delete", length: '1-5'}
    ],
    [
        {bottom: 'tab', length: '1-5'},
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
        {topId: "bracket-left", top: "⇧[", bottomId: "brace-left", bottom: "["},
        {topId: "bracket-right", top: "⇧]", bottomId: "brace-right", bottom: "]"},
        {topId: "pipe", top: "⇧\\", bottomId: "back_slash", bottom: "\\"}
    ],
    [
        {bottomId: "caps-lock", bottom: "caps lock", length: '1-75'},
        {top: "⇧A", bottom: "A"},
        {top: "⇧S", bottom: "S"},
        {top: "⇧D", bottom: "D"},
        {top: "⇧F", bottom: "F"},
        {top: "⇧G", bottom: "G"},
        {top: "⇧H", bottom: "H"},
        {top: "⇧J", bottom: "J"},
        {top: "⇧K", bottom: "K"},
        {top: "⇧L", bottom: "L"},
        {topId: "colon", top: ":", bottomId: "semicolon", bottom: ";"},
        {topId: 'quote', top: '"', bottom: "'"},
        {bottom: "return", length: '1-75'}
    ],
    [
        {bottomId: "shift-left", bottom: "shift", length: '2-25'},
        {top: "⇧Z", bottom: "Z"},
        {top: "⇧X", bottom: "X"},
        {top: "⇧C", bottom: "C"},
        {top: "⇧V", bottom: "V"},
        {top: "⇧B", bottom: "B"},
        {top: "⇧N", bottom: "N"},
        {top: "⇧M", bottom: "M"},
        {topId: "karet-left", top: "⇧,", bottomId: "comma", bottom: ","},
        {topId: "karet-right", top: "⇧.", bottomId: "period", bottom: "."},
        {topId: "question", top: "⇧/", bottomId: "slash", bottom: "/"},
        {bottomId: "shift-right", bottom: "shift", length: '2-25'}
    ],
    [
        {}, {}, {},
        {length: '1-25'},
        {length: '5', bottomId: "space", bottom: ""},
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
    _helpMap?: Record<string, IConfigKeyBinding> = {};
    _kinds?: KindDoc = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ){}

    private refresh(){
        if(this._view?.webview){
            this._view?.webview.postMessage({
                keymap: this._helpMap,
                kinds: this._kinds,
                config: {colorBlind: false} // TODO: remove or customize
            });
        }
    }
    // TODO: create specific listeners for each of these variables
    // rather than updating them all everytime
    public update(values: Map<string, unknown>){
        this._helpMap = {};
        let bindings = currentKeybindings();
        bindings = bindings.filter(filterBindingFn(<string>(values.get(MODE)),
            <number>(values.get(PREFIX_CODE))));
        bindings = uniqBy(bindings, b => b.args.key);
        for(let bind of bindings){
            this._helpMap[prettifyPrefix(bind.args.key)] = bind;
        }
        this._kinds = validateInput('visual-documentation', values.get(DEFINITIONS),
            kindDoc) || [];
        this.refresh();
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

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.showVisualDoc',
        showVisualDoc));
	const docProvider = new DocViewProvider(context.extensionUri);
    await withState(async state => {
        state.onSet(MODE, values => {

        });
    })
    vscode.window.registerWebviewViewProvider(DocViewProvider.viewType, docProvider);
}
