import * as vscode from 'vscode';
import {ZodError} from 'zod';
import {prettifyPrefix} from '../utils';
import {BindingSpec, bindingSpec, ParsedResult, RawBindingCommand, rawBindingItem, RawBindingItem} from './parsing';
import {uniqBy, reverse, sortBy} from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { parse } from 'path';
import { Bindings } from './processing';

const TOML = require('smol-toml');

function filterBinding(binding: RawBindingItem) {
    if (binding.hideInDocs) {
        return false;
    }
    if (binding.command === 'master-key.ignore') {
        return false;
    }
    return true;
}

export interface IParsedBindingDoc {
    str: string;
    items: RawBindingItem[];
}

function parseDocItems(data: string): ParsedResult<RawBindingItem[]>{
    let toml;
    try {
        toml = TOML.parse(data);
    } catch (e) {
        vscode.window.showErrorMessage((<Error>e).message);
    }
    const parsed = bindingSpec.partial().safeParse(toml);
    if (parsed.success) {
        if ((parsed.data.bind || []).length > 0) {
            return {success: true, data: parsed.data.bind || []};
        }else{
            return {success: true, data: []};
        }
    } else {
        return parsed;
    }
}

// TODO: we need to grab the previously computed complete parse we should be able to
// uniquely match items to the full parse and use that to grab an default expansions
export function parseBindingDocs(str: string) {
    let doc: IParsedBindingDoc = {str: '', items: []};
    const result: IParsedBindingDoc[] = [];
    let data = '';
    let error: ZodError | undefined = undefined;
    let lastUpdatedDocs = true;
    for (const line of str.split(/[\r\n]+/)) {
        // comments (excluding those starting with `#-`) are treated as markdown output
        if (/^\s*$/.test(line)) {
            if (lastUpdatedDocs) {
                doc.str += '\n';
            } else {
                data += '\n';
            }
        } else if (/^\s*#(?!-)/.test(line)) {
            // if there is pending binding data, insert its table before the
            // new section of markdown documentation
            if (data.length > 0) {
                const items = parseDocItems(data);
                if (items.success) {
                    if (items.data.length > 0) {
                        doc.items = items.data;
                        result.push(doc);
                        doc = {str: '', items: []};
                    }
                } else {
                    error = items.error;
                }
                data = '';
            }

            const m = line.match(/^\s*#\s*(.*)/);
            const content = m === null ? '' : m[1];
            lastUpdatedDocs = true;
            doc.str += content + '\n';
        } else {
            lastUpdatedDocs = false;
            data += line + '\n';
        }
    }
    // TODO: insert additional table for remaining data before
    // returning the result
    if (error) {
        return {success: false, error};
    } else {
        return {success: true, data: {doc}};
    }
}

function asBindingTable(parsed: Partial<BindingSpec>) {
    let result = '';
    if (parsed.bind) {
        let toShow = parsed.bind.filter(filterBinding);
        if (toShow.length === 0) {
            return result;
        }
        toShow = reverse(uniqBy(reverse(toShow), b => b.key));
        toShow = sortBy(toShow, x => -(x?.priority || 0));

        const combinedToShow: typeof toShow = [];
        let lastItem = toShow[0];
        combinedToShow.push(lastItem);
        for (const item of toShow.slice(1)) {
            if (lastItem.combinedName && lastItem.combinedName === item.combinedName) {
                lastItem.key = prettifyPrefix(lastItem.combinedKey);
                lastItem.description = lastItem.combinedDescription;
            } else {
                combinedToShow.push(item);
                lastItem = item;
            }
        }

        result += '\n\n|key|name|mode|description|\n';
        result += '|---|----|----|-----------|\n';
        for (const item of combinedToShow) {
            const key = prettifyPrefix(item.key || '');
            const mode = asArray(item.mode)
                .map(m => '`' + m + '`')
                .join(', ');
            result += `|\`${key}\`|${item.name}|${mode}|${stripNewlines(item.description || '')}|\n`;
        }
        result += '\n';
    }
    return result;
}

function stripNewlines(str: string) {
    replaceAll(str, /[\n\r]+/, ' ');
}

function asArray<T>(x: T | T[]) {
    if (Array.isArray(x)) {
        return x;
    } else {
        return [x];
    }
}
