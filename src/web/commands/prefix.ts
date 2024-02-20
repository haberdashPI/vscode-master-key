import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { wrapStateful, CommandState, CommandResult, setState } from '../state';
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
        let prefixCodes = state.get<PrefixCodes>(PREFIX_CODES)!;
        let prefix = prefixCodes.nameFor(args.code);
        state.set(PREFIX_CODE, args.code,
            {transient: true, public: true, resetTo: 0});
        state.set(PREFIX, prefix, {transient: true, public: true});

        if(args.flag){ state.set(args.flag, true, {transient: true, public: true}); }
        return [undefined, state];
    }
    return [undefined, state];
}

export function keySuffix(state: CommandState, key: string){
    let newPrefix = state.get<string>(PREFIX, '')!;
    newPrefix = newPrefix.length > 0 ? newPrefix + " " + key : key;
    state.set(PREFIX, newPrefix, {transient: true, public:true});
}

export function activate(context: vscode.ExtensionContext){
    setState(PREFIX_CODE, 0, {public: true}, val => 0);
    context.subscriptions.push(vscode.commands.registerCommand('master-key.prefix',
        wrapStateful(prefix)));
}
