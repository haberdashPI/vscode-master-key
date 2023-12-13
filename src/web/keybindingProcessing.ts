import hash from 'object-hash';
import { BindingSpec, BindingTree, StrictBindingTree, BindingItem, StrictBindingItem, 
         strictBindingItem, StrictDoArgs, parseWhen, StrictDoArg, BindingCommand } from "./keybindingParsing";
import * as vscode from 'vscode';
import { isEqual, uniq, omit, mergeWith, cloneDeep, flatMap, values, entries } from 'lodash';
import { reifyStrings, EvalContext } from './expressions';


export function processBindings(spec: BindingSpec){
    let expandedSpec = expandDefaults(spec.bind);
    let items: StrictBindingItem[] = listBindings(expandedSpec);
    items = expandBindingKeys(items, spec.define);
    items = expandBindingDocsAcrossWhenClauses(items);
    let prefixItems: BindingMap = {};
    items = items.map(i => expandPrefixBindings(i, prefixItems));
    items = resolveDuplicateBindings(items, prefixItems);
    items = items.map(moveModeToWhenClause);
    items = items.map(movePrefixesToWhenClause);
    return items.map(itemToConfigBinding);
}

function expandWhenClauseByConcatenation(obj_: any, src_: any, key: string){
    if(key !== 'when'){ return; }
    let obj: any[] = obj_ === undefined ? [] : !Array.isArray(obj_) ? [obj_] : obj_;
    let src: any[] = src_ === undefined ? [] : !Array.isArray(src_) ? [src_] : src_;
    return obj.concat(src);
}

function expandDefaults(bindings: BindingTree, prefix: string = "bind", defaultItem: BindingItem = {when: [], prefixes: [""]}): StrictBindingTree {
    if (bindings.default !== undefined) {
        defaultItem = { ...defaultItem, ...<BindingItem>bindings.default };
    }

    let items: StrictBindingItem[] | undefined = undefined;
    if (bindings.items !== undefined) {
        let validatedItems = bindings.items.map((item: BindingItem, i: number) => {
            let expandedItem = mergeWith(cloneDeep(defaultItem), item,
                expandWhenClauseByConcatenation);
            let parsing = strictBindingItem.safeParse(expandedItem);
            if(!parsing.success){
                let issue = parsing.error.issues[0];
                vscode.window.showErrorMessage(`Problem with item ${i} under ${prefix}: 
                    ${issue.message} ${issue.path}`);
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
            return [k, expandDefaults(<BindingTree>v, entry, defaultItem)];
        }else{
            vscode.window.showErrorMessage(`binding.${entry} has no "name" field.`);
            return [];
        }
    }));

    let returnValue = {
        ...result,
        name: bindings.name,
        description: bindings.description,
        kind: bindings.kind,
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

interface IConfigKeyBinding {
    key: string,
    command: "master-key.do" | "master-key.prefix"
    name?: string,
    description?: string,
    when?: string,
    args: { do: string | object | (string | object)[], resetTransient?: boolean } | 
          { key: string }
}

function itemToConfigBinding(item: StrictBindingItem): IConfigKeyBinding {
    return {
        key: <string>item.key, // we've expanded all array keys, so we know its a string
        name: item.name,
        description: item.description,
        when: Array.isArray(item.when) ? 
            "(" + item.when.map(w => w.str).join(") && (") + ")" : undefined,
        command: "master-key.do",
        args: { do: item.do, resetTransient: item.resetTransient }
    };
}

function validateUniqueForBinding(vals: (string | undefined)[], name: string, item: any): string | undefined {
    let uvals = uniq(vals.filter(v => v !== undefined));
    if(uvals.length > 1){
        vscode.window.showErrorMessage(`Multiple values of \`${name}\` for idenictal 
            binding \`${item.key}\` in mode "${item.mode.join(' or ')}". Update the bindings file
            to use only one name for this binding regardless of its \`when\` clause
            You can also safely leave all but one of these bindings with a \`${name}\`
            field.`);
        return;
    }
    if(uvals.length === 0){
        vscode.window.showErrorMessage(`No \`${name}\` provided for binding \`${item.key}\`
            in mode "${item.mode.join(' or ')}".`);
        return;
    }
    return uvals[0];
}

// For any items that have duplicate bindings with distinct when clauses (before the
// transformations applied below) make sure that `name` and `description` are identical or
// blank, and use the non-blank value in all instances

// TODO: the obvious unit test is to have non-unique documentation
// and blank documentation for some when clauses

function expandBindingDocsAcrossWhenClauses(items: StrictBindingItem[]): StrictBindingItem[] {
    let sharedBindings: { [key: string]: any[] } = {};
    for (let item of items) {
        if(item.do === "master-key.ignore" || (<{command?: string}>item.do)?.command === "master-key.ignore"){ continue; }
        let k = hash({ key: item.key, mode: item.mode });
        if (sharedBindings[k] === undefined) {
            sharedBindings[k] = [item];
        } else {
            sharedBindings[k] = [...sharedBindings[k], item];
        }
    }

    let sharedDocs: {
        [key: string]: {
            name: string | undefined,
            description: string | undefined
        }
    } = {};
    for (let [key, item] of entries(sharedBindings)) {
        if (item.length <= 1) { continue; }
        let name = validateUniqueForBinding(item.map(i => (<string | undefined>i.name)),
            "name", item[0]);
        let description = validateUniqueForBinding(item.map(i => (<string | undefined>i.description)),
            "description", item[0]);

        sharedDocs[key] = { name, description };
    }

    return items.map((item: any) => {
        let k = hash({ key: item.key, mode: item.mode });
        if (sharedDocs[k] !== undefined) {
            let docs = sharedDocs[k];
            return { ...item, name: docs.name, description: docs.description };
        } else {
            return item;
        }
    });
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

function movePrefixesToWhenClause(item: StrictBindingItem){
    let when = item.when || [];
    let allowed = item.prefixes.map(a => `master-key.prefix == '${a}'`).join(' || ');
    when = when.concat(parseWhen(allowed));
    return {...item, when};
}

type BindingMap = { [key: string]: StrictBindingItem };
function expandPrefixBindings(item: StrictBindingItem, prefixItems: BindingMap = {}): StrictBindingItem{
    let prefixes = item.prefixes || [];

    if(item.key !== undefined && !Array.isArray(item.key)){
        let keySeq = item.key.trim().split(/\s+/);

        for(let key of keySeq.slice(0, -1)){
            let prefixItem: StrictBindingItem = {
                key, 
                do: {command: "master-key.prefix", args: {key, automated: true}},
                when: item.when, 
                prefixes,
                mode: item.mode,
                resetTransient: false
            }; 

            // track the current prefix for the next iteration of `map`
            prefixes = prefixes.map((prefix: string) => {
                if(prefix.length > 0){ prefix += " "; }
                prefix += key;
                return prefix;
            });

            addWithoutDuplicating(prefixItems, prefixItem);
        }

        return {
            ...item, 
            prefixes,
            key: keySeq[keySeq.length-1]
        };
    }
    return item;
}

function isSingleCommand(x: StrictDoArgs, cmd: string){
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

function resolveDuplicateBindings(items: StrictBindingItem[], prefixBindings: BindingMap){
    let resolved: BindingMap = prefixBindings;
    for(let item of items){
        addWithoutDuplicating(resolved, item);
    }
    return Object.values(resolved);
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
        vscode.window.showErrorMessage(`Duplicate bindings for '${binding}' in mode 
            '${newItem.mode}'`);
    }else{
        map[key] = newItem;
    }
    return map;
}
