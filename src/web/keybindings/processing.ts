import hash from 'object-hash';
import { parseWhen, bindingItem, DoArgs, DefinedCommand, BindingItem, BindingSpec,
         rawBindingItem, RawBindingItem, ParsedWhen, ModeSpec } from "./parsing";
import z from 'zod';
import { sortBy, pick, isEqual, omit, mergeWith, cloneDeep, flatMap, mapValues, merge } from 'lodash';
import { reifyStrings, EvalContext } from '../expressions';
import { validateInput } from '../utils';
import { fromZodError } from 'zod-validation-error';

export interface Bindings{
    name?: string,
    description?: string,
    define: Record<string, any>;
    mode: Record<string, ModeSpec>;
    bind: IConfigKeyBinding[]
}

export function processBindings(spec: BindingSpec): [Bindings, string[]]{
    let problems: string[] = [];
    let items = expandDefaultsDefinedAndForeach(spec, problems);
    items = items.map((item, i) => requireTransientSequence(item, i, problems));
    items = expandPrefixes(items);
    items = expandModes(items, spec.mode, problems);
    items = expandDocsToDuplicates(items);
    let prefixCodes: PrefixCodes;
    [items, prefixCodes] = expandKeySequencesAndResolveDuplicates(items, problems);
    items = items.map(moveModeToWhenClause);
    let newItems = items.map(i => movePrefixesToWhenClause(i, prefixCodes));
    let definitions = {...spec.define, prefixCodes: prefixCodes.codes };
    let configItems = newItems.map(i => itemToConfigBinding(i, definitions));
    let result: Bindings = {
        name: spec.header.name,
        description: spec.header.description,
        define: definitions,
        mode: mapByName(spec.mode),
        bind: configItems,
    };
    return [result, problems];
}

function mapByName(specs: ModeSpec[]){
    let modeSpecs: Record<string, ModeSpec> = {};
    for(let spec of specs){
        modeSpecs[spec.name] = spec;
    }
    return modeSpecs;
}

function overwritePrefixesAndWhen(obj_: any, src_: any, key: string){
    if(key === 'prefixes' || key === 'when'){
        if(src_ !== undefined){
            return src_;
        }else{
            return obj_;
        }
    }else{
        // revert to default behavior
        return;
    }
}

function concatWhens(obj_: any, src_: any, key: string){
    if(key === 'when'){
        let obj: any[] = obj_ === undefined ? [] : !Array.isArray(obj_) ? [obj_] : obj_;
        let src: any[] = src_ === undefined ? [] : !Array.isArray(src_) ? [src_] : src_;
        return obj.concat(src);
    }else{
        // revert to default behavior
        return;
    }
}

const runCommandsArgs = z.object({
    commands: z.array(z.string().
        or(z.object({command: z.string()}).passthrough()).
        or(z.object({defined: z.string()}).passthrough()))
});

function expandDefinedCommands(item: RawBindingItem, definitions: any): RawBindingItem{
    if(item.command && item.command === 'runCommands'){
        let args = validateInput(`key ${item.key}, mode ${item.mode}; runCommands`, item.args, runCommandsArgs);
        let translatedArgs = !args ? item.args : flatMap(args.commands, cmd => {
            if(typeof cmd === 'string'){
                return [{command: cmd}];
            }else if(cmd.defined){
                let definedCommand = <DefinedCommand>cmd;
                let commands = definitions[definedCommand.defined];
                if(!commands){
                    throw new Error(`Command definition missing under
                        'define.${definedCommand.defined}`);
                }
                return commands.map((cmd: any) => {
                    if(cmd === 'string'){ return {command: cmd}; }
                    else{ return cmd; }
                });
            }else{
                return [cmd];
            }
        });
        return {...item, args: translatedArgs};
    }
    return item;
}

const partialRawBindingItem = rawBindingItem.partial();
type PartialRawBindingItem = z.infer<typeof partialRawBindingItem>;
type AppendFields = {when?: string};

