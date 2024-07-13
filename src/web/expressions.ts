import * as vscode from 'vscode';
import SafeExpression, {EvalFun} from 'safe-expression';
import jsep from 'jsep';
const jsepRegex = require('@jsep-plugin/regex');
import hash from 'object-hash';
import {mapValues} from 'lodash';

jsep.addBinaryOp('=~', 6);
jsep.plugins.register(jsepRegex.default);

const buildEvaled = new SafeExpression();

export function reifyStrings(obj: any, ev: (str: string) => any): any {
    if (Array.isArray(obj)) {
        return obj.map(x => reifyStrings(x, ev));
    }
    if (typeof obj === 'object') {
        return mapValues(obj, (val, prop) => {
            return reifyStrings(val, ev);
        });
    }
    if (typeof obj === 'string') {
        return ev(obj);
    }
    if (
        typeof obj === 'number' ||
        typeof obj === 'boolean' ||
        typeof obj === 'undefined' ||
        typeof obj === 'function' ||
        typeof obj === 'bigint' ||
        typeof obj === 'symbol'
    ) {
        return obj;
    }
}

export function expressionId(exp: string) {
    return hash(jsep(exp));
}

export class EvalContext {
    private errors: string[] = [];
    // TODO: we don't need this cache, SafeExpression already does this
    private cache: Record<string, EvalFun> = {};

    reportErrors() {
        if (this.errors.length > 0) {
            for (const e of this.errors.slice(0, 3)) {
                vscode.window.showErrorMessage(e);
            }
            this.errors = [];
        }
    }

    evalExpressionsInString(str: string, values: Record<string, any>) {
        let result = '';
        const r = /\{[^\}]*\}/g;
        let match = r.exec(str);
        let startIndex = 0;
        while (match !== null) {
            const prefix = str.slice(startIndex, match.index);
            let evaled;
            try {
                // slice to remove `{` and `}`
                evaled = this.evalStr(match[0].slice(1, -1), values);
            } catch (e) {
                evaled = undefined;
            }
            if (evaled === undefined) {
                this.errors.push(`The expression
                ${match[0]}, found in ${str}, could not be evaluated.`);
                evaled = match[0];
            }
            result += prefix + evaled;
            startIndex += prefix.length + match[0].length;
            match = r.exec(str);
        }
        result += str.slice(startIndex);
        return result;
    }

    evalStr(str: string, values: Record<string, any>) {
        let exec = this.cache[str];
        if (exec === undefined) {
            if (str.match(/(?<!(\!|=))=(?!(\>|=))/)) {
                this.errors.push(`Found an isolated "=" in this expression.
                Your expressions are not permitted to set any values. You should
                use 'master-key.set' to do that.`);
                return undefined;
            }
            this.cache[str] = exec = buildEvaled(str);
        }
        let result = str;
        try {
            // do not let the expression modify any of the `values`
            result = exec(values);
        } catch (e: any) {
            this.errors.push(`Error evaluating ${str}: ${e.message}`);
            return undefined;
        }
        return result;
    }
}

export const evalContext = new EvalContext();
