import {ZodError} from 'zod';
import {prettifyPrefix} from '../utils';
import {BindingSpec, bindingSpec, RawBindingItem} from './parsing';
import {isSingleCommand} from './processing';
import {uniqBy, reverse, sortBy} from 'lodash';

const TOML = require('smol-toml');

function filterBinding(binding: RawBindingItem) {
    if (binding.hideInDocs) {
        return false;
    }
    if (isSingleCommand(binding.args, 'master-key.ignore')) {
        return false;
    }
    return true;
}

export async function parseBindingDocs(str: string) {
    let doc = '';
    let data = '';
    let error: ZodError | undefined = undefined;
    for (const line of str.split('[\r\n]+')) {
        if (/^\s*#/.test(line)) {
            const m = line.match(/^\s*#(.*)/);
            const content = m === null ? '' : m[0];

            doc += content;

            if (data.length > 0) {
                const toml = (await TOML).parse(data);
                const parsed = bindingSpec.partial().safeParse(toml);
                if (parsed.success) {
                    doc += asBindingTable(parsed.data);
                } else {
                    error = parsed.error;
                }
                data = '';
            }
        } else {
            data += line;
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
