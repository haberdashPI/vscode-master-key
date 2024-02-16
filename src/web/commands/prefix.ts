import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { wrapStateful, CommandState, CommandResult } from '../state';
import { PrefixCodes } from '../keybindings/processing';

const prefixArgs = z.object({
    code: z.number(),
    flag: z.string().min(1).endsWith('_on').optional(),
    // `automated` is used during keybinding preprocessing and is not normally used otherwise
    automated: z.boolean().optional()
}).strict();

const PREFIX_CODE = 'prefixCode';
const PREFIX_CODES = 'prefixCodes';
export const PREFIX = 'prefix';

async function prefix(state: CommandState, args_: unknown): Promise<CommandResult>{
    let args = validateInput('master-key.prefix', args_, prefixArgs);
    if(args !== undefined){
        let prefix = state.get<PrefixCodes>(PREFIX_CODES)?.nameFor(args.code);
        state.set(PREFIX_CODE, args.code, true);
        state.set(PREFIX, prefix, true);

        if(args.flag){ state.set(args.flag, true, true); }
        return [undefined, state];
    }
    return [undefined, state];
}

export function keySuffix(state: CommandState, key: string){
    let newPrefix = state.get<string>(PREFIX, '')!;
    newPrefix = newPrefix.length > 0 ? newPrefix + " " + key : key;
    state.set(PREFIX, newPrefix);
}

export function activate(context: vscode.ExtensionContext){
    context.subscriptions.push(vscode.commands.registerCommand('master-key.prefix',
        wrapStateful(prefix)));
}