function expandDefaultsDefinedAndForeach(spec: BindingSpec, problems: string[]): BindingItem[] {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    let pathDefaults: Record<string, PartialRawBindingItem> = {"": {}};
    let pathWhens: Record<string, ParsedWhen[]> = {};
    for(let path of spec.path){
        let parts = path.id.split('.');
        let defaults: PartialRawBindingItem = partialRawBindingItem.parse({});
        let whens: ParsedWhen[] = [];
        if(parts.length > 1){
            let prefix = parts.slice(0,-1).join('.');
            if(pathDefaults[prefix] === undefined){
                problems.push(`The path '${path.id}' was defined before
                    '${prefix}'.`);
            }else{
                defaults = cloneDeep(pathDefaults[prefix]);
                whens = cloneDeep(pathWhens[prefix]);
            }
        }
        pathDefaults[path.id] = mergeWith(defaults, path.default,
            overwritePrefixesAndWhen);
        if(path.when){
            pathWhens[path.id] = whens.concat(path.when);
        }
    }

    let items = spec.bind.flatMap((item, i) => {
        let itemDefault = pathDefaults[item.path || ""];
        let itemConcatWhen = pathWhens[item.path || ""];
        if(!itemDefault){
            problems.push(`The path '${item.path}' is undefined.`);
            return undefined;
        }else{
            item = mergeWith(cloneDeep(itemDefault), item, overwritePrefixesAndWhen);
            if(item.when){
                item.when = itemConcatWhen ? item.when.concat(itemConcatWhen) : item.when;
            }else if(itemConcatWhen){
                item.when = itemConcatWhen;
            }
            item = expandDefinedCommands(item, spec.define);
            let items = expandForeach(item, spec.define);
            return items.map(item => {
                let required = ['key', 'command'];
                let missing = required.filter(r => (<any>item)[r] === undefined);
                if(missing.length > 0){
                    problems.push(`Problem with binding ${i} ${item.path}:
                        missing field '${missing[0]}'`);
                    return undefined;
                }
                let result = bindingItem.safeParse({
                    key: item.key,
                    when: item.when,
                    mode: typeof item.mode === 'string' ? [item.mode] : item.mode,
                    prefixes: item.prefixes,
                    command: "master-key.do",
                    args: {
                        do: item.command === 'runCommands' ?
                            item.args : [pick(item, ['command', 'args', 'computedArgs', 'if'])],
                        path: item.path,
                        name: item.name,
                        description: item.description,
                        priority: item.priority,
                        hideInPalette: item.hideInPalette,
                        combinedName: item.combinedName,
                        combinedKey: item.combinedKey,
                        combinedDescription: item.combinedDescription,
                        kind: item.kind,
                        resetTransient: item.resetTransient,
                        repeat: item.repeat
                    }
                });
                if(!result.success){
                    problems.push(`Item ${i} with name ${item.name}: ${fromZodError(result.error).message}`);
                    return undefined;
                }else{
                    return result.data;
                }
            }).filter(i => i !== undefined);
        }
    });

    return <BindingItem[]>(items.filter(x => x !== undefined));
}

function requireTransientSequence(item: BindingItem, i: number, problems: string[]){
    if(item.args.do.some(c => c.command === "master-key.prefix")){
        if(item.args.resetTransient === undefined){
            item.args.resetTransient = false;
        }else if(item.args.resetTransient === true){
            problems.push(`Item ${i} with name ${item.args.name}: 'resetTransient' must be `+
                          `false for a command that calls 'master-key.prefix'`);
        }
    }else{
        if(item.args.resetTransient === undefined){
            item.args.resetTransient = true;
        }
    }

    return item;
}

// TODO: check in unit tests
// invalid items (e.g. both key and keys defined) get detected

function expandForVars(vars: Record<string, string[]>, items: RawBindingItem[], context: EvalContext,
    definitions: any): RawBindingItem[] {

    if(Object.keys(vars).length === 0){
        return items;
    }
    let aKey = Object.keys(vars)[0];
    let varValues = vars[aKey];
    let expandedItems = items.flatMap(item => {
        return varValues.map(val =>
            reifyStrings(item, str => context.evalExpressionsInString(str,
                {...definitions, [aKey]: val})));
    });

    return expandForVars(omit(vars, aKey), expandedItems, context, definitions);
}

