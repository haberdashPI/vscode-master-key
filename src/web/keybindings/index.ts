import * as vscode from 'vscode';
import { searchArgs, searchMatches } from '../commands/search';
import { parseBindings, BindingSpec, showParseError, parseBindingFile, bindingSpec, bindingItem, vscodeBinding, ModeSpec } from './parsing';
import { processBindings, IConfigKeyBinding, Bindings, isSingleCommand } from './processing';
import { uniq, pick, words } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { Utils } from 'vscode-uri';
import z from 'zod';
import { withState } from '../state';
import { MODE, defaultMode } from '../commands/mode';
import { updateConfig } from '../config';
const JSONC = require("jsonc-simple-parser");
const TOML = require("smol-toml");

////////////////////////////////////////////////////////////////////////////////////////////
// Keybinding Generation

const AUTOMATED_COMMENT_START_PREFIX = `
    // AUTOMATED BINDINGS START: Master Key Bindings
    //
    // These bindings were automatically inserted by the master-key extension from the
    // following file:
    //
`;

const AUTOMATED_COMMENT_START_SUFFIX = `
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
    let matches = searchMatches(doc, new vscode.Position(0, 0), undefined, text,
                                searchArgs.parse({}));
    let firstMatchResult = matches.next();
    if (firstMatchResult.done) { return undefined; }

    return firstMatchResult.value;
}

function formatBindings(file: vscode.Uri, items: IConfigKeyBinding[]){
    let json = "";
    for(let item of items){
        if(item.prefixDescriptions.length > 0){
            let comment = "Automated binding; avoid editing manually, instead use one of these commands";
            comment += "'Master Key: Select Binding Preset";
            comment += "'Master Key: Remove Bindings";
            comment += "Prefix Codes:\n";
            comment += item.prefixDescriptions.join("\n");
            json += replaceAll(comment, /^\s*(?=\S+)/mg, "    // ")+"\n";
        }
        json += replaceAll(JSON.stringify(pick(item, ['key', 'when', 'command', 'args']),
            null, 4), /^/mg, "    ");
        json += ",\n\n";
    }
    return (
        AUTOMATED_COMMENT_START_PREFIX+
        "    // `"+file.toString()+"`"+
        AUTOMATED_COMMENT_START_SUFFIX+
        "\n" + json +
        AUTOMATED_COMMENT_END
    );
}

let keybindings: IConfigKeyBinding[] = [];
async function saveKeybindingsToStorage(config: any){
    keybindings = config;
    vscode.workspace.fs.createDirectory(storageUri);
    let configFile = vscode.Uri.joinPath(storageUri, 'config.json');
    let data = new TextEncoder().encode(JSON.stringify(config));
    vscode.workspace.fs.writeFile(configFile, data);
}

async function restoreKeybindingsFromStorage(){
    let configFile = vscode.Uri.joinPath(storageUri, 'config.json');
    try{
        await vscode.workspace.fs.stat(configFile);
        let data = await vscode.workspace.fs.readFile(configFile);
        keybindings = JSON.parse(new TextDecoder().decode(data));
    }catch{
        console.error("No keybindings found at: "+configFile);
        return;
    }
}

export function filterBindingFn(mode?: string, prefixCode?: number) {
    return function filterBinding(binding_: any) {
        let binding = <IConfigKeyBinding>binding_;
        if(binding.args.hideInPalette){
            return false;
        }
        if (isSingleCommand(binding.args.do, 'master-key.ignore')) {
            return false;
        }
        if (mode !== undefined && binding.args.mode !== undefined && binding.args.mode !== mode) {
            return false;
        }
        if (prefixCode !== undefined && binding.args.prefixCode !== undefined &&
            binding.args.prefixCode !== prefixCode) {
            return false;
        }
        if (mode === undefined && prefixCode === undefined){
            if(!binding.args.do.every(c => c.computedArgs === undefined)){
                return false;
            }
        }
        return true;
    };
}

export function currentKeybindings(){
    return keybindings;
}

async function copyBindings(file: vscode.Uri){
    await vscode.commands.executeCommand("workbench.action.files.newUntitledFile");
    let ed = vscode.window.activeTextEditor;
    if(ed){
        vscode.languages.setTextDocumentLanguage(ed.document, 'markdown');
        let fileData = await vscode.workspace.fs.readFile(file);
        let fileText = new TextDecoder().decode(fileData);
        let wholeDocument = new vscode.Range(new vscode.Position(0, 0),
            new vscode.Position(0, ed.document.lineCount+1));
        await ed.edit(builder => { builder.replace(wholeDocument, fileText); });
    }
}

async function removeKeybindings(){
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    let ed = vscode.window.activeTextEditor;
    if(ed){
        let oldBindingsStart = findText(ed.document, "AUTOMATED BINDINGS START");
        let oldBindingsEnd = findText(ed.document, "AUTOMATED BINDINGS END");
        ed.document.getText(oldBindingsStart);
        if (oldBindingsStart && oldBindingsEnd) {
            let range = new vscode.Range(
                new vscode.Position(oldBindingsStart.start.line-1,
                                    ed.document.lineAt(oldBindingsStart.start.line-1).range.end.character),
                new vscode.Position(oldBindingsEnd.end.line + 4, 0));
            await ed.edit(builder => { builder.delete(range); });
            ed.revealRange(new vscode.Range(range.start, range.start));
            await vscode.commands.executeCommand('workbench.action.files.save');
            vscode.window.showInformationMessage(`Your master keybindings have
                been updated in \`keybindings.json\`.`);
        } else {
            vscode.window.showErrorMessage(`You appear to have altered the comments
                around the automated bindings, or you have already removed the bindings.`);
        }
    }
}

