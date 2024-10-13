import * as vscode from 'vscode';
import {searchArgs, searchMatches} from '../commands/search';
import {
    parseBindings,
    showParseError,
    vscodeBinding,
    FullBindingSpec,
    ParsedResult,
    ErrorResult,
} from './parsing';
import {processBindings, IConfigKeyBinding, Bindings} from './processing';
import {isSingleCommand} from '../utils';
import {uniq, pick} from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import {Utils} from 'vscode-uri';
import {clearUserBindings, createBindings, createUserBindings} from './config';
import * as config from './config';
const JSONC = require('jsonc-simple-parser');
const TOML = require('smol-toml');

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
        searchArgs.parse({})
    );
    const firstMatchResult = matches.next();
    if (firstMatchResult.done) {
        return undefined;
    }

    return firstMatchResult.value;
}

function formatBindings(name: string, items: IConfigKeyBinding[]) {
    let json = '';
    for (const item of items) {
        if (item.prefixDescriptions.length > 0) {
            let comment =
                'Automated binding; avoid editing manually, instead use one of these commands';
            comment += "'Master Key: Select Binding Preset";
            comment += "'Master Key: Remove Bindings";
            comment += 'Prefix Codes:\n';
            comment += item.prefixDescriptions.join('\n');
            json += replaceAll(comment, /^\s*(?=\S+)/gm, '    // ') + '\n';
        }
        json += replaceAll(
            JSON.stringify(pick(item, ['key', 'when', 'command', 'args']), null, 4),
            /^/gm,
            '    '
        );
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

export function filterBindingFn(
    mode?: string,
    prefixCode?: number,
    forVisualDoc: boolean = false
) {
    return function filterBinding(binding: IConfigKeyBinding) {
        if (binding.args.hideInPalette && !forVisualDoc) {
            return false;
        }
        if (binding.args.hideInDocs && forVisualDoc) {
            return false;
        }
        if (isSingleCommand(binding.args.do, 'master-key.ignore')) {
            return false;
        }
        if (
            mode !== undefined &&
            binding.args.mode !== undefined &&
            binding.args.mode !== mode
        ) {
            return false;
        }
        if (
            prefixCode !== undefined &&
            binding.args.prefixCode !== undefined &&
            binding.args.prefixCode !== prefixCode
        ) {
            return false;
        }
        if (mode === undefined && prefixCode === undefined) {
            if (!binding.args.do.every(c => c.computedArgs === undefined)) {
                return false;
            }
        }
        return true;
    };
}

async function copyBindings(file: vscode.Uri) {
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        vscode.languages.setTextDocumentLanguage(ed.document, 'markdown');
        const fileData = await vscode.workspace.fs.readFile(file);
        const fileText = new TextDecoder().decode(fileData);
        const wholeDocument = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, ed.document.lineCount + 1)
        );
        await ed.edit(builder => {
            builder.replace(wholeDocument, fileText);
        });
    }
}

async function removeKeybindings() {
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        await createBindings('');
        const oldBindingsStart = findText(ed.document, 'AUTOMATED BINDINGS START');
        const oldBindingsEnd = findText(ed.document, 'AUTOMATED BINDINGS END');
        if (oldBindingsStart && oldBindingsEnd) {
            const range = new vscode.Range(
                new vscode.Position(
                    oldBindingsStart.start.line - 1,
                    ed.document.lineAt(oldBindingsStart.start.line - 1).range.end.character
                ),
                new vscode.Position(oldBindingsEnd.end.line + 1, 0)
            );
            await ed.edit(builder => {
                builder.delete(range);
            });
            ed.revealRange(new vscode.Range(range.start, range.start));
            await vscode.commands.executeCommand('workbench.action.files.save');
            vscode.window.showInformationMessage(`Your master keybindings have
                been updated in \`keybindings.json\`.`);
        } else {
            vscode.window.showErrorMessage(
                'Master Key tried to remove bindings but there ' +
                    'were no master key bindings to remove.'
            );
        }
    }
}