const ALL_KEYS = [
    "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q",
    "r", "s", "t", "u", "v", "w", "x", "y", "z",
    "`", "-", "=", "\[", "\]", "\\", ";", "'", ",", "\.", "\/",
    "left", "up", "right", "down", "pageup", "pagedown", "end", "home",
    "tab", "enter", "escape", "space", "backspace", "delete",
    "pausebreak", "capslock", "insert",
    "numpad0", "numpad1", "numpad2", "numpad3", "numpad4", "numpad5", "numpad6", "numpad7",
    "numpad8", "numpad9",
    "numpad_multiply", "numpad_add", "numpad_separator", "numpad_subtract",
    "numpad_decimal", "numpad_divide",
];
let REGEX_KEY_REGEX = /\{keys(:\s*(.*))?\}/;

function expandPattern(pattern: string): string[] {
    let regkey = pattern.match(REGEX_KEY_REGEX);
    if(regkey !== null){
        let matchingKeys = ALL_KEYS;
        if(regkey[2]){
            let regex = new RegExp("^"+regkey[2]+"$");
            matchingKeys = matchingKeys.filter(k => regex.test(k));
        }
        return matchingKeys.map(k  => pattern.replace(REGEX_KEY_REGEX, k));
    }else{
        return [pattern];
    }
}

function expandForeach(item: RawBindingItem, definitions: any): RawBindingItem[] {
    let context = new EvalContext();
    if(item.foreach){
        let varValues = mapValues(item.foreach, v => flatMap(v, expandPattern));
        let result = expandForVars(varValues, [<RawBindingItem>(omit(item, 'foreach'))],
            context, definitions);
        context.reportErrors();
        return result;
    }else{
        return [item];
    }
}

function expandPrefixes(items: BindingItem[]){
    return flatMap(items, item => {
        if(item.prefixes && item.prefixes.length > 1){
            return item.prefixes.map(prefix => {
                return {...item, prefixes: [prefix]};
            });
        }
        return item;
    });
}

function expandModes(items: BindingItem[], validModes: ModeSpec[], problems: string[]){
    let defaultMode = validModes.filter(x => x.default)[0]; // validation should guarantee a single match
    return flatMap(items, (item: BindingItem): BindingItem[] => {
        let modes = item.mode || [defaultMode.name];
        if (modes.length > 0 && modes[0].startsWith('!')) {
            if(modes.some(x => !x.startsWith('!'))){
                problems.push(`Either all or none of the modes for binding ${item.key} `+
                              `must be prefixed with '!'`);
                modes = modes.filter(x => x.startsWith('!'));
            }
            let exclude = modes.map(m => m.slice(1));
            modes = validModes.map(x => x.name).filter(mode => !exclude.some(x => x === mode));
        }
        if (modes.length === 0) {
            return [item];
        } else {
            return modes.map(m => ({ ...item, mode: [m] }));
        }
    });
}

interface DocFields {
    description?: string
    combinedName?: string
    combinedDescription?: string
    combinedKey?: string
}
function expandDocsToDuplicates(items: BindingItem[]){
    let itemDocs: Record<string, DocFields> = {};

    // merge all doc keys across identical key/mode pairs
    for(let i=0;i<items.length;i++){
        let item = items[i];
        let key = hash([item.key, item.mode, item.prefixes[0]]);
        let oldDocs = itemDocs[key] || {};
        itemDocs[key] = merge(pick(item.args, ['description', 'combinedName', 'combinedDescription', 'combinedKey']), oldDocs);
    }

    // assign all items their combined docs
    for(let item of items){
        let key = hash([item.key, item.mode, item.prefixes[0]]);
        let mergedDocs = itemDocs[key];
        item.args = merge(item.args, mergedDocs);
    }

    return items;
}

export interface IConfigKeyBinding {
    key: string,
    command: "master-key.do"
    prefixDescriptions: string[],
    when: string,
    args: {
        do: DoArgs,
        key: string, // repeated here so that commands can display the key pressed
        name?: string,
        description?: string,
        resetTransient?: boolean,
        hideInPalette?: boolean,
        priority: number,
        combinedName: string,
        combinedKey: string,
        combinedDescription: string,
        kind: string,
        path: string
        mode: string | undefined,
        prefixCode: number | undefined,
    }
}