async function copyCommandResultIntoBindingFile(command: string){
    let oldEd = vscode.window.activeTextEditor;
    let oldDocument = oldEd?.document;
    if(oldEd?.document.languageId !== 'markdown'){
        vscode.window.showErrorMessage("Expected current file to be a markdown file.");
        return;
    }
    await vscode.commands.executeCommand(command);
    let ed = vscode.window.activeTextEditor;
    if(ed && oldEd){
        let text = ed.document.getText();
        text = text.replace(/^.*AUTOMATED BINDINGS START(.|\n|\r)+AUTOMATED BINDINGS END.*$/m, "");
        let keys = vscodeBinding.array().safeParse(JSONC.default.parse(text));
        if(!keys.success){
            for (let issue of keys.error.issues.slice(0, 3)) {
                showParseError("Validation error: ", issue);
            }
        }else{
            let tomlText = TOML.stringify({bind: keys.data});
            if(oldDocument){
                await vscode.window.showTextDocument(oldDocument);
                let tomlEd = vscode.window.activeTextEditor;
                if(tomlEd){
                    let lastLine = tomlEd.document.lineCount;
                    let lastLinePos = new vscode.Position(lastLine, 0);
                    await tomlEd.edit(edit => {
                        let header = "\n\n# Keybindings imported from existing shortcuts";
                        let line = "\n# -----------------------------------------------\n";
                        edit.insert(lastLinePos, header + line + tomlText + "\n" + line + "\n");
                    });
                    tomlEd.revealRange(new vscode.Range(lastLinePos, lastLinePos));
                }
            }
        }
    }
}

