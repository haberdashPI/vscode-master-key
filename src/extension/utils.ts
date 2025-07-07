import * as vscode from 'vscode';
import z from 'zod';
import { showParseError } from './keybindings/parsing';
import replaceAll from 'string.prototype.replaceall';
import { DoArgs } from './keybindings/parsing';

// function validateInput(command: string, args_: unknown,
//     using: z.ZodUn);
export function validateInput<T, Def extends z.ZodTypeDef, I>(
    command: string,
    args_: unknown,
    using: z.ZodType<T, Def, I>,
): T | undefined {
    const result = using.safeParse(args_ || {});
    if (!result.success) {
        showParseError(`'${command}' `, result.error);
        return;
    }
    return result.data;
}

export function isSingleCommand(x: DoArgs, cmd: string) {
    if (x.length > 1) {
        return false;
    }
    return x[0].command === cmd;
}

export function hasCommand(x: DoArgs, cmd: string) {
    return x.some(x => x.command === cmd);
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
    Line: vscode.TextEditorCursorStyle.Line,
    Block: vscode.TextEditorCursorStyle.Block,
    Underline: vscode.TextEditorCursorStyle.Underline,
    LineThin: vscode.TextEditorCursorStyle.LineThin,
    BlockOutline: vscode.TextEditorCursorStyle.BlockOutline,
    UnderlineThin: vscode.TextEditorCursorStyle.UnderlineThin,
};

export const CURSOR_SHAPES: [string, ...string[]] = [
    'Line',
    'Block',
    'Underline',
    'LineThin',
    'BlockOutline',
    'UnderlineThin',
];

export type CursorShape =
    | 'Line' |
    'Block' |
    'Underline' |
    'LineThin' |
    'BlockOutline' |
    'UnderlineThin';

export function updateCursorAppearance(
    editor: vscode.TextEditor | undefined,
    cursorShape: CursorShape,
) {
    if (editor) {
        editor.options.cursorStyle =
            CURSOR_STYLES[cursorShape] || vscode.TextEditorCursorStyle.Line;
    }
}
