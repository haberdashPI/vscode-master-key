import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { recordedCommand, CommandState, CommandResult, withState } from '../state';
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

async function prefix(args_: unknown): Promise<CommandResult>{
    let args = validateInput('master-key.prefix', args_, prefixArgs);
    if(args !== undefined){
        let a = args;
        withState(async state => {
            return state.withMutations(state => {
                let prefixCodes = state.get<PrefixCodes>(PREFIX_CODES)!;
                let prefix = prefixCodes.nameFor(a.code);
                state.set(PREFIX_CODE, {transient: {reset: 0}, public: true}, a.code);
                state.set(PREFIX, {transient: {reset: ''}, public: true}, prefix);

                if (a.flag) {
                    state.set(a.flag, { transient: { reset: false }, public: true }, true);
                };
            });
        });
        return args;
    }
    return args;
}

export function keySuffix(key: string) {
    withState(async state => {
        return state.update<string>(
            PREFIX,
            { transient: { reset: "" }, public: true, notSetValue: "" },
            prefix => prefix.length > 0 ? prefix + " " + key : key);
    });
}

export function activate(context: vscode.ExtensionContext){
    withState(async state => {
        return state.set(PREFIX_CODE, {public: true}, 0);
    });
    context.subscriptions.push(vscode.commands.registerCommand('master-key.prefix',
        recordedCommand(prefix)));
}
