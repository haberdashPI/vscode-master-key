import * as vscode from 'vscode';
import {searchArgs, searchMatches} from '../commands/search';
import {
    parseBindings,
    BindingSpec,
    showParseError,
    parseBindingFile,
    vscodeBinding,
} from './parsing';
import {processBindings, IConfigKeyBinding, Bindings, isSingleCommand} from './processing';
import {uniq, pick} from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import {Utils} from 'vscode-uri';
import z from 'zod';
import {createBindings} from './config';
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

export function filterBindingFn(mode?: string, prefixCode?: number) {
    return function filterBinding(binding: IConfigKeyBinding) {
        if (binding.args.hideInPalette) {
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
    const config = vscode.workspace.getConfiguration('master-key');
    config.update('activatedBindingsId', 'none', true);

    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    const ed = vscode.window.activeTextEditor;
    if (ed) {
        const oldBindingsStart = findText(ed.document, 'AUTOMATED BINDINGS START');
        const oldBindingsEnd = findText(ed.document, 'AUTOMATED BINDINGS END');
        ed.document.getText(oldBindingsStart);
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

async function insertKeybindingsIntoConfig(
    name: string,
    label: string,
    keyBindings: IConfigKeyBinding[]
) {
    const config = vscode.workspace.getConfiguration('master-key');
    await config.update('activatedBindingsId', label, true);

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
            ed.document.getText(oldBindingsStart);
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
                vscode.window.showInformationMessage(`Your master keybindings have
                    been updated in \`keybindings.json\`.`);
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
                vscode.window.showInformationMessage(`Your master keybindings have
                    been inserted into \`keybindings.json\`.`);
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
// User-facing commands and helpers

export function processParsing<T>(
    parsedBindings: z.SafeParseReturnType<T, BindingSpec>,
    errorPrefix: string = ''
) {
    if (parsedBindings.success) {
        const [bindings, problems] = processBindings(parsedBindings.data);
        for (const problem of problems.slice(0, 3)) {
            vscode.window.showErrorMessage(errorPrefix + 'Parsing error: ' + problem);
        }
        return bindings;
    } else {
        for (const issue of parsedBindings.error.issues.slice(0, 3)) {
            showParseError(errorPrefix + 'Parsing error: ', issue);
        }
        return;
    }
}

interface PresetPick extends vscode.QuickPickItem {
    preset?: Preset;
    command?: string;
}

function makeQuickPicksFromPresets(presets: Preset[]): PresetPick[] {
    const nameCount: Record<string, number> = {};
    for (const preset of presets) {
        const count = nameCount[preset.bindings.name || 'none'] || 0;
        nameCount[preset.bindings.name || 'none'] = count + 1;
    }

    return presets.map(preset => {
        if (nameCount[preset.bindings.name || 'none'] > 1) {
            return {preset, label: preset.bindings.name || 'none', detail: preset.uri.path};
        } else {
            return {preset, label: preset.bindings.name || 'none'};
        }
    });
}

export async function queryPreset(): Promise<Preset | undefined> {
    const options = makeQuickPicksFromPresets(await keybindingPresets);
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
            const bindings = await processParsing(
                parseBindings(text, langId || Utils.extname(uri))
            );

            if (bindings) {
                bindings.name = bindings.name || Utils.basename(uri);
                return {
                    uri,
                    bindings,
                };
            }
        }
    } else if (picked?.command === 'file') {
        const file = await vscode.window.showOpenDialog({
            openLabel: 'Import Master-Key-Binding Spec',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            filters: {Preset: ['json', 'jsonc', 'toml', 'yml', 'yaml']},
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
        });
        if (file && file.length === 1) {
            const bindings = await processParsing(await parseBindingFile(file[0]));
            if (bindings) {
                bindings.name = bindings.name || Utils.basename(file[0]);
                return {
                    uri: file[0],
                    bindings,
                };
            }
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
            let dirs = config.get<string[]>('presetDirectories');
            dirs?.push(dir[0].fsPath);
            if (dirs) {
                dirs = uniq(dirs);
            }
            await config.update(
                'presetDirectories',
                dirs,
                vscode.ConfigurationTarget.Global
            );
            updatePresets();
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

export async function selectPreset(preset?: Preset) {
    if (!preset) {
        preset = await queryPreset();
    }
    if (preset) {
        const label = await createBindings(preset.bindings);
        await insertKeybindingsIntoConfig(
            preset.bindings.name || 'none',
            label,
            preset.bindings.bind
        );
    }
}

// TODO: we also evenutally want to have a way to customize presets
// replacementout having to modify it (for small tweaks)
// TODO: we want to be able to export a preset to a file
// TODO: we should be able to delete user defined presets

interface Preset {
    uri: vscode.Uri;
    bindings: Bindings;
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
    const bindings = processParsing(await parseBindingFile(uri), uri + ' ');
    if (bindings) {
        presets.push({bindings, uri});
    }
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
                if (
                    type === vscode.FileType.File &&
                    /(json|jsonc|yml|yaml|toml)$/.test(filename)
                ) {
                    const uri = Utils.joinPath(dir, filename);
                    loadPreset(presets, uri);
                }
            }
        }
    }
    return presets;
}

let extensionPresetsDir: vscode.Uri;

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.selectPreset', selectPreset)
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
        vscode.commands.registerCommand('master-key.removePreset', removeKeybindings)
    );

    console.log('presetdir: ' + Utils.joinPath(context.extensionUri, 'presets').toString());
    extensionPresetsDir = Utils.joinPath(context.extensionUri, 'presets/');

    updatePresets();
    vscode.workspace.onDidChangeConfiguration(updatePresets);
}
