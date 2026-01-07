import * as vscode from 'vscode';
import { searchArgs, searchMatches } from '../commands/search';
import { fromZodIssue } from 'zod-validation-error';
import z from 'zod';
import { debounce } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { Utils } from 'vscode-uri';
import {
    setBindings,
    getBindings,
    KeyFileData,
    bindings,
} from './config';
import * as config from './config';
import { toLayoutIndependentString } from './layout';
import TOML from 'smol-toml';
import { marked } from 'marked';

// run `mise build-rust` to create this auto generated source fileu
import {
    KeyFileResult,
    ErrorLevel,
} from '../../rust/parsing/lib';
import { prettifyPrefix, replaceMatchesWith } from '../utils';

////////////////////////////////////////////////////////////////////////////////////////////
// Keybinding Generation

// these strings are inserted around the bindings added to `keybindings.json` to
// highlight that they have been manually inserted
const AUTOMATED_COMMENT_START_PREFIX = `
    // AUTOMATED BINDINGS START`;

const AUTOMATED_COMMENT_START_SUFFIX = `
    //
    // These bindings were automatically inserted by the master-key extension.
    //
    // Leave this comment (and the one denoting the end) unmodified to ensure the automated
    // bindings are properly updated if/when you insert another preset. Add any additional
    // bindings you want *outside* of the automated bindings region as anything within this
    // region will be modified when new presets are imported.
`;

const AUTOMATED_COMMENT_END = `
    // Leave this comment block unmodified to ensure the automated bindings are properly
    // updated if/when you insert another preset
    //
    // AUTOMATED BINDINGS END: Master Key Bindings
`;

// find what position in a file we first see `text`
function findText(doc: vscode.TextDocument, text: string) {
    const matches = searchMatches(
        doc,
        new vscode.Position(0, 0),
        undefined,
        text,
        searchArgs.parse({}),
    );
    const firstMatchResult = matches.next();
    if (firstMatchResult.done) {
        return undefined;
    }

    return firstMatchResult.value;
}

let layoutIndependence = false;

let layoutIndependenceUpdateCount = 0;
// `updateConfig` responds to changes to `master-key.layoutIndependence`, transforming keys
// from layout dependent to layout independent names as needed
async function updateConfig(
    event: vscode.ConfigurationChangeEvent | undefined,
    context: vscode.ExtensionContext,
    updateKeys: boolean = true,
) {
    if (!event || event?.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        const newLayoutIndependence = config.get<boolean>('layoutIndependence') || false;
        if (layoutIndependence !== newLayoutIndependence && updateKeys) {
            layoutIndependence = newLayoutIndependence;
            const data = await getBindings(context);
            if (data) {
                // NOTE: since this is an expensive operation that modifies GUI elements,
                // and the user may be interacting with GUI elements to change the config,
                // we want to delay this effect a bit
                const myCount = ++layoutIndependenceUpdateCount;
                await sleep(250);
                if (myCount === layoutIndependenceUpdateCount) {
                    // we'll only reach this point if another call to `updateConfig` that
                    // changed `layoutIndependence` has already occurred
                    if (await validateKeybindings(data, { silent: true })) {
                        insertKeybindingsIntoConfig(data);
                    }
                }
            }
        } else {
            layoutIndependence = newLayoutIndependence;
        }
    }
}

// generate output to insert into `keybindings.json`
function formatBindings(name: string, bindings: KeyFileResult) {
    let json = '';
    for (let i = 0; i < bindings.n_bindings(); i++) {
        const item = bindings.binding(i);
        if (layoutIndependence) {
            item.key = toLayoutIndependentString(item.key);
        }

        json += replaceAll(JSON.stringify(item, null, 4), /^/gm, '    ');
        json += ',\n\n';
    }
    return (
        AUTOMATED_COMMENT_START_PREFIX +
        ' `' +
        name +
        '`\n' +
        AUTOMATED_COMMENT_START_SUFFIX +
        '\n' +
        json +
        AUTOMATED_COMMENT_END
    );
}

async function openFileInTomlEditor(file: vscode.Uri) {
    const fileData = await vscode.workspace.fs.readFile(file);
    const fileText = new TextDecoder().decode(fileData);
    const document = await vscode.workspace.openTextDocument({
        content: fileText,
        language: 'toml',
    });
    await vscode.window.showTextDocument(document);
}

export const vscodeBinding = z.object({
    key: z.string(),
    command: z.string(),
    args: z.object({}).passthrough().optional(),
    when: z.string().optional(),
});

