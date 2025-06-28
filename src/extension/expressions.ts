import * as vscode from 'vscode';
import SafeExpression, { EvalFun } from 'safe-expression';
import replaceAll from 'string.prototype.replaceall';
import hash from 'object-hash';
import { mapValues } from 'lodash';

const buildEvaled = new SafeExpression();

/**
 * @file expressions/index.md
 *
 * ## Expressions
 *
 * There are a number of places where you can use expressions when defining a keybinding.
 * Any field that is evaluated as an expression includes the word `computed` in its name.
 * The expressions are
 * [AngularJS](https://www.w3schools.com/angular/angular_expressions.asp) expressions. When
 * an expression is evaluated the following values are in scope:
 *
 * - Any field defined in the top-level [`define`](/bindings/define) field
 * - Any value set by [`setFlag`](/commands/setFlag)
 * - `editorHasSelection`: true if there is any selection, false otherwise
 * - `editorHasMultipleSelections`: true if there are multiple selections, false otherwise
 * - `firstSelectionOrWord`: the first selection, or the word under the first cursor if the
 *   selection is empty
 * - `editorLangId`: the [language
 *   id](https://code.visualstudio.com/docs/languages/identifiers) of the current editor or
 *   the empty string if there is no current editor (or no language id for that editor)
 * - `mode`: the current keybinding mode
 * - `count`: The current count, as defined by
 *   [`master-key.updateCount`](/commands/updateCount)
 * - `captured`: The text currently captured by the most recent call to
 *   [`master-key.restoreNamed`](/commands/restoreNamed) or
 *   [`master-key.captureKeys`](/commands/captureKeys).
 * - `prefix`: The currently active [keybinding prefix](/commands/prefix)
 * - `record`: a boolean flag used to indicate when keys are marked for recording
 * - `commandHistory`: an array containing all previously run master key commands, up to the
 *   number configured by Master Key's "Command History Maximum" (defaults to 1024).
 *   Commands are stored from least recent (smallest index) to most recent (largest index).
 */

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