async function insertKeybindingsIntoConfig(file: vscode.Uri, config: any) {
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    let ed = vscode.window.activeTextEditor;
    if (ed){
        let bracket = findText(ed.document, "[");
        if (!bracket) {
            vscode.window.showErrorMessage("Could not find opening `[` at top of " +
                "keybindings file. Your keybinding file does not appear to be " +
                "proplery formatted.");
            return;
        } else {
            let insertAt = bracket.end;
            let bindingsToInsert = formatBindings(file, config);

            // try and replace the old bindings
            let oldBindingsStart = findText(ed.document, "AUTOMATED BINDINGS START");
            let oldBindingsEnd = findText(ed.document, "AUTOMATED BINDINGS END");
            ed.document.getText(oldBindingsStart);
            if (oldBindingsStart && oldBindingsEnd) {
                let range = new vscode.Range(
                    new vscode.Position(oldBindingsStart.start.line-1,
                                        ed.document.lineAt(oldBindingsStart.start.line-1).range.end.character),
                    new vscode.Position(oldBindingsEnd.end.line+1, 0));
                await ed.edit(builder => {
                    builder.replace(range, bindingsToInsert);
                });
                ed.revealRange(new vscode.Range(range.start, range.start));
                await vscode.commands.executeCommand('workbench.action.files.save');
                await saveKeybindingsToStorage(config);
                vscode.window.showInformationMessage(`Your master keybindings have
                    been updated in \`keybindings.json\`.`);
            } else if (oldBindingsEnd || oldBindingsStart){
                vscode.window.showErrorMessage(`You appear to have altered the comments
                    around the automated bindings. Please delete the old, automated
                    bindings manually and then re-run this command.`);
            }else {
                // if there are no old bindings, insert new ones
                await ed.edit(builder => {
                    builder.insert(insertAt, "\n" + bindingsToInsert);
                });
                ed.revealRange(new vscode.Range(insertAt, insertAt));
                await vscode.commands.executeCommand('workbench.action.files.save');
                await saveKeybindingsToStorage(config);
                vscode.window.showInformationMessage(`Your master keybindings have
                    been inserted into \`keybindings.json\`.`);
            }
        }
    }
}


////////////////////////////////////////////////////////////////////////////////////////////
// User-facing commands and helpers

export function processParsing<T>(parsedBindings: z.SafeParseReturnType<T, BindingSpec>,
    errorPrefix: string = ""){

    if(parsedBindings.success){
        let [bindings, problems] = processBindings(parsedBindings.data);
        for (let problem of problems.slice(0, 3)){
            vscode.window.showErrorMessage(errorPrefix+"Parsing error: "+problem);
        }
        return bindings;
    }else{
        for (let issue of parsedBindings.error.issues.slice(0, 3)) {
            showParseError(errorPrefix+"Parsing error: ", issue);
        }
    }
}

interface PresetPick extends vscode.QuickPickItem{
    preset?: Preset
    command?: string
}

function makeQuickPicksFromPresets(presets: Preset[]): PresetPick[]{
    let nameCount: Record<string, number> = {};
    for(let preset of presets){
        let count = nameCount[preset.name] || 0;
        nameCount[preset.name] = count+1;
    }

    return presets.map(preset => {
        if(nameCount[preset.name] > 1){
            return {preset, label: preset.name, detail: preset.uri.path};
        }else{
            return {preset, label: preset.name};
        }
    });
}

export async function queryPreset(): Promise<Preset | undefined> {
    let options = makeQuickPicksFromPresets(await keybindingPresets);
    options.push(
        {label: "add new presets...", kind: vscode.QuickPickItemKind.Separator},
        {label: "Current File", command: "current"},
        {label: "File...", command: "file"},
        {label: "Directory...", command: "dir"}
    );
    let picked = await vscode.window.showQuickPick(options);
    if(picked?.command === "current"){
        let editor = vscode.window.activeTextEditor;
        if(!editor){
            vscode.window.showErrorMessage("There is no current file");
        }else{
            let text = editor.document.getText();
            let uri = editor.document.uri;
            let langId: string | undefined = editor.document.languageId;
            if(langId === 'plaintext'){ langId = undefined; }
            let bindings = await processParsing(parseBindings(text,
                langId || Utils.extname(uri)));

            if(bindings){
                return {
                    name: bindings.name || Utils.basename(uri),
                    uri,
                    bindings
                };
            }
        }
    }else if(picked?.command === 'file'){
        let file = await vscode.window.showOpenDialog({
            openLabel: "Import Master-Key-Binding Spec",
            // eslint-disable-next-line @typescript-eslint/naming-convention
            filters: { Preset: ["json", "jsonc", "toml", "yml", "yaml"] },
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false
        });
        if(file && file.length === 1){
            let bindings = await processParsing(await parseBindingFile(file[0]));
            if(bindings){
                return {
                    name: bindings.name || Utils.basename(file[0]),
                    uri: file[0],
                    bindings
                };
            }
        }
    }else if(picked?.command === 'dir'){
        let config = vscode.workspace.getConfiguration('master-key');
        let dir = await vscode.window.showOpenDialog({
            openLabel: "Select Directory",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        });

        if(dir){
            let dirs = config.get<string[]>('presetDirectories');
            dirs?.push(dir[0].fsPath);
            if(dirs){ dirs = uniq(dirs); }
            await config.update('presetDirectories', dirs, vscode.ConfigurationTarget.Global);
            updatePresets();
            return queryPreset();
        }
    }else{
        return picked?.preset;
    }
}