async function copyCommandResultIntoBindingFile(command: string) {
    const oldEd = vscode.window.activeTextEditor;
    const oldDocument = oldEd?.document;
    if (oldEd?.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('Expected current file to be a markdown file.');
        return;
    }
    await vscode.commands.executeCommand(command);
    const ed = vscode.window.activeTextEditor;
    if (ed && oldEd) {
        let text = ed.document.getText();
        text = text.replace(
            /^.*AUTOMATED BINDINGS START(.|\n|\r)+AUTOMATED BINDINGS END.*$/m,
            ''
        );
        const keys = vscodeBinding.array().safeParse(JSONC.default.parse(text));
        if (!keys.success) {
            for (const issue of keys.error.issues.slice(0, 3)) {
                showParseError('Validation error: ', issue);
            }
        } else {
            const tomlText = TOML.stringify({bind: keys.data});
            if (oldDocument) {
                await vscode.window.showTextDocument(oldDocument);
                const tomlEd = vscode.window.activeTextEditor;
                if (tomlEd) {
                    const lastLine = tomlEd.document.lineCount;
                    const lastLinePos = new vscode.Position(lastLine, 0);
                    await tomlEd.edit(edit => {
                        const header = '\n\n# Keybindings imported from existing shortcuts';
                        const line =
                            '\n# -----------------------------------------------\n';
                        edit.insert(
                            lastLinePos,
                            header + line + tomlText + '\n' + line + '\n'
                        );
                    });
                    tomlEd.revealRange(new vscode.Range(lastLinePos, lastLinePos));
                }
            }
        }
    }
}