function itemToConfigBinding(item: BindingItem, defs: Record<string, any>): IConfigKeyBinding {
    let prefixDescriptions = item.prefixes.map(p => {
        let code = defs['prefixCodes'][p];
        return `${code}: ${p}`;
    });
    return {
        key: <string>item.key, // we've expanded all array keys, so we know its a string
        prefixDescriptions,
        when: "(" + item.when.map(w => w.str).join(") && (") + ")",
        command: "master-key.do",
        args: {
            ...item.args,
            prefixCode: item.prefixes.length > 0 ? defs['prefixCodes'][item.prefixes[0]] : undefined,
            mode: item.mode && item.mode.length > 0 ? item.mode[0] : undefined,
            key: <string>item.key
        }
    };
}

function moveModeToWhenClause(binding: BindingItem){
    let when = binding.when ? cloneDeep(binding.when) : [];
    if(binding.mode !== undefined && binding.mode.length > 0){
        // NOTE: because we have already called `expandMode`
        // we know the array is length 0 or 1
        when = when.concat(parseWhen(`master-key.mode == ${binding.mode[0]}`));
    }

    return {...binding, when};
}

export class PrefixCodes {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    codes: Record<string, number>;
    names: string[];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    constructor(codes: Record<string, number> = {'': 0}){
        this.codes = codes;
        this.names = [];
        for(let [k, v] of Object.entries(codes)){
            this.names[v] = k;
        }
    }
    codeFor(prefix: string){
        if(this.codes[prefix] === undefined){
            this.names.push(prefix);
            this.codes[prefix] = this.names.length-1;
        }
        return this.codes[prefix];
    }
    nameFor(code: number): string | undefined {
        return this.names[code];
    }
};

function movePrefixesToWhenClause(item: BindingItem, prefixCodes: PrefixCodes){
    let when = item.when || [];
    if(item.prefixes.length > 0){
        let allowed = item.prefixes.map(a => {
            if(prefixCodes.codes[a] === undefined){
                throw Error(`Unexpected missing prefix code for prefix: ${a}`);
            }else{
                return `master-key.prefixCode == ${prefixCodes.codes[a]}`;
            }
        }).join(' || ');
        when = when.concat(parseWhen(allowed));
        return {...item, when};
    }else{
        return item;
    }
}

type BindingMap = { [key: string]: {index: number, item: BindingItem} };

function updatePrefixItemAndPrefix(item: BindingItem, key: string, prefix: string,
                    prefixCodes: PrefixCodes, automated: boolean = true): [BindingItem, string] {
    let oldPrefix = prefix;
    if (prefix.length > 0) { prefix += " "; }
    prefix += key;

    let newItem = {
        key,
        command: item.command,
        args: {
            do: [{
                command: "master-key.prefix",
                args: {
                    code: prefixCodes.codeFor(prefix),
                    automated
                },
            }],
            path: item.args.path,
            name: automated ? "prefix" : item.args.name,
            kind: automated ? "prefix" : item.args.name || "prefix",
            priority: automated ? 0 : item.args.priority,
            hideInPalette: automated ? false : item.args.hideInPalette,
            combinedName: automated ? "" : item.args.combinedName,
            combinedKey: automated ? "" : item.args.combinedKey,
            combinedDescription: automated ? "" : item.args.combinedDescription,
            resetTransient: automated ? false : item.args.resetTransient,
            repeat: 0
        },
        when: item.when,
        prefixes: [oldPrefix],
        mode: item.mode,
    };

    return [newItem, prefix];
}
function requireConcretePrefixes(item: BindingItem, problems: string[]){
    if(item.prefixes.length === 0){
        let modes = !item.mode ? "any" :
            !Array.isArray(item.mode) ? item.mode :
            item.mode.join(', ');
        problems.push(`Key binding '${item.key}' for mode
            '${modes}' is a prefix command; it cannot use '<all-prefixes>'.`);
    }
}

