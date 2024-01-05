import hash from 'object-hash';
import { parseWhen, bindingItem, DoArgs, DefinedCommand, BindingItem, BindingSpec, rawBindingItem, RawBindingItem } from "./keybindingParsing";
import * as vscode from 'vscode';
import z from 'zod';
import { pick, isEqual, uniq, omit, mergeWith, cloneDeep, flatMap, merge, entries } from 'lodash';
import { reifyStrings, EvalContext } from './expressions';
import { fromZodError } from 'zod-validation-error';

export function processBindings(spec: BindingSpec): [IConfigKeyBinding[], Record<string, any>, string[]]{
    let problems: string[] = [];
    let items = expandDefaultsAndDefinedCommands(spec, problems);
    items = expandBindingKeys(items, spec.define);
    items = expandPrefixes(items);
    let prefixCodes: PrefixCodes;
    [items, prefixCodes] = expandKeySequencesAndResolveDuplicates(items, problems);
    items = items.map(moveModeToWhenClause);
    let newItems = items.map(i => movePrefixesToWhenClause(i, prefixCodes));
    let definitions = {...spec.define, prefixCodes: prefixCodes.codes};
    let configItems = newItems.map(i => itemToConfigBinding(i, definitions));
    return [configItems, definitions, problems];
}

function concatWhenAndOverwritePrefixes(obj_: any, src_: any, key: string){
    if(key === 'when'){
        let obj: any[] = obj_ === undefined ? [] : !Array.isArray(obj_) ? [obj_] : obj_;
        let src: any[] = src_ === undefined ? [] : !Array.isArray(src_) ? [src_] : src_;
        return obj.concat(src);
    }else if(key === 'prefixes'){
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

function expandDefinedCommands(item: RawBindingItem, definitions: any): RawBindingItem{
    if(item.command && item.command === 'runCommands' && Array.isArray(item.args)){
        let args = flatMap(item.args, cmd => {
            if(typeof cmd === 'string'){
                return [{command: cmd}];
            }else if((<any>cmd).defined){
                let definedCommand = <DefinedCommand>cmd;
                let commands = definitions[definedCommand.defined];
                if(!commands){
                    throw new Error(`Command definition missing under
                        'define.${definedCommand.defined}`);
                }
                return commands;
            }else{
                return [cmd];
            }
        });
        return {...item, args};
    }
    return item;
}

const partialRawBindingItem = rawBindingItem.partial();
type PartialRawBindingItem = z.infer<typeof partialRawBindingItem>;

function expandDefaultsAndDefinedCommands(spec: BindingSpec, problems: string[]): BindingItem[] {
    let pathDefaults: Record<string, PartialRawBindingItem> = {};
    for(let path of spec.path){
        let parts = path.id.split('.');
        let defaults: PartialRawBindingItem = partialRawBindingItem.parse({});
        if(parts.length > 1){
            let prefix = parts.slice(0,-1).join('.');
            if(pathDefaults[prefix] === undefined){
                problems.push(`The path '${path}' was defined before
                    '${prefix}'.`);
            }else{
                defaults = cloneDeep(pathDefaults[prefix]);
            }
        }
        pathDefaults[path.id] = mergeWith(defaults, path.default,
            concatWhenAndOverwritePrefixes);
    }

    let items = spec.bind.map((item, i) => {
        let itemDefault = pathDefaults[item.path];
        if(!itemDefault){
            problems.push(`The path '${item.path}' is undefined.`);
            return undefined;
        }else{
            item = mergeWith(cloneDeep(itemDefault), item, concatWhenAndOverwritePrefixes);
            item = expandDefinedCommands(item, spec.define);
            let required = ['key', 'command', 'kind'];
            let missing = required.filter(r => (<any>item)[r] === undefined);
            if(missing.length > 0){
                problems.push(`Problem with binding ${i} ${item.path}:
                    missing field '${missing[0]}'`);
                return undefined;
            }
            return bindingItem.parse({
                key: item.key,
                when: item.when,
                mode: item.mode,
                prefixes: item.prefixes,
                command: "master-key.do",
                args: {
                    do: item.command === 'runCommands' ?
                        item.args : [pick(item, ['command', 'args', 'computedArgs', 'if'])],
                    path: item.path,
                    name: item.name,
                    description: item.description,
                    kind: item.kind,
                    resetTransient: item.resetTransient,
                }
            });
        }
    });

    return <BindingItem[]>(items.filter(x => x !== undefined));
}

// TODO: check in unit tests
// invalid items (e.g. both key and keys defined) get detected

function expandBindingKey(k: string, item: BindingItem, context: EvalContext,
    definitions: any): BindingItem[] {

    let match: RegExpMatchArray | null = null;
    if((match = /((.*)\+)?<all-keys>/.exec(k)) !== null){
        if(match[2] !== undefined){
            let mod = match[2];
            return flatMap(Array.from(ALL_KEYS), k =>
                expandBindingKey(`${mod}+${k}`, item, context, definitions));
        }else{
            return flatMap(Array.from(ALL_KEYS), k =>
                expandBindingKey(k, item, context, definitions));
        }
    }
    let keyEvaled = reifyStrings(omit(item, 'key'),
        str => context.evalExpressionsInString(str, {...definitions, key: k}));
    return [{...keyEvaled, key: k}];
}

const ALL_KEYS = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
function expandBindingKeys(bindings: BindingItem[], definitions: any): BindingItem[] {
    let context = new EvalContext();
    let result = flatMap(bindings, item => {
        if(Array.isArray(item.key)){
            return flatMap(item.key, k => expandBindingKey(k, item, context, definitions));
        }else{
            return [item];
        }
    });
    context.reportErrors();
    return result;
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

export interface IConfigKeyBinding {
    key: string,
    command: "master-key.do"
    prefixDescriptions: string[],
    when: string,
    args: {
        do: DoArgs,
        name?: string,
        description?: string,
        resetTransient?: boolean,
        kind: string,
        path: string
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
        args: item.args
    };
}

function moveModeToWhenClause(binding: BindingItem){
    let when = binding.when ? binding.when : [];
    if(binding.mode !== undefined){
        let modes = Array.isArray(binding.mode) ? binding.mode : [binding.mode];
        let negative = false;
        let whenClause = modes.map(m => {
            if(m.startsWith("!")){
                negative = true;
                return `(master-key.mode != '${m.slice(1)}')`;
            }else{
                return `(master-key.mode == '${m}')`;
            }
        });
        // NOTE: parsing validation should ensure that only negative or only
        // positive mode specifications occur in one list
        if(negative){
            when = when.concat(parseWhen("("+whenClause.join(') && (')+")"));
        }else{
            when = when.concat(parseWhen("("+whenClause.join(') || (')+")"));
        }
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

type BindingMap = { [key: string]: BindingItem };

function updatePrefixItemAndPrefix(item: BindingItem, key: string, prefix: string,
                    prefixCodes: PrefixCodes): [BindingItem, string] {
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
                    automated: true
                },
            }],
            path: item.args.path,
            name: "Command Prefix: "+prefix,
            kind: "prefix",
            resetTransient: false,
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
    for(let item of items){
        if(!Array.isArray(item.key)){
            // we should always land here, because prior steps have expanded key sequences
            // into individual keys
            // NOTE: at this point there is always only one prefix (we have previously
            // expanded multi-prefix bindings into several distinct bindings)
            let prefix = '';
            let key = item.key.trim();
            if(item.prefixes[0].length > 0){ key = item.prefixes[0] + " " + key; }
            let keySeq = key.split(/\s+/);
            let prefixItem;

            if(keySeq.length > 1){
                requireConcretePrefixes(item, problems);
                // expand multi-key sequences into individual bindings
                for(let key of keySeq.slice(0, -1)){
                    [prefixItem, prefix] = updatePrefixItemAndPrefix(item, key, prefix,
                        prefixCodes);
                    addWithoutDuplicating(result, prefixItem, problems);
                }
            }

            let suffixKey = keySeq[keySeq.length-1];
            // we have to inject the appropriate prefix code if this is a user
            // defined keybinding that calls `master-key.prefix
            if(isSingleCommand(item.args.do, 'master-key.prefix')){
                requireConcretePrefixes(item, problems);
                let [prefixItem, _] = updatePrefixItemAndPrefix(item, suffixKey, prefix,
                    prefixCodes);
                addWithoutDuplicating(result, merge(item, prefixItem), problems);
            }else{
                if(keySeq.length > 1){
                    addWithoutDuplicating(result, {...item, key: suffixKey, prefixes: [prefix]},
                        problems);
                }else{
                    addWithoutDuplicating(result, item, problems);
                }
            }
        }else{
            throw Error("Unexpected operation");
        }
    }
    return [Object.values(result), prefixCodes];
}


export function isSingleCommand(x: DoArgs, cmd: string){
    if(x.length > 1){ return false; }
    return x[0].command === cmd;
}

function addWithoutDuplicating(map: BindingMap, newItem: BindingItem, problems: string[]): BindingMap {
    let key = hash({
        newItem: newItem.key,
        mode: newItem.mode,
        when: newItem.when?.map(w => w.id)?.sort(),
        prefixes: newItem.prefixes
    });

    let existingItem = map[key];
    if(existingItem){
        if(isEqual(newItem, existingItem)){
            // use the existing newItem
            return map;
        }else if(isSingleCommand(newItem.args.do, "master-key.ignore")){
            // use the existing newItem
            return map;
        }else if(isSingleCommand(existingItem.args.do, "master-key.ignore")){
            map[key] = newItem;
            return map;
        }else if(isSingleCommand(newItem.args.do, "master-key.prefix") &&
                 isSingleCommand(existingItem.args.do, "master-key.prefix")){
            if(newItem.args.do[0].args?.automated){
                // use the existing newItem
                return map;
            }else if(existingItem.args.do[0].args?.automated){
                map[key] = newItem;
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
        map[key] = newItem;
    }
    return map;
}
