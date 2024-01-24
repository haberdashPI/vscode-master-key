import * as vscode from 'vscode';
import z from 'zod';
import { showParseError } from './keybindingParsing';

// function validateInput(command: string, args_: unknown,
//     using: z.ZodUn);
export function validateInput<T, Def extends z.ZodTypeDef, I>(command: string, args_: unknown,
    using: z.ZodType<T,Def,I>): T | undefined {
    let result = using.safeParse(args_);
    if(!result.success){
        showParseError(`'${command}' `, result.error);
        return;
    }
    return result.data;
}

export function wrappedTranslate(x: vscode.Position, doc: vscode.TextDocument, val: number){
    if(val < 0){
        let result = x;
        while(result.character + val < 0){
            val += 1;
            result = result.translate(-1, 0);
            result = result.translate(0, doc.lineAt(result).range.end.character);
        }
        return result.translate(0, val);
    }else{
        let result = x;
        while(result.character + val > doc.lineAt(result).range.end.character){
            val -= 1;
            result = new vscode.Position(result.line+1, 0);
        }
        return result.translate(0, val);
    }
}
