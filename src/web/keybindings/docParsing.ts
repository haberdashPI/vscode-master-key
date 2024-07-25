import * as vscode from 'vscode';
import {ZodError} from 'zod';
import {prettifyPrefix} from '../utils';
import {BindingSpec, bindingSpec, RawBindingItem} from './parsing';
import {uniqBy, reverse, sortBy} from 'lodash';

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

export async function parseBindingDocs(str: string) {
    let doc = '';
    let data = '';
    let error: ZodError | undefined = undefined;
    for (const line of str.split(/[\r\n]+/)) {
        // comments (excluding those starting with `#-`) are treated as markdown output
        if (/^\s*#(?!-)/.test(line)) {
            const m = line.match(/^\s*#\s*(.*)/);
            const content = m === null ? '' : m[1];

            doc += content + '\n';

            if (data.length > 0) {
                let toml;
                // eslint-disable-next-line no-useless-catch
                try {
                    toml = TOML.parse(data);
                    // eslint-disable-next-line prettier/prettier
                } catch(e){
                    vscode.window.showErrorMessage((<Error>e).message);
                }
                const parsed = bindingSpec.partial().safeParse(toml);
                if (parsed.success) {
                    doc += asBindingTable(parsed.data);
                } else {
                    error = parsed.error;
                }
                data = '';
            }
        } else {
            data += line + '\n';
        }
    }
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
                lastItem.name = prettifyPrefix(lastItem.combinedKey);
                lastItem.description = lastItem.combinedName;
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
            result += `|${key}|${item.name}|${mode}|${item.description}|\n`;
        }
        result += '\n';
    }
    return result;
}

function asArray<T>(x: T | T[]) {
    if (Array.isArray(x)) {
        return x;
    } else {
        return [x];
    }
}
