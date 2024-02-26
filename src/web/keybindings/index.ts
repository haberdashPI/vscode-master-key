import * as vscode from 'vscode';
import { searchArgs, searchMatches } from '../commands/search';
import { parseBindings, BindingSpec, showParseError, parseBindingFile, bindingSpec } from './parsing';
import { processBindings, IConfigKeyBinding, Bindings } from './processing';
import { uniq, pick } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { Utils } from 'vscode-uri';
import z from 'zod';
import { withState } from '../state';
import { MODE } from '../commands/mode';

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
    // AUTOMATED BINDINGS END: Master Key Bindings

    // Leave this comment (and the one denoting the start) unmodified to ensure the
    // automated bindings are properly updated if/when you insert another preset
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
            let comment = "Prefix Codes:\n";
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
                    new vscode.Position(oldBindingsEnd.end.line + 4, 0));
                await ed.edit(builder => {
                    builder.replace(range, bindingsToInsert);
                });
                ed.revealRange(new vscode.Range(range.start, range.start));
                vscode.commands.executeCommand('workbench.action.files.save');
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
                vscode.commands.executeCommand('workbench.action.files.save');
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

async function queryPreset(): Promise<Preset | undefined> {
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
            openLabel: "Import Modal-Key-Binding Spec",
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
    let config = vscode.workspace.getConfiguration('master-key');
    withState(async state => state.update(MODE, x => 'insert'));
    config.update('definitions', preset.define, vscode.ConfigurationTarget.Global);
}

export async function selectPreset(preset?: Preset){
    if(!preset){ preset = await queryPreset(); }
    if(preset){ importBindings(preset.uri, preset.bindings); }
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

function updatePresets(event?: vscode.ConfigurationChangeEvent){
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

async function loadPresets(allDirs: vscode.Uri[]){
    let presets: Preset[] = [];
    for(let dir of allDirs){
        for(let [filename, type] of await vscode.workspace.fs.readDirectory(dir)){
            if(type === vscode.FileType.File &&
                /(json|jsonc|yml|yaml|toml)$/.test(filename)){

                let uri = Utils.joinPath(dir, filename);
                let bindings = processParsing(await parseBindingFile(uri), filename+" ");
                let [label] = Utils.basename(uri).split('.');
                if(bindings){
                    if(bindings.name){ label = bindings.name; }
                    presets.push({bindings, name: label, uri});
                }
            }
        }
    }
    return presets;
}

let extensionPresetsDir: vscode.Uri;
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.selectPreset',
        selectPreset
    ));
    extensionPresetsDir = Utils.joinPath(context.extensionUri, "presets");
    updatePresets();
    vscode.workspace.onDidChangeConfiguration(updatePresets);
}
