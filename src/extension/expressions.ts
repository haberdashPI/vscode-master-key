import * as vscode from 'vscode';
import SafeExpression, { EvalFun } from 'safe-expression';
import replaceAll from 'string.prototype.replaceall';
import hash from 'object-hash';
import { mapValues } from 'lodash';

const buildEvaled = new SafeExpression();

export function reifyStrings(obj: unknown, ev: (str: string) => unknown): unknown {
    if (Array.isArray(obj)) {
        return obj.map(x => reifyStrings(x, ev));
    }
    if (typeof obj === 'object') {
        return mapValues(obj, (val, _prop) => {
            return reifyStrings(val, ev);
        });
    }
    if (typeof obj === 'string') {
        return ev(obj);
    }
    return obj;
}

export function expressionId(exp: string) {
    // TODO: could be more general/robust if we used expression parsing
    return hash(replaceAll(exp, /\s+/g, ''));
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

    evalExpressionsInString(str: string, values: Record<string, unknown>) {
        let result = '';
        const r = /\{\{(.(?!\}\}))*.\}\}/g;
        let match = r.exec(str);
        let startIndex = 0;
        while (match !== null) {
            const prefix = str.slice(startIndex, match.index);
            let evaled;
            try {
                // slice to remove `{{` and `}}`
                evaled = this.evalStr(match[0].slice(2, -2), values);
            } catch (_) {
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

    evalStr(str: string, values: Record<string, unknown>) {
        let exec = this.cache[str];
        if (exec === undefined) {
            if (str.match(/(?<!(!|=))=(?!(>|=))/)) {
                this.errors.push(`Found an isolated "=" in this expression.
                Your expressions are not permitted to set any values. You should
                use 'master-key.setFlag' to do that.`);
                return undefined;
            }
            this.cache[str] = exec = buildEvaled(str);
        }
        let result: unknown = str;
        try {
            // do not let the expression modify any of the `values`
            result = exec(values);
        } catch (e: unknown) {
            this.errors.push(
                `Error evaluating ${str}: ${(<Error>e)?.message || '[unavailable]'}`,
            );
            return undefined;
        }
        return result;
    }
}

export const evalContext = new EvalContext();
