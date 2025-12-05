import * as vscode from 'vscode';
import { searchArgs, searchMatches } from '../commands/search';
import { fromZodIssue } from 'zod-validation-error';
import z from 'zod';
import { debounce } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { Utils } from 'vscode-uri';
import {
    // TODO: reimplement
    // clearUserBindings,
    // createUserBindings,
    createBindings,
    getBindings,
    KeyFileData,
} from './config';
import * as config from './config';
import { toLayoutIndependentString } from './layout';
import JSONC from 'jsonc-simple-parser';
import TOML from 'smol-toml';

// run `mise build-rust` to create this auto generated source fileu
import initParsing, {
    KeyFileResult,
    ErrorLevel,
} from '../../rust/parsing/lib';

////////////////////////////////////////////////////////////////////////////////////////////
// Keybinding Generation

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
                // and the user is probably interacting with GUI elements, we want to delay
                // this effect a bit, and only implement the change if it is the most
                // recent call to `updateConfig`
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

async function copyBindings(file: vscode.Uri) {
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        vscode.languages.setTextDocumentLanguage(ed.document, 'toml');
        const fileData = await vscode.workspace.fs.readFile(file);
        const fileText = new TextDecoder().decode(fileData);
        const wholeDocument = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, ed.document.lineCount + 1),
        );
        await ed.edit((builder) => {
            builder.replace(wholeDocument, fileText);
        });
    }
}

async function removeKeybindings(context: vscode.ExtensionContext) {
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        await createBindings(context);
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

export const vscodeBinding = z.object({
    key: z.string(),
    command: z.string(),
    args: z.object({}).optional(),
    when: z.string().optional(),
});

async function copyCommandResultIntoBindingFile(command: string) {
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
        text = text.replace(
            /^.*AUTOMATED BINDINGS START(.|\n|\r)+AUTOMATED BINDINGS END.*$/m,
            '',
        );
        const keys = vscodeBinding.array().safeParse(JSONC.parse(text));
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
                'proplery formatted.',
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
                const selection = await vscode.window.
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
                    );
                if (selection == 'Install Extensions') {
                    await handleRequireExtensions(data);
                }
                if (selection == 'Show Documentation') {
                    vscode.commands.executeCommand('master-key.showVisualDoc');
                    vscode.commands.executeCommand('master-key.showTextDoc');
                }
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// User-facing commands and helpers

interface PresetPick extends vscode.QuickPickItem {
    preset?: KeyFileData;
    command?: string;
}

async function makeQuickPicksFromPresets(
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

function parseCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('There is no current file');
    } else {
        const uri = editor.document.uri;
        return new KeyFileData(uri);
    }
}

export async function queryPreset(): Promise<KeyFileData | undefined> {
    const options = await makeQuickPicksFromPresets(listPresets());
    options.push(
        { label: 'Current File', command: 'current' },
    );
    const picked = await vscode.window.showQuickPick(options);
    if (picked?.command === 'current') {
        return parseCurrentFile();
    } else {
        return picked?.preset;
    }
    return undefined;
}

async function copyBindingsToNewFile() {
    const options = makeQuickPicksFromPresets(listPresets());
    const picked = await vscode.window.showQuickPick(options);
    if (picked?.preset) {
        copyBindings(picked.preset.uri);
    }
}

async function handleRequireExtensions(data?: KeyFileData) {
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
    if (!data) {
        data = await queryPreset();
    }
    if (data === 'CurrentFile') {
        data = parseCurrentFile();
    }
    if (data) {
        if (!(await validateKeybindings(data, { explicit: true }))) {
            await vscode.window.showErrorMessage(
                `There were errors when trying to read the keybinding file: ${data.uri}`,
            );
            return;
        }
        await createBindings(context, data);
        await insertKeybindingsIntoConfig(data);
    }
}

// TODO: reimplement
// async function deactivateUserBindings() {
//     const bindings = await clearUserBindings();
//     if (bindings) {
//         insertKeybindingsIntoConfig(bindings);
//     }
// }

// async function activateUserBindings(file?: vscode.Uri) {
//     if (!file) {
//         const currentUri = vscode.window.activeTextEditor?.document.fileName;
//         file = vscode.Uri.from({ scheme: 'file', path: currentUri });
//     }
//     if (file) {
//         const fileData = await vscode.workspace.fs.readFile(file);
//         const bindings = await createUserBindings(data);
//         if (bindings) {
//             await insertKeybindingsIntoConfig(bindings);
//         }
//     } else {
//         vscode.window.showErrorMessage('Open document must be saved to a file first.');
//     }
// }

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

interface ValidationOptions {
    explicit?: boolean;
    silent?: boolean;
}

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
    console.log('Errors found: ' + parsed.n_errors());
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

let diagnostics: vscode.DiagnosticCollection;

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

    // initialize rust WASM module for parsing keybinding files
    const filename = vscode.Uri.joinPath(context.extensionUri, 'out', 'parsing_bg.wasm');
    const bits = await vscode.workspace.fs.readFile(filename);
    await initParsing(bits);

    /**
     * @userCommand activateBindings
     * @name Activate Keybindings
     *
     * Insert your master key bindings into VSCode, making them active
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.activateBindings',
            () => activateBindings(context),
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
            () => removeKeybindings(context),
        ),
    );
    /**
     * @userCommand activateUserBindings
     * @name Activate User Keybindings
     *
     * Select a set of user specified bindings, to append to your master key bindings
     */
    // TODO: re-implement
    // context.subscriptions.push(
    //     vscode.commands.registerCommand(
    //         'master-key.activateUserBindings',
    //         activateUserBindings),
    // );
    /**
     * @userCommand removeUserBindings
     * @name Deactivate User Keybindings
     *
     * Remove user specified bindings from your master key bindings
     */
    // TODO: reimplement
    // context.subscriptions.push(
    //     vscode.commands.registerCommand(
    //         'master-key.deactivateUserBindings',
    //         deactivateUserBindings),
    // );
    /**
     * @userCommand editPreset
     * @name New Keybinding Copy
     *
     * Edit a new copy of a given master keybinding preset.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.editPreset', copyBindingsToNewFile),
    );
    /**
     * @userCommand importUserBindings
     * @name Import User Bindings
     *
     * Import user bindings from VSCode's global keybindings file (`keybindings.json`)
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.importUserBindings', () =>
            copyCommandResultIntoBindingFile('workbench.action.openGlobalKeybindingsFile'),
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
            copyCommandResultIntoBindingFile('workbench.action.openDefaultKeybindingsFile'),
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
            handleRequireExtensions,
        ),
    );

    extensionPresetsDir = Utils.joinPath(context.extensionUri, 'src', 'presets');
}