async function importBindings(file: vscode.Uri, preset: Bindings) {
    insertKeybindingsIntoConfig(file, preset.bind);
    await withState(async state => state.set(MODE, {public: true}, defaultMode).resolve());
    updateConfig('definitions', preset.define);
    updateConfig('mode', preset.mode);
}

async function copyBindingsToNewFile(){
    let options = makeQuickPicksFromPresets(await keybindingPresets);
    let picked = await vscode.window.showQuickPick(options);
    if(picked?.preset){
        copyBindings(picked.preset.uri);
    }
}

export async function selectPreset(preset?: Preset){
    if(!preset){ preset = await queryPreset(); }
    if(preset){ await importBindings(preset.uri, preset.bindings); }
}

// TODO: we also evenutally want to have a way to customize presets
// replacementout having to modify it (for small tweaks)
// TODO: we want to be able to export a preset to a file
// TODO: we should be able to delete user defined presets

interface Preset{
    uri: vscode.Uri,
    name: string
    bindings: Bindings,
}
let keybindingPresets: Promise<Preset[]>;

export function updatePresets(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let userDirs = config.get<string[]>('presetDirectories')?.map(x =>
            vscode.Uri.from({scheme: "file", path: x}));
        let allDirs;
        if(userDirs){ allDirs = [extensionPresetsDir].concat(userDirs); }
        else{ allDirs = [extensionPresetsDir]; }

        keybindingPresets = loadPresets(allDirs);
    }
}

let presetFiles = ['larkin.toml'];

async function loadPreset(presets: Preset[], uri: vscode.Uri){
    let bindings = processParsing(await parseBindingFile(uri), uri+" ");
    let [label] = Utils.basename(uri).split('.');
    if(bindings){
        if(bindings.name){ label = bindings.name; }
        presets.push({bindings, name: label, uri});
    }
}

async function loadPresets(allDirs: vscode.Uri[]){
    let presets: Preset[] = [];
    for(let dir of allDirs){
        // special case this directory (so it works (??) in the web context)
        if(dir === extensionPresetsDir){
            for(const preset of presetFiles){
                let uri = Utils.joinPath(dir, preset);
                loadPreset(presets, uri);
            }
        }else{
            for(let [filename, type] of await vscode.workspace.fs.readDirectory(dir)){
                if(type === vscode.FileType.File &&
                    /(json|jsonc|yml|yaml|toml)$/.test(filename)){

                    let uri = Utils.joinPath(dir, filename);
                    loadPreset(presets, uri);
                }
            }
        }
    }
    return presets;
}

let extensionPresetsDir: vscode.Uri;
let storageUri: vscode.Uri;

export async function activate(context: vscode.ExtensionContext) {
    storageUri = context.globalStorageUri;
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.selectPreset',
        selectPreset
    ));
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.removePreset',
        removeKeybindings,
    ));
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.editPreset',
        copyBindingsToNewFile,
    ));
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.importUserBindings',
        () => copyCommandResultIntoBindingFile('workbench.action.openGlobalKeybindingsFile')
    ));
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.importDefaultBindings',
        () => copyCommandResultIntoBindingFile('workbench.action.openDefaultKeybindingsFile')
    ));
    console.log("presetdir: "+Utils.joinPath(context.extensionUri, "presets").toString());
    extensionPresetsDir = Utils.joinPath(context.extensionUri, "presets/");
    await restoreKeybindingsFromStorage();

    updatePresets();
    vscode.workspace.onDidChangeConfiguration(updatePresets);
}