// inserts JSON bindings as TOML data into current TOML file
// `command` should be a command that opens a JSON file with keybindings
async function importCommandJSONFileIntoTOMLBindings(command: string) {
    const oldEd = vscode.window.activeTextEditor;
    const oldDocument = oldEd?.document;
    if (oldEd?.document.languageId !== 'toml') {
        vscode.window.showErrorMessage('Expected current file to be a toml file.');
        return;
    }
    await vscode.commands.executeCommand(command);
    const ed = vscode.window.activeTextEditor;
    if (ed && oldEd) {
        let text = ed.document.getText();
        // exclude any master keybindings inserted into this file
        text = text.replace(
            /^.*AUTOMATED BINDINGS START(.|\n|\r)+AUTOMATED BINDINGS END.*$/m,
            '',
        );
        text = replaceAll(text, /\/\/.*$/gm, '');

        // JSON -> TOML
        const keys = vscodeBinding.array().safeParse(JSON.parse(text));
        if (!keys.success) {
            for (const issue of keys.error.issues.slice(0, 3)) {
                const message = fromZodIssue(issue).message;
                vscode.window.showErrorMessage(message);
            }
        } else {
            const tomlText = TOML.stringify({ bind: keys.data });
            if (oldDocument) {
                await vscode.window.showTextDocument(oldDocument);
                const tomlEd = vscode.window.activeTextEditor;
                if (tomlEd) {
                    const lastLine = tomlEd.document.lineCount;
                    const lastLinePos = new vscode.Position(lastLine, 0);
                    await tomlEd.edit((edit) => {
                        const header = '\n\n# Keybindings imported from existing shortcuts';
                        const line =
                            '\n# -----------------------------------------------\n';
                        edit.insert(
                            lastLinePos,
                            header + line + tomlText + '\n' + line + '\n',
                        );
                    });
                    tomlEd.revealRange(new vscode.Range(lastLinePos, lastLinePos));
                }
            }
        }
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// inserts master keybinding data into `keybindings.json`
async function insertKeybindingsIntoConfig(data: KeyFileData) {
    const bindings = await data.bindings();
    const name = bindings.name() || Utils.basename(data.uri);

    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        const bracket = findText(ed.document, '[');
        if (!bracket) {
            vscode.window.showErrorMessage(
                'Could not find opening `[` at top of ' +
                'keybindings file. Your keybinding file does not appear to be ' +
                'properly formatted.',
            );
            return;
        } else {
            const insertAt = bracket.end;
            const bindingsToInsert = formatBindings(name, bindings);

            // try and replace the old bindings
            const oldBindingsStart = findText(ed.document, 'AUTOMATED BINDINGS START');
            const oldBindingsEnd = findText(ed.document, 'AUTOMATED BINDINGS END');
            let installed = false;
            if (oldBindingsStart && oldBindingsEnd) {
                const range = new vscode.Range(
                    new vscode.Position(
                        oldBindingsStart.start.line - 1,
                        ed.document.lineAt(
                            oldBindingsStart.start.line - 1,
                        ).range.end.character,
                    ),
                    new vscode.Position(oldBindingsEnd.end.line + 1, 0),
                );
                await ed.edit((builder) => {
                    builder.replace(range, bindingsToInsert);
                });
                ed.revealRange(new vscode.Range(range.start, range.start));
                await vscode.commands.executeCommand('workbench.action.files.save');
                installed = true;
            } else if (oldBindingsEnd || oldBindingsStart) {
                vscode.window.showErrorMessage(`You appear to have altered the comments
                    around the automated bindings. Please delete the old, automated
                    bindings manually and then re-run this command.`);
            } else {
                // if there are no old bindings, insert new ones
                await ed.edit((builder) => {
                    builder.insert(insertAt, '\n' + bindingsToInsert);
                });
                ed.revealRange(new vscode.Range(insertAt, insertAt));
                await vscode.commands.executeCommand('workbench.action.files.save');
                installed = true;
            }

            if (installed) {
                // remove any legacy data after the new bindings are installed
                const settings = vscode.workspace.getConfiguration('master-key');
                settings.update('storage', undefined, vscode.ConfigurationTarget.Global);

                // inform the user about the installed bindings
                if (bindings.has_layout_independent_bindings()) {
                    vscode.window.showInformationMessage(
                        replaceAll(
                            `The assigned bindings include layout independent bindings.
                            When you see keys surrounded by "[" and "]", they refer to the
                            U.S. Layout location of these characters.`,
                            /\s+/g,
                            ' ',
                        ),
                    );
                }
                vscode.window.
                    showInformationMessage(
                        replaceAll(
                            'Master keybindings were added to \`keybindings.json\`.',
                            /\s+/g,
                            ' ',
                        ),
                        {},
                        ...(((bindings.requiredExtensions() || []).length === 0) ?
                                [] :
                                ['Install Extensions']),
                        'Show Documentation',
                    ).then(async (selection) => {
                        if (selection == 'Install Extensions') {
                            await listExtensionsToInstall(data);
                        }
                        if (selection == 'Show Documentation') {
                            vscode.commands.executeCommand(
                                'master-key.showVisualDoc',
                            );
                            vscode.commands.executeCommand(
                                'master-key.showTextDoc',
                            );
                        }
                    });
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// text documentation

function snakeCase(str: string) {
    return replaceAll(str, /\s+/g, '-').toLowerCase();
}

// generates the html file to render in a webview
async function getWebviewContent(
    context: vscode.ExtensionContext,
    renderedHtml: string,
): Promise<string> {
    let styleContent = '';
    try {
        const docStyle = vscode.Uri.joinPath(
            context.extensionUri,
            'src',
            'webview',
            'text-doc.css',
        );
        const data = await vscode.workspace.fs.readFile(docStyle);
        styleContent = new TextDecoder().decode(data);
    } catch (e) {
        console.error('Could not read text-doc.css file:', e);
    }
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rendered Content</title>
        <style>
            ${styleContent}
        </style>
    </head>
    <body>
        ${renderedHtml}
    </body>
    </html>`;
}

/**
 * @userCommand showTextDoc
 * @name Show Text Documentation
 * @order 10
 *
 * Show documentation for the current master keybindings in a rendered markdown file.
 */
async function showTextDocumentation(context: vscode.ExtensionContext) {
    const content = bindings.text_docs();
    if (content) {
        const regex = /<key-bind>(.*?)<\/key-bind>/gs;
        const prettyKey = replaceMatchesWith(content, regex, (str) => {
            return prettifyPrefix(str);
        });
        const html = await marked(prettyKey);
        const header = /<h[1-3]>(.*?)<\/h[1-3]>/gs;
        const headerAnchors = replaceMatchesWith(html, header, (str) => {
            return `
                <a id="${snakeCase(str)}">${str}</a>
            `;
        });
        const panel = vscode.window.createWebviewPanel(
            'master-key.documentation',
            `${bindings.name()} Documentation`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: false,
                enableFindWidget: true,
                enableCommandUris: true,
            },
        );
        panel.webview.html = await getWebviewContent(context, headerAnchors);
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
        panel.reveal();
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// keybinding validation

let diagnostics: vscode.DiagnosticCollection;

interface ValidationOptions {
    // when true, errors will always show up. When false, they will only show up if the
    // `#:master-keybindings` comment exists at the top of the file
    explicit?: boolean;
    // if true, no errors will be shown to the user
    silent?: boolean;
}

// display any errors from parsing the keybindings (the rust code's job) as diagnostics:
// these show up in the problems pane and in the linting annotations of a file.
export async function validateKeybindings(
    data: KeyFileData, opts: ValidationOptions = {},
) {
    const parsed = await data.bindings();
    if (!opts.explicit &&
        parsed.n_errors() > 0 &&
        parsed.error(0).message &&
        /#:master-keybindings/.test(parsed.error(0).message)) {
        if (!opts.silent) {
            diagnostics.delete(data.uri);
        }
        return false;
    }
    let isValid = true;
    if (parsed.n_errors() > 0) {
        const diagnosticItems: vscode.Diagnostic[] = [];
        for (let i = 0; i < parsed.n_errors(); i++) {
            const error = parsed.error(i);
            if (error.level == ErrorLevel.Error) {
                isValid = false;
            }
            if (!opts.silent) {
                diagnosticItems.push(
                    new vscode.Diagnostic(
                        new vscode.Range(
                            new vscode.Position(
                                error.range.start.line,
                                error.range.start.col,
                            ),
                            new vscode.Position(
                                error.range.end.line,
                                error.range.end.col,
                            ),
                        ),
                        error.message,
                        error.level == ErrorLevel.Error ?
                            vscode.DiagnosticSeverity.Error :
                            error.level == ErrorLevel.Warn ?
                                vscode.DiagnosticSeverity.Warning :
                                vscode.DiagnosticSeverity.Hint,
                    ),
                );
            }
        }
        if (!opts.silent) {
            diagnostics.set(data.uri, diagnosticItems);
        }
    } else {
        if (!opts.silent) {
            diagnostics.delete(data.uri);
        }
    }
    return isValid;
}

////////////////////////////////////////////////////////////////////////////////////////////
// Commands concerning keybinding files

// a list of all presets
let extensionPresetsDir: vscode.Uri;
const presetFiles = ['larkin.toml'];
function listPresets() {
    // special case this directory (so it works (??) in the web context)
    const presets = [];
    for (const preset of presetFiles) {
        const uri = Utils.joinPath(extensionPresetsDir, preset);
        presets.push(new KeyFileData(uri));
    }
    return presets;
}

interface PresetPick extends vscode.QuickPickItem {
    preset?: KeyFileData;
    command?: string;
}

// show a list of available presets to the user
async function quickPickOfPresets(
    presets: KeyFileData[],
): Promise<PresetPick[]> {
    const result = [];
    for (const preset of presets) {
        const bindings = await preset.bindings();
        if (bindings.n_bindings() > 0) {
            result.push({
                preset,
                label: bindings.name() || Utils.basename(preset.uri),
            });
        }
    }

    return result;
}

// master-keybinding parsing of current file
function parseCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('There is no current file');
    } else {
        const encoder = new TextEncoder();
        const uri = editor.document.uri;
        const text = editor.document.getText();
        const bytes = encoder.encode(text);

        editor.document.getText();
        return new KeyFileData(uri, { bytes });
    }
}

async function openFileWithContentOfPreset(args?: { preset?: number }) {
    const options = await quickPickOfPresets(listPresets());
    let picked;
    if (args?.preset !== undefined) {
        picked = options[args?.preset];
    } else {
        picked = await vscode.window.showQuickPick(options);
    }
    if (picked?.preset) {
        openFileInTomlEditor(picked.preset.uri);
    }
}

async function listExtensionsToInstall(data?: KeyFileData) {
    const bindings = config.bindings || await data?.bindings();
    if (!bindings || (bindings?.n_bindings() || 0) == 0) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: vscode.QuickPickItem[] = bindings.requiredExtensions().map((id: any) => {
        const exts = vscode.extensions.all.filter(x => x.id === id);
        if (exts.length > 0) {
            return { label: id, detail: 'already installed', picked: true };
        } else {
            return {
                label: id,
                detail: 'unknown status',
                picked: false,
                buttons: [
                    { iconPath: new vscode.ThemeIcon('eye'), tooltip: 'view extension' },
                ],
            };
        }
    });
    if (items.length === 0 || items.every(it => it.detail === 'already installed')) {
        return;
    }
    const picker = vscode.window.createQuickPick();
    picker.title = `Extensions Used by ${bindings.name()}`;
    picker.items = items;
    picker.canSelectMany = true;
    picker.placeholder = 'Select extensions to install';
    picker.matchOnDetail = true;
    picker.ignoreFocusOut = true;

    picker.onDidTriggerItemButton((e) => {
        vscode.commands.executeCommand('workbench.extensions.search', e.item.label);
    });

    let resolveFn: () => void;
    const pickPromise = new Promise<void>((res, _rej) => {
        resolveFn = res;
    });
    picker.onDidHide((_) => {
        resolveFn();
        picker.dispose();
    });
    let accept = false;
    picker.onDidAccept((_) => {
        accept = true;
        picker.hide();
    });
    picker.show();

    await pickPromise;
    if (!accept) {
        return;
    }

    for (const item of picker.selectedItems) {
        if (item.detail === 'unknown status') {
            try {
                await vscode.commands.executeCommand(
                    'workbench.extensions.installExtension',
                    item.label,
                );
            } catch (_) {
                vscode.window.showErrorMessage('Error installing extension: ' + item.label);
            }
        }
    }
}

async function activateBindings(
    context: vscode.ExtensionContext,
    data?: KeyFileData | 'CurrentFile',
) {
    if (data === 'CurrentFile') {
        data = parseCurrentFile();
    }
    if (!data) {
        const options = await quickPickOfPresets(listPresets());
        options.push(
            { label: 'Current File', command: 'current' },
        );

        const picked = await vscode.window.showQuickPick(options);
        if (picked?.command === 'current') {
            data = parseCurrentFile();
        } else {
            data = picked?.preset;
        }
    }
    if (data) {
        if (!(await validateKeybindings(data, { explicit: true }))) {
            vscode.window.showErrorMessage(
                `There were errors when trying to read the keybinding file: ${data.uri}`,
            );
            return;
        }
        await setBindings(context, data);
        await insertKeybindingsIntoConfig(data);
    }
}

async function deactivateBindings(context: vscode.ExtensionContext) {
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        await setBindings(context);
        const oldBindingsStart = findText(ed.document, 'AUTOMATED BINDINGS START');
        const oldBindingsEnd = findText(ed.document, 'AUTOMATED BINDINGS END');
        if (oldBindingsStart && oldBindingsEnd) {
            const range = new vscode.Range(
                new vscode.Position(
                    oldBindingsStart.start.line - 1,
                    ed.document.lineAt(oldBindingsStart.start.line - 1).range.end.character,
                ),
                new vscode.Position(oldBindingsEnd.end.line + 1, 0),
            );
            await ed.edit((builder) => {
                builder.delete(range);
            });
            ed.revealRange(new vscode.Range(range.start, range.start));
            await vscode.commands.executeCommand('workbench.action.files.save');
            vscode.window.showInformationMessage(`Your master keybindings have
                been updated in \`keybindings.json\`.`);
        } else {
            vscode.window.showErrorMessage(
                'Master Key tried to remove bindings but there ' +
                'were no master key bindings to remove.',
            );
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
}

export async function activate(context: vscode.ExtensionContext) {
    updateConfig(undefined, context, false);
    vscode.workspace.onDidChangeConfiguration(event => updateConfig(event, context, true));

    diagnostics = vscode.languages.createDiagnosticCollection('Master Key Bindings');

    const encoder = new TextEncoder();
    vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e.document.languageId == 'toml' || e.document.uri.fsPath.endsWith('.toml')) {
            debounce(() => {
                const text = e.document.getText();
                const bytes = encoder.encode(text);
                validateKeybindings(new KeyFileData(e.document.uri, { bytes }));
            }, 1000)();
        }
    });

    vscode.workspace.onDidSaveTextDocument(async (e) => {
        if (e.languageId == 'toml' || e.uri.fsPath.endsWith('.toml')) {
            await validateKeybindings(new KeyFileData(e.uri));
        }
    });
    vscode.workspace.onDidOpenTextDocument(async (e) => {
        if (e.languageId == 'toml' || e.uri.fsPath.endsWith('.toml')) {
            await validateKeybindings(new KeyFileData(e.uri));
        }
    });

    extensionPresetsDir = Utils.joinPath(context.extensionUri, 'src', 'presets');
}

export async function defineCommands(context: vscode.ExtensionContext) {
    /**
     * @userCommand activateCurrentFile
     * @name Activate Keybindings in Current File
     *
     * Insert the master key bindings in the current file into VSCode, making them active
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.activateCurrentFile',
            () => activateBindings(context, 'CurrentFile'),
        ),
    );
    /**
     * @userCommand activateBindings
     * @name Activate Keybindings
     *
     * Insert your master key bindings into VSCode, making them active
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.activateBindings',
            (...args) => activateBindings(context, ...args),
        ),
    );
    /**
     * @userCommand deactivateBindings
     * @name Deactivate Keybindings
     *
     * Remove your master key bindings from VSCode
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.deactivateBindings',
            () => deactivateBindings(context),
        ),
    );
    /**
     * @userCommand editPreset
     * @name New Keybinding Copy
     *
     * Edit a new copy of a given master keybinding preset.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.editPreset',
            openFileWithContentOfPreset
        ),
    );
    /**
     * @userCommand importUserBindings
     * @name Import User Bindings
     *
     * Import user bindings from VSCode's global keybindings file (`keybindings.json`)
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.importUserBindings', () =>
            importCommandJSONFileIntoTOMLBindings('workbench.action.openGlobalKeybindingsFile'),
        ),
    );
    /**
     * @userCommand importDefaultBindings
     * @name Import Default Bindings
     *
     * Import default bindings from VSCode's default keybindings file
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.importDefaultBindings', () =>
            importCommandJSONFileIntoTOMLBindings('workbench.action.openDefaultKeybindingsFile'),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.showTextDoc',
            () => showTextDocumentation(context),
        ),
    );

    /**
     * @userCommand installRequiredExtensions
     * @name Install Extensions Required by Keybindings
     *
     * Install extensions required by your keybindings, as defined in the
     * `requiredExtensions` field.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.installRequiredExtensions',
            listExtensionsToInstall,
        ),
    );
}
