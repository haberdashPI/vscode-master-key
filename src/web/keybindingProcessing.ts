import hash from 'object-hash';
import { BindingSpec, BindingTree, StrictBindingTree, BindingItem, StrictBindingItem, 
         strictBindingItem, StrictDoArgs, parseWhen, StrictDoArg, DoArg, 
         DefinedCommand } from "./keybindingParsing";
import * as vscode from 'vscode';
import { isEqual, uniq, omit, mergeWith, cloneDeep, flatMap, merge, entries } from 'lodash';
import { reifyStrings, EvalContext } from './expressions';
import { fromZodError } from 'zod-validation-error';

export function processBindings(spec: BindingSpec){
    let expandedSpec = expandDefaultsAndDefinedCommands(spec.bind, spec.define);
    let items: StrictBindingItem[] = listBindings(expandedSpec);
    items = expandBindingKeys(items, spec.define);
    items = expandPrefixes(items);
    let prefixCodes: PrefixCodes;
    [items, prefixCodes] = expandKeySequencesAndResolveDuplicates(items);
    items = items.map(moveModeToWhenClause);
    let newItems = items.map(i => movePrefixesToWhenClause(i, prefixCodes));
    let definitions = {...spec.define, prefixCodes: prefixCodes.codes};
    let configItem = newItems.map(i => itemToConfigBinding(i, definitions));
    return [configItem, definitions];
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

function expandDefinedCommands(item: BindingItem, definitions: any){
    if(item.do && Array.isArray(item.do)){
        let itemDo = item.do.flatMap((cmd: DoArg) => {
            if(typeof cmd === 'string'){
                return [cmd];
            }else if((<any>cmd).command){
                return [cmd];
            }else{
                let definedCommand = <DefinedCommand>cmd;
                let commands = definitions[definedCommand.defined];
                if(!commands){ 
                    vscode.window.showErrorMessage(`Command definition missing under 
                        'define.${definedCommand.defined}`);
                    return [cmd];
                }
                return commands;
            }
        });
        return {...item, do: itemDo};
    }
    return item;
}

function expandDefaultsAndDefinedCommands(bindings: BindingTree, definitions: any, 
    prefix: string = "bind", 
    defaultItem: BindingItem = {when: [], prefixes: [""]}): StrictBindingTree {

    if (bindings.default !== undefined) {
        defaultItem = mergeWith(cloneDeep(defaultItem), <BindingItem>bindings.default,
            concatWhenAndOverwritePrefixes);
    }

    let items: StrictBindingItem[] | undefined = undefined;
    if (bindings.items !== undefined) {
        let validatedItems = bindings.items.map((item: BindingItem, i: number) => {
            let expandedItem = mergeWith(cloneDeep(defaultItem), item,
                concatWhenAndOverwritePrefixes);
            expandedItem = expandDefinedCommands(expandedItem, definitions);
            let parsing = strictBindingItem.safeParse({...expandedItem, path: prefix});
            if(!parsing.success){
                vscode.window.showErrorMessage(`Problem with item ${i} under ${prefix}:
                    ${fromZodError(parsing.error)}`);
                return undefined;
            }else{
                return parsing.data;
            }
        });
        items = <StrictBindingItem[]>validatedItems.filter(x => x !== undefined);
    }

    let nonItems = Object.entries(omit(bindings, ['name', 'description', 'kind', 'items', 'default']));
    let result: { [key: string]: BindingTree } = Object.fromEntries(nonItems.map(([k, v]) => {
        let entry = (prefix === "" ? "" : prefix+".")+k;
        if(typeof v !== 'object'){
            vscode.window.showErrorMessage(`binding.${prefix} has unexpected field ${k}`);
            return [];
        }
        if(v.name !== undefined){
            // though type script can't enforce it statically, if v has a `name`
            // it is a binding tree
            return [k, expandDefaultsAndDefinedCommands(<BindingTree>v, definitions, entry, defaultItem)];
        }else{
            vscode.window.showErrorMessage(`binding.${entry} has no "name" field.`);
            return [];
        }
    }));

    let returnValue = {
        ...result,
        name: bindings.name,
        description: bindings.description,
        items
    };

    // I'm not sure exactly why this case is required, I think it is about the weirdness of
    // indexed keys in the type definition
    return <StrictBindingTree>returnValue;
}

// TODO: check in unit tests
// invalid items (e.g. both key and keys defined) get detected

function expandBindingKey(k: string, item: StrictBindingItem, context: EvalContext, 
    definitions: any): StrictBindingItem[] {

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
function expandBindingKeys(bindings: StrictBindingItem[], definitions: any): StrictBindingItem[] {
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

function expandPrefixes(items: StrictBindingItem[]){
    return flatMap(items, item => {
        if(item.prefixes && item.prefixes.length > 1){
            return item.prefixes.map(prefix => {
                return {...item, prefixes: [prefix]};
            });
        }
        return item;
    });
}

function listBindings(bindings: StrictBindingTree): StrictBindingItem[] {
    return flatMap(Object.keys(bindings), key => {
        if(key === 'items' && bindings.items){ return bindings.items; }
        let val = bindings[key];
        if(typeof val === 'string'){ return []; }
        if(typeof val === 'number'){ return []; }
        if(typeof val === 'boolean'){ return []; }
        if(typeof val === 'undefined'){ return []; }
        if(typeof val === 'object'){ return listBindings(<StrictBindingTree>val); }
        return [];
    });
}

export interface IConfigKeyBinding {
    key: string,
    command: "master-key.do" | "master-key.prefix"
    prefixDescriptions: string[],
    when: string,
    args: { key: string } | { 
        do: string | object | (string | object)[], 
        name?: string,
        description?: string,
        resetTransient?: boolean, 
        kind: string, 
        path: string 
    }
}

function itemToConfigBinding(item: StrictBindingItem, defs: Record<string, any>): IConfigKeyBinding {
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
            do: item.do, 
            name: item.name,
            description: item.description,
            resetTransient: item.resetTransient, 
            kind: item.kind,
            path: item.path 
        }
    };
}

function moveModeToWhenClause(binding: StrictBindingItem){
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

function movePrefixesToWhenClause(item: StrictBindingItem, prefixCodes: PrefixCodes){
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

type BindingMap = { [key: string]: StrictBindingItem };

function updatePrefixItemAndPrefix(item: StrictBindingItem, key: string, prefix: string, 
                    prefixCodes: PrefixCodes): [StrictBindingItem, string] {
    let oldPrefix = prefix;
    if (prefix.length > 0) { prefix += " "; }
    prefix += key;

    let newItem = {
        key,
        do: { 
            command: "master-key.prefix", 
            args: { 
                code: prefixCodes.codeFor(prefix), 
                automated: true 
            } 
        },
        when: item.when,
        kind: "prefix",
        prefixes: [oldPrefix],
        mode: item.mode,
        path: item.path,
        resetTransient: false
    };

    return [newItem, prefix];
}
function requireConcretePrefixes(item: StrictBindingItem){
    if(item.prefixes.length === 0){
        let modes = !item.mode ? "any" :
            !Array.isArray(item.mode) ? item.mode :
            item.mode.join(', ');
        vscode.window.showErrorMessage(`Key binding '${item.key}' for mode 
            '${modes}' is a prefix command; it cannot use '<all-prefixes>'.`);
    }
}

function expandKeySequencesAndResolveDuplicates(items: StrictBindingItem[]): 
    [StrictBindingItem[], PrefixCodes]{

    let result: BindingMap = {};
    let prefixCodes = new PrefixCodes();
    for(let item of items){
        if(!Array.isArray(item.key)){
            // we should always land here, because prior steps have expanded key sequences
            // into individual keys
            let keySeq = item.key.trim().split(/\s+/);
            let prefix = item.prefixes[0];
            let prefixItem;

            if(keySeq.length > 1){
                requireConcretePrefixes(item);
                // expand multi-key sequences into individual bindings
                for(let key of keySeq.slice(0, -1)){
                    [prefixItem, prefix] = updatePrefixItemAndPrefix(item, key, prefix, 
                        prefixCodes);
                    addWithoutDuplicating(result, prefixItem);
                }
            }

            let suffixKey = keySeq[keySeq.length-1];
            // we have to inject the appropriate prefix code if this is a user
            // defined keybinding that calls `master-key.prefix
            if(isSingleCommand(item.do, 'master-key.prefix')){
                requireConcretePrefixes(item);
                let [prefixItem, _] = updatePrefixItemAndPrefix(item, suffixKey, prefix, 
                    prefixCodes);
                addWithoutDuplicating(result, merge(item, prefixItem));
            }else{
                if(keySeq.length > 1){
                    addWithoutDuplicating(result, {...item, key: suffixKey, prefixes: [prefix]});
                }else{
                    addWithoutDuplicating(result, item);
                }
            }
        }else{
            throw Error("Unexpected operation");
        }
    }
    return [Object.values(result), prefixCodes];
}


export function isSingleCommand(x: StrictDoArgs, cmd: string){
    if(!Array.isArray(x)){
        if(typeof x === 'string'){ return x === cmd; }
        else{ return x.command === cmd; }
    }
    return false;
}

function coerceSingleCommand(x_: StrictDoArgs){
    let x = <StrictDoArg>x_; // we always check for `isSingleCommand` before using this coerce method
    if(typeof x === 'string'){
        return {command: x};
    }else{
        return x;
    }
}

function addWithoutDuplicating(map: BindingMap, newItem: StrictBindingItem){
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
        }else if(isSingleCommand(newItem.do, "master-key.ignore")){
            // use the existing newItem
            return map; 
        }else if(isSingleCommand(existingItem.do, "master-key.ignore")){
            map[key] = newItem;
            return map;
        }else if(isSingleCommand(newItem.do, "master-key.prefix") && 
                 isSingleCommand(existingItem.do, "master-key.prefix")){
            let newItemDo = coerceSingleCommand(newItem.do);
            let existingItemDo = coerceSingleCommand(existingItem.do);
            if(newItemDo.args?.automated){
                // use the existing newItem
                return map; 
            }else if(existingItemDo.args?.automated){
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
        vscode.window.showErrorMessage(message);
    }else{
        map[key] = newItem;
    }
    return map;
}
