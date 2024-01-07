import * as vscode from 'vscode';
import { searchMatches } from './searching';
import { parseBindings, BindingSpec, showParseError, parseBindingFile } from './keybindingParsing';
import { processBindings, IConfigKeyBinding, Bindings } from './keybindingProcessing';
import { pick } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import uri, { Utils } from 'vscode-uri'
import z from 'zod';

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
    // bindings you want *outside* of the automated bindings region as it will be modified
    // when new presets are imported.
`;

const AUTOMATED_COMMENT_END = `
    // AUTOMATED BINDINGS END: Master Key Bindings

    // Leave this comment (and the one denoting the start) unmodified to ensure the
    // automated bindings are properly updated if/when you insert another preset
`;

function findText(doc: vscode.TextDocument, text: string) {
    let matches = searchMatches(doc, new vscode.Position(0, 0), undefined, text, {});
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
                // TODO: uncomment after debugging
                // vscode.commands.executeCommand('workbench.action.files.save');
                vscode.window.showInformationMessage(`Your modal key bindings have
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
                // TODO: uncomment after debugging
                // TODO: also have the cursor moved to the start of the
                // automated bindings
                // vscode.commands.executeCommand('workbench.action.files.save');
                vscode.window.showInformationMessage(`Your modal key bindings have
                    been inserted into \`keybindings.json\`.`);
            }
        }
    }
}


////////////////////////////////////////////////////////////////////////////////////////////
// User-facing commands and helpers

export async function processParsing<T>(parsedBindings: z.SafeParseReturnType<T, BindingSpec>){
    if(parsedBindings.success){
        let [bindings, problems] = processBindings(parsedBindings.data);
        for (let problem of problems.slice(0, 3)){
            vscode.window.showErrorMessage("Parsing error: "+problem);
        }
        return bindings;
    }else{
        for (let issue of parsedBindings.error.issues.slice(0, 3)) {
            showParseError("Parsing error: ", issue);
        }
    }
}

async function resolvePresets(presets: Preset[]){
    let result: ResolvedPreset[] = [];
    for(let preset of presets){
        if(!preset.resolved){
            let resolved = await preset.promise;
            if(resolved){
                result.push({
                    resolved: true,
                    uri: preset.uri,
                    name: resolved.name || preset.name,
                    bindings: resolved
                });
            }
        }else{
            result.push(preset);
        }
    }
    return result;
}

interface PresetPick extends vscode.QuickPickItem{
    preset?: ResolvedPreset
}

function makeQuickPicksFromPresets(presets: ResolvedPreset[]): PresetPick[]{
    let nameCount: Record<string, number> = {};
    for(let preset of presets){
        let count = nameCount[preset.name] || 0;
        nameCount[name] = count+1;
    }

    return presets.map(preset => {
        if(nameCount[preset.name] > 1){
            return {preset, label: preset.name, detail: preset.uri.path};
        }else{
            return {preset, label: preset.name};
        }
    });
}

async function selectPreset(){
    let options = makeQuickPicksFromPresets(await resolvePresets(keybindingPresets));
    options.push({label: "Use Current File"}, {label: "Use File..."}, {label: "Add Directory..."});
    let picked = await vscode.window.showQuickPick(options);
    if(picked?.label === "Use Current File"){
        let editor = vscode.window.activeTextEditor;
        if(!editor){
            vscode.window.showErrorMessage("There is no current file");
        }else{
            let text = editor.document.getText();
            let uri = editor.document.uri;
            let langId = editor.document.languageId;
            let bindings = await processParsing(parseBindings(text,
                langId || Utils.extname(uri)));

            return bindings;
        }
    }else if(picked?.label === 'Use File...'){
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
            return bindings;
        }
    }else if(picked?.label === 'Add Directory of Presets...'){
        let config = vscode.workspace.getConfiguration('master-key');
        let dir = await vscode.window.showOpenDialog({
            openLabel: "Select Directory",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        });

        if(dir){
            let dirs = config.get<string[]>('presetDirectories');
            dirs?.push();
            await config.update('pressetDirectories', dirs, vscode.ConfigurationTarget.Global);
            selectPreset();
        }
    }else{
        return picked?.preset?.bindings;
    }
}

async function importBindings(file: vscode.Uri, preset: Bindings) {
    if (preset === undefined) { return; }
    if(preset){
        insertKeybindingsIntoConfig(file, preset.bind);
        let config = vscode.workspace.getConfiguration('master-key');
        config.update('definitions', preset.define, vscode.ConfigurationTarget.Global);
    }
}

// TODO: we also evenutally want to have a way to customize presets
// replacementout having to modify it (for small tweaks)
// TODO: we want to be able to export a preset to a file
// TODO: we should be able to delete user defined presets

interface UnresolvedPreset {
    resolved: false,
    uri: vscode.Uri,
    name: string,
    promise: Promise<Bindings | undefined>,
}
interface ResolvedPreset{
    resolved: true,
    uri: vscode.Uri,
    name: string
    bindings: Bindings,
}
type Preset = UnresolvedPreset | ResolvedPreset;
let keybindingPresets: Preset[] = [];

async function updatePresets(event?: vscode.ConfigurationChangeEvent){
    if(!event || event.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        let userDirs = config.get<string[]>('presetDirectories')?.map(x =>
            uri.URI.from({scheme: "file", path: x}));
        let allDirs;
        if(userDirs){ allDirs = [extensionPresetsDir].concat(); }
        else{ allDirs = [extensionPresetsDir]; }

        for(let dir of allDirs){
            for(let [filename, type] of await vscode.workspace.fs.readDirectory(dir)){
                if(type === vscode.FileType.File){
                    let uri = Utils.joinPath(extensionPresetsDir, filename);
                    let bindings = processParsing(await parseBindingFile(uri));
                    let [label] = Utils.basename(uri).split('.');
                    keybindingPresets.push({promise: bindings, name: label, uri, resolved: false});
                }
            }
        }
    }
}

let extensionPresetsDir: vscode.Uri;
export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(
        'master-key.selectPreset',
        selectPreset
    ));
    extensionPresetsDir = Utils.joinPath(context.extensionUri, "presets");
    updatePresets();
    vscode.workspace.onDidChangeConfiguration(updatePresets);
}