async function insertKeybindingsIntoConfig(bindings: Bindings) {
    const name = bindings.name || 'none';
    const keyBindings = bindings.bind;

    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        const bracket = findText(ed.document, '[');
        if (!bracket) {
            vscode.window.showErrorMessage(
                'Could not find opening `[` at top of ' +
                    'keybindings file. Your keybinding file does not appear to be ' +
                    'proplery formatted.'
            );
            return;
        } else {
            const insertAt = bracket.end;
            const bindingsToInsert = formatBindings(name, keyBindings);

            // try and replace the old bindings
            const oldBindingsStart = findText(ed.document, 'AUTOMATED BINDINGS START');
            const oldBindingsEnd = findText(ed.document, 'AUTOMATED BINDINGS END');
            let installed = false;
            if (oldBindingsStart && oldBindingsEnd) {
                const range = new vscode.Range(
                    new vscode.Position(
                        oldBindingsStart.start.line - 1,
                        ed.document.lineAt(
                            oldBindingsStart.start.line - 1
                        ).range.end.character
                    ),
                    new vscode.Position(oldBindingsEnd.end.line + 1, 0)
                );
                await ed.edit(builder => {
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
                await ed.edit(builder => {
                    builder.insert(insertAt, '\n' + bindingsToInsert);
                });
                ed.revealRange(new vscode.Range(insertAt, insertAt));
                await vscode.commands.executeCommand('workbench.action.files.save');
                installed = true;
            }

            if (installed) {
                if ((bindings.requiredExtensions || []).length === 0) {
                    vscode.window.showInformationMessage(
                        'Master keybindings were added to `keybindings.json`'
                    );
                    return;
                }
                vscode.window
                    .showInformationMessage(
                        replaceAll(
                            `Master keybindings were added to \`keybindings.json\`.
                            Install associated extensions with the \`Master Key: Install Active
                            Keybinding Extensions\` command`,
                            /\s+/g,
                            ' '
                        ),
                        {},
                        'Install Extensions'
                    )
                    .then(async request => {
                        if (request === 'Install Extensions') {
                            return await handleRequireExtensions();
                        }
                        return undefined;
                    });
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// User-facing commands and helpers

export function processParsing(
    parsedBindings: ParsedResult<FullBindingSpec>,
    errorPrefix: string = ''
) {
    if (parsedBindings.success) {
        const [bindings, problems] = processBindings(parsedBindings.data);
        for (const problem of problems.slice(0, 3)) {
            vscode.window.showErrorMessage(errorPrefix + 'Parsing error: ' + problem);
        }
        return bindings;
    } else {
        for (const issue of (<ErrorResult>parsedBindings).error.issues.slice(0, 3)) {
            showParseError(errorPrefix + 'Parsing error: ', issue);
        }
        return;
    }
}

interface PresetPick extends vscode.QuickPickItem {
    preset?: Preset;
    command?: string;
}

async function makeQuickPicksFromPresets(
    presets: Preset[],
    newDirs: string[] = []
): Promise<PresetPick[]> {
    const nameCount: Record<string, number> = {};
    const newPresets = await loadPresets(
        newDirs.map(x => vscode.Uri.from({scheme: 'file', path: x}))
    );
    const allPresets = presets.concat(newPresets);

    const presetsWithBindings = Promise.all(
        allPresets.map(async (preset: Preset): Promise<Preset & {binding?: Bindings}> => {
            const result = await parseBindings(preset.data);
            if (result.success) {
                return {
                    ...preset,
                    binding: await processBindings(result.data)[0],
                };
            } else {
                return {...preset, binding: undefined};
            }
        })
    );
    for (const preset of await presetsWithBindings) {
        const name = preset.binding?.name || Utils.basename(preset.uri);
        const count = nameCount[name] || 0;
        nameCount[name] = count + 1;
    }

    const curNameCount: Record<string, number> = {};
    return (await presetsWithBindings).map(preset => {
        const name = preset.binding?.name || Utils.basename(preset.uri);
        const count = curNameCount[name] || 0;
        curNameCount[name] = count + 1;
        if (nameCount[name] > 1) {
            return {
                preset,
                label: `${name} (${curNameCount[name]})`,
                detail: preset.uri.path,
            };
        } else {
            return {preset, label: name};
        }
    });
}

export async function queryPreset(): Promise<Preset | undefined> {
    const options = await makeQuickPicksFromPresets(await keybindingPresets);
    options.push(
        {label: 'add new presets...', kind: vscode.QuickPickItemKind.Separator},
        {label: 'Current File', command: 'current'},
        {label: 'File...', command: 'file'},
        {label: 'Directory...', command: 'dir'}
    );
    const picked = await vscode.window.showQuickPick(options);
    if (picked?.command === 'current') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('There is no current file');
        } else {
            const text = editor.document.getText();
            const uri = editor.document.uri;
            let langId: string | undefined = editor.document.languageId;
            if (langId === 'plaintext') {
                langId = undefined;
            }

            return {
                uri,
                data: text,
            };
        }
    } else if (picked?.command === 'file') {
        const file = await vscode.window.showOpenDialog({
            openLabel: 'Import Master-Key-Binding Spec',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            filters: {Preset: ['toml']},
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
        });
        if (file && file.length === 1) {
            const fileData = await vscode.workspace.fs.readFile(file[0]);
            const data = new TextDecoder().decode(fileData);
            return {
                uri: file[0],
                data,
            };
        }
    } else if (picked?.command === 'dir') {
        const config = vscode.workspace.getConfiguration('master-key');
        const dir = await vscode.window.showOpenDialog({
            openLabel: 'Select Directory',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
        });

        if (dir) {
            let dirs = config.get<string[]>('presetDirectories') || [];
            dirs.push(dir[0].fsPath);
            dirs = uniq(dirs);
            await config.update(
                'presetDirectories',
                dirs,
                vscode.ConfigurationTarget.Global
            );
            return queryPreset();
        }
    } else {
        return picked?.preset;
    }
    return undefined;
}

async function copyBindingsToNewFile() {
    const options = makeQuickPicksFromPresets(await keybindingPresets);
    const picked = await vscode.window.showQuickPick(options);
    if (picked?.preset) {
        copyBindings(picked.preset.uri);
    }
}

async function handleRequireExtensions(bindings_?: Bindings) {
    let bindings: Bindings;
    if (bindings_) {
        bindings = bindings_;
    } else {
        if (config.bindings) {
            bindings = config.bindings;
        } else {
            return;
        }
    }

    const items: vscode.QuickPickItem[] = bindings.requiredExtensions.map(id => {
        const exts = vscode.extensions.all.filter(x => x.id === id);
        if (exts.length > 0) {
            return {label: id, detail: 'already installed', picked: true};
        } else {
            return {
                label: id,
                detail: 'unknown status',
                picked: false,
                buttons: [
                    {iconPath: new vscode.ThemeIcon('eye'), tooltip: 'view extension'},
                ],
            };
        }
    });
    if (items.length === 0 || items.every(it => it.detail === 'already installed')) {
        return;
    }
    items.unshift({
        label: 'Install All',
        picked: false,
    });
    const picker = vscode.window.createQuickPick();
    picker.title = `Extensions Used by ${bindings.name}`;
    picker.items = items;
    picker.canSelectMany = true;
    picker.placeholder = 'Select extensions to install';
    picker.matchOnDetail;
    picker.ignoreFocusOut = true;

    picker.onDidTriggerItemButton(e => {
        vscode.commands.executeCommand('workbench.extensions.search', e.item.label);
    });

    let resolveFn: () => void;
    const pickPromise = new Promise<void>((res, _rej) => {
        resolveFn = res;
    });
    picker.onDidHide(_ => {
        resolveFn();
        picker.dispose();
    });
    let accept = false;
    picker.onDidAccept(_ => {
        accept = true;
        picker.hide();
    });
    picker.show();

    await pickPromise;
    if (!accept) {
        return;
    }

    if (picker.selectedItems.some(it => it.label === 'Install All')) {
        for (const item of picker.items) {
            if (item.detail === 'unknown status') {
                await vscode.commands.executeCommand(
                    'workbench.extensions.installExtension',
                    item.label
                );
            }
        }
    }

    for (const item of picker.selectedItems) {
        if (item.detail === 'unknown status') {
            await vscode.commands.executeCommand(
                'workbench.extensions.installExtension',
                item.label
            );
        }
    }
}

async function activateBindings(preset?: Preset) {
    if (!preset) {
        preset = await queryPreset();
    }
    if (preset) {
        const bindings = await createBindings(preset.data);
        if (bindings) {
            await handleRequireExtensions(bindings);
            await insertKeybindingsIntoConfig(bindings);
            await vscode.commands.executeCommand('master-key.showVisualDoc');
            await vscode.commands.executeCommand('master-key.showTextDoc');
        }
    }
}

async function deleteUserBindings() {
    const bindings = await clearUserBindings();
    if (bindings) {
        insertKeybindingsIntoConfig(bindings);
    }
}

async function selectUserBindings(file?: vscode.Uri) {
    if (!file) {
        const currentUri = vscode.window.activeTextEditor?.document.fileName;
        let currentFile;
        if (currentUri) {
            currentFile = vscode.Uri.from({scheme: 'file', path: currentUri});
        }

        const files = await vscode.window.showOpenDialog({
            openLabel: 'Import User Bindings',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            filters: {Binding: ['toml']},
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: currentFile,
        });
        if (files && files.length === 1) {
            file = files[0];
        }
    }
    if (file) {
        const fileData = await vscode.workspace.fs.readFile(file);
        const data = new TextDecoder().decode(fileData);
        const bindings = await createUserBindings(data);
        if (bindings) {
            await insertKeybindingsIntoConfig(bindings);
        }
    }
}

// TODO: we also evenutally want to have a way to customize presets
// replacementout having to modify it (for small tweaks)
// TODO: we want to be able to export a preset to a file
// TODO: we should be able to delete user defined presets

interface Preset {
    uri: vscode.Uri;
    data: string;
}
let keybindingPresets: Promise<Preset[]>;

export async function updatePresets(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        const userDirs = config
            .get<string[]>('presetDirectories')
            ?.map(x => vscode.Uri.from({scheme: 'file', path: x}));
        let allDirs;
        if (userDirs) {
            allDirs = [extensionPresetsDir].concat(userDirs);
        } else {
            allDirs = [extensionPresetsDir];
        }

        keybindingPresets = loadPresets(allDirs);
    }
}

const presetFiles = ['larkin.toml'];

async function loadPreset(presets: Preset[], uri: vscode.Uri) {
    const fileData = await vscode.workspace.fs.readFile(uri);
    const data = new TextDecoder().decode(fileData);
    presets.push({uri, data});
}

async function loadPresets(allDirs: vscode.Uri[]) {
    const presets: Preset[] = [];
    for (const dir of allDirs) {
        // special case this directory (so it works (??) in the web context)
        if (dir === extensionPresetsDir) {
            for (const preset of presetFiles) {
                const uri = Utils.joinPath(dir, preset);
                loadPreset(presets, uri);
            }
        } else {
            for (const [filename, type] of await vscode.workspace.fs.readDirectory(dir)) {
                if (type === vscode.FileType.File && /toml$/.test(filename)) {
                    const uri = Utils.joinPath(dir, filename);
                    await loadPreset(presets, uri);
                }
            }
        }
    }
    return presets;
}

let extensionPresetsDir: vscode.Uri;

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.activateBindings', activateBindings)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.selectUserBindings', selectUserBindings)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.removeUserBindings', deleteUserBindings)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.editPreset', copyBindingsToNewFile)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.importUserBindings', () =>
            copyCommandResultIntoBindingFile('workbench.action.openGlobalKeybindingsFile')
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.importDefaultBindings', () =>
            copyCommandResultIntoBindingFile('workbench.action.openDefaultKeybindingsFile')
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.installRequiredExtensions',
            handleRequireExtensions
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.deactivateBindings', removeKeybindings)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.installKeybindingExtensions', () =>
            handleRequireExtensions()
        )
    );

    console.log('presetdir: ' + Utils.joinPath(context.extensionUri, 'presets').toString());
    extensionPresetsDir = Utils.joinPath(context.extensionUri, 'presets/');

    updatePresets();
    vscode.workspace.onDidChangeConfiguration(updatePresets);
}