function expandKeySequencesAndResolveDuplicates(items: BindingItem[], problems: string[]):
    [BindingItem[], PrefixCodes]{

    let result: BindingMap = {};
    let prefixCodes = new PrefixCodes();
    let prefixIndex: Record<string, number> = {};
    for(let i=0; i<items.length; i++){
        let item = items[i];
        if(!Array.isArray(item.key)){
            // we should always land here, because prior steps have expanded key sequences
            // into individual keys
            // NOTE: at this point there is always only one prefix (we have previously
            // expanded multi-prefix bindings into several distinct bindings)
            let prefix = '';
            let key = item.key.trim();
            if(item.prefixes.length > 0 && item.prefixes[0].length > 0){
                key = item.prefixes[0] + " " + key;
            }
            let keySeq = key.split(/\s+/);
            let prefixItem;

            if(keySeq.length > 1){
                requireConcretePrefixes(item, problems);
                // expand multi-key sequences into individual bindings
                for(let key of keySeq.slice(0, -1)){
                    [prefixItem, prefix] = updatePrefixItemAndPrefix(item, key, prefix,
                        prefixCodes);
                    // when automated prefixes occur after their manual definition (see
                    // below), they must be placed *before* that manual definition to get
                    // sensible behavior (in other words, any custom behavior the user
                    // specified prefix uses should not be overwritten by the automated
                    // prefix)
                    let oldIndex = prefixIndex[prefix];
                    if(oldIndex){
                        addWithoutDuplicating(result, oldIndex - 1, prefixItem, problems);
                    }else{
                        addWithoutDuplicating(result, i, prefixItem, problems);
                    }
                }
            }

            let suffixKey = keySeq[keySeq.length-1];
            // we have to inject the appropriate prefix code if this is a user
            // defined keybinding that calls `master-key.prefix
            if(isSingleCommand(item.args.do, 'master-key.prefix')){
                requireConcretePrefixes(item, problems);
                let [prefixItem, itemPrefix] = updatePrefixItemAndPrefix(item, suffixKey,
                    prefix, prefixCodes, false);
                // track the index of this user defined prefix command
                if(prefixIndex[itemPrefix] === undefined){
                    prefixIndex[itemPrefix] = i;
                }
                addWithoutDuplicating(result, i, merge(item, prefixItem), problems);
            }else if(isSingleCommand(item.args.do, 'master-key.ignore')){
                if(keySeq.length > 1){
                    problems.push("Expected master-key.ignore commands to be single sequence keys.");
                }else{
                    addWithoutDuplicating(result, i, item, problems);
                }
            }else{
                if(keySeq.length > 1){
                    addWithoutDuplicating(result, i, {...item, key: suffixKey, prefixes: [prefix]},
                        problems);
                }else{
                    addWithoutDuplicating(result, i, item, problems);
                }
            }
        }else{
            throw Error("Unexpected operation");
        }
    }
    let sortedResult = sortBy(Object.values(result), i => i.index);
    return [sortedResult.map(i => i.item), prefixCodes];
}


export function isSingleCommand(x: DoArgs, cmd: string){
    if(x.length > 1){ return false; }
    return x[0].command === cmd;
}

function addWithoutDuplicating(map: BindingMap, index: number, newItem: BindingItem,
    problems: string[]): BindingMap {

    let key = hash({
        key: newItem.key,
        mode: newItem.mode,
        when: newItem.when?.map(w => w.id)?.sort(),
        prefixes: newItem.prefixes
    });

    let existingItem = map[key]?.item;
    if(existingItem){
        if(isEqual(newItem, existingItem)){
            // use the existing newItem
            return map;
        }else if(isSingleCommand(newItem.args.do, "master-key.ignore")){
            // use the existing newItem
            return map;
        }else if(isSingleCommand(existingItem.args.do, "master-key.ignore")){
            map[key] = {item: newItem, index};
            return map;
        }else if(isSingleCommand(newItem.args.do, "master-key.prefix") &&
                 isSingleCommand(existingItem.args.do, "master-key.prefix")){
            if(newItem.args.do[0].args?.automated){
                // use the existing newItem
                return map;
            }else if(existingItem.args.do[0].args?.automated){
                map[key] = {item: newItem, index};
                return map;
            }
        }

        // else: we have two conflicting items
        let binding = newItem.key;
        if(newItem.prefixes.length > 0 && newItem.prefixes.every(x => x.length > 0)){
            binding = newItem.prefixes[0] + " " + binding;
        }
        let message = "";
        if(/'/.test(<string>binding)){
            if(!/`/.test(<string>binding)){
                message = `Duplicate bindings for \`${binding}\` in mode '${newItem.mode}'`;
            }else{
                message = `Duplicate bindings for ${binding} in mode '${newItem.mode}'`;
            }
        }else{
            message = `Duplicate bindings for '${binding}' in mode '${newItem.mode}'`;
        }
        problems.push(message);
    }else{
        map[key] = {item: newItem, index};
    }
    return map;
}
