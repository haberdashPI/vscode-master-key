import * as vscode from 'vscode';
import z from 'zod';
import { fromZodError } from 'zod-validation-error';
export { modifierKey, prettifyPrefix, replaceMatchesWith } from './key-utils';
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
