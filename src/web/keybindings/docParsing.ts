import * as vscode from 'vscode';
import {ZodError} from 'zod';
import {isSingleCommand, prettifyPrefix} from '../utils';
import {BindingItem, bindingSpec, ParsedResult, RawBindingItem} from './parsing';
import {uniqBy, sortBy} from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import {cloneDeep} from 'lodash';
import {IIndexed} from '../utils';
import {normalizeLayoutIndependentString} from './layout';

const TOML = require('smol-toml');

function filterBinding(binding: BindingItem) {
    if (binding.args.hideInDocs) {
        return false;
    }
    if (isSingleCommand(binding.args.do, 'master-key.ignore')) {
        return false;
    }
    return true;
}

export interface IParsedBindingDoc {
    str: string;
    items: (RawBindingItem & IIndexed)[];
}

function parseDocItems(data: string): ParsedResult<RawBindingItem[]> {
    let toml;
    try {
        toml = TOML.parse(data);
    } catch (e) {
        vscode.window.showErrorMessage((<Error>e).message);
    }
    // we exclude all but the bindings, since those are the only ones we care about
    // validating here
    const parsed = bindingSpec.partial().safeParse({bind: toml.bind});
    if (parsed.success) {
        if ((parsed.data.bind || []).length > 0) {
            return {success: true, data: parsed.data.bind || []};
        } else {
            return {success: true, data: []};
        }
    } else {
        return parsed;
    }
}

function addIndexField<T>(xs: T[], i = -1): [(T & IIndexed)[], number] {
    for (const x of xs) {
        i += 1;
        (<T & IIndexed>x).index = i;
    }
    return [<(T & IIndexed)[]>xs, i];
}

export function parseBindingDocs(str: string) {
    let doc: IParsedBindingDoc = {str: '', items: []};
    const result: IParsedBindingDoc[] = [];
    let data = '';
    let error: ZodError | undefined = undefined;
    let lastUpdatedDocs = true;
    let lastIndex = -1;
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
                        [doc.items, lastIndex] = addIndexField(items.data, lastIndex);
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
        } else if (/^\s*#-/.test(line)) {
            if (lastUpdatedDocs) {
                doc.str += '\n';
            }
        } else {
            lastUpdatedDocs = false;
            data += line + '\n';
        }
    }
    if (data.length > 0) {
        const items = parseDocItems(data);
        if (items.success) {
            if (items.data.length > 0) {
                [doc.items, lastIndex] = addIndexField(items.data, lastIndex);
            }
        } else {
            error = items.error;
        }
    }
    result.push(doc);

    if (error) {
        return {success: false, error};
    } else {
        return {success: true, data: {doc: result}};
    }
}

export function asBindingTable(parsed: BindingItem[]) {
    let result = '';
    let toShow = parsed.filter(filterBinding);
    if (toShow.length === 0) {
        return result;
    }
    toShow = uniqBy(toShow, b => b.key + (b.mode || ''));
    toShow = sortBy(toShow, x => -(x?.args.priority || 0));

    const combinedToShow: typeof toShow = [];
    let lastItem = cloneDeep(toShow[0]);
    combinedToShow.push(lastItem);
    for (const item of toShow.slice(1)) {
        if (
            lastItem.args.combinedName &&
            lastItem.args.combinedName === item.args.combinedName
        ) {
            const prefixMatch = item.key.match(/(.*)\s\S+$/);
            const prefix = prefixMatch ? prefixMatch[1] + ' ' : '';
            const keyseq = normalizeLayoutIndependentString(
                prefix + lastItem.args.combinedKey
            );
            lastItem.key = prettifyPrefix(keyseq);
            lastItem.args.name = lastItem.args.combinedName;
            lastItem.args.description = lastItem.args.combinedDescription || '';
        } else {
            lastItem = cloneDeep(item);
            combinedToShow.push(lastItem);
        }
    }

    result += '\n\n|mode|key|name|description|\n';
    result += '|---|----|----|-----------|\n';
    for (const item of combinedToShow) {
        const keyseq = normalizeLayoutIndependentString(item.key || '');
        const key = prettifyPrefix(keyseq);
        const mode = asArray(item.mode)
            .map(m => (m === undefined ? '' : '`' + m + '`'))
            .join(', ');
        result += `|${mode}|${key}|${item.args.name}|${stripNewlines(item.args.description || '')}|\n`;
    }
    result += '\n';
    return result;
}

function stripNewlines(str: string) {
    return replaceAll(str, /[\n\r]+/g, ' ');
}

function asArray<T>(x: T | T[]) {
    if (Array.isArray(x)) {
        return x;
    } else {
        return [x];
    }
}
