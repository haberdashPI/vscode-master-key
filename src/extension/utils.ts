import * as vscode from 'vscode';
import z from 'zod';
import { fromZodError } from 'zod-validation-error';
import replaceAll from 'string.prototype.replaceall';
import { CursorShape } from '../rust/parsing/lib/parsing';

// function validateInput(command: string, args_: unknown,
//     using: z.ZodUn);
export function validateInput<T, Def extends z.ZodTypeDef, I>(
    command: string,
    args_: unknown,
    using: z.ZodType<T, Def, I>,
): T | undefined {
    const result = using.safeParse(args_ || {});
    if (!result.success) {
        const msg = fromZodError(result.error);
        vscode.window.showErrorMessage(`'${command}': ${msg}`);
        return;
    }
    return result.data;
}

export function wrappedTranslate(
    x: vscode.Position,
    doc: vscode.TextDocument,
    val: number,
) {
    if (val < 0) {
        let result = x;
        while (result.character + val < 0) {
            val += 1;
            result = result.translate(-1, 0);
            result = result.translate(0, doc.lineAt(result).range.end.character);
        }
        return result.translate(0, val);
    } else {
        let result = x;
        while (result.character + val > doc.lineAt(result).range.end.character) {
            val -= 1;
            result = new vscode.Position(result.line + 1, 0);
        }
        return result.translate(0, val);
    }
}

// splits out the modifier key
export function modifierKey(str: string) {
    if (str.match(/\+/)) {
        return str.
            split('+').
            slice(0, -1).
            map(x => prettifyPrefix(x));
    }
    return [''];
}

export function getRequiredMode(when: string) {
    const matches = when.match(/master-key.mode == '([^']+)'/);
    if (matches) {
        return matches[1];
    } else {
        return '';
    }
}

export function getRequiredPrefixCode(when: string) {
    const matches = when.match(/master-key.prefixCode == (\w+)/);
    if (matches) {
        return parseInt(matches[1]);
    } else {
        return 0;
    }
}

export function prettifyPrefix(str: string) {
    str = str.toUpperCase();
    str = replaceAll(str, /shift(\+|$)/gi, '⇧');
    str = replaceAll(str, /ctrl(\+|$)/gi, '^');
    str = replaceAll(str, /alt(\+|$)/gi, '⌥');
    str = replaceAll(str, /meta(\+|$)/gi, '◆');
    str = replaceAll(str, /win(\+|$)/gi, '⊞');
    str = replaceAll(str, /cmd(\+|$)/gi, '⌘');
    // note: a bit hacky, to handle combined key descriptions
    str = replaceAll(str, /(?<!\/) (?!\/)/g, ', ');
    str = replaceAll(str, /escape/gi, 'ESC');
    str = replaceAll(str, /,{2,}/gi, ',');
    return str;
}

export interface IIndexed {
    index: number;
}

export function get<T extends object, K extends keyof T>(x: T, key: K, def: T[K]) {
    if (key in x && x[key] !== undefined) {
        return x[key];
    } else {
        return def;
    }
}

export const CURSOR_STYLES = {
    [CursorShape.Line]: vscode.TextEditorCursorStyle.Line,
    [CursorShape.Block]: vscode.TextEditorCursorStyle.Block,
    [CursorShape.Underline]: vscode.TextEditorCursorStyle.Underline,
    [CursorShape.LineThin]: vscode.TextEditorCursorStyle.LineThin,
    [CursorShape.BlockOutline]: vscode.TextEditorCursorStyle.BlockOutline,
    [CursorShape.UnderlineThin]: vscode.TextEditorCursorStyle.UnderlineThin,
};

export const STRING_TO_CURSOR: Record<string, CursorShape> = {
    Line: CursorShape.Line,
    Block: CursorShape.Block,
    Underline: CursorShape.Underline,
    LineThin: CursorShape.LineThin,
    BlockOutline: CursorShape.BlockOutline,
    UnderlineThin: CursorShape.UnderlineThin,
};

export function updateCursorAppearance(
    editor: vscode.TextEditor | undefined,
    cursorShape: CursorShape,
) {
    if (editor) {
        editor.options.cursorStyle =
            CURSOR_STYLES[cursorShape] || vscode.TextEditorCursorStyle.Line;
    }
}

export type Replacer = (substring: string) => string;

export function replaceMatchesWith(str: string, regex: RegExp, replacer: Replacer): string {
    let result = '';

    // Loop to find all matches
    let match = regex.exec(str);
    let lastIndex = 0;
    while (match) {
        const fullMatch = match[0]; // e.g., "<key>shift+t</key>"
        const innerMatch = match[1]; // e.g., "shift+t"
        // replace matched text
        result += str.substring(lastIndex, match.index);
        result += fullMatch.replace(innerMatch, replacer(innerMatch));
        lastIndex = match.index + fullMatch.length;

        match = regex.exec(str);
    }

    result += str.substring(lastIndex);

    return result;
}
