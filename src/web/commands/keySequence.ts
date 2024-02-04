import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { CommandState } from '../state';
import { PrefixCodes } from '../keybindingProcessing';
import replaceAll from 'string.prototype.replaceall';

const prefixArgs = z.object({
    code: z.number(),
    flag: z.string().min(1).optional(),
    // `automated` is used during keybinding preprocessing and is not normally used otherwise
    automated: z.boolean().optional()
}).strict();

const PREFIX_CODE = 'prefixCode';
const PREFIX_CODES = 'prefixCodes';
const PREFIX = 'prefix';
const FLAGS = 'flag';
const DEFAULT_FLAGS = new Set<string>();
const COUNT = 'count';

function prefix(args_: unknown, state: CommandState){
    let args = validateInput('master-key.prefix', args_, prefixArgs);
    if(args !== undefined){
        let prefix = state.get<PrefixCodes>(PREFIX_CODES)?.nameFor(args.code);
        state.set(PREFIX_CODE, args.code);
        state.set(PREFIX, prefix);

        if(args.flag){
            let flags = state.get<Set<string>>(FLAGS, DEFAULT_FLAGS);
            flags!.add(args.flag);
        }
        return state;
    }
    return state;
}

const updateCountArgs = z.object({
    value: z.coerce.number()
}).strict();

function updateCount(args_: unknown, state: CommandState){
    let args = validateInput('master-key.updateCount', args_, updateCountArgs);
    if(args !== undefined){
        state.set(COUNT, state.get<number>(COUNT, 0)!*10 + args.value);
    }
    return state;
}

function prettifyPrefix(str: string){
    str = str.toUpperCase();
    str = replaceAll(str, /shift\+/gi, '⇧');
    str = replaceAll(str, /ctrl\+/gi, '^');
    str = replaceAll(str, /alt\+/gi, '⌥');
    str = replaceAll(str, /meta\+/gi, '◆');
    str = replaceAll(str, /win\+/gi, '⊞');
    str = replaceAll(str, /cmd\+/gi, '⌘');
    str = replaceAll(str, / /g, ", ");
    return str;
}

let keyStatusBar: vscode.StatusBarItem | undefined = undefined;

let statusUpdates = Number.MIN_SAFE_INTEGER;
function updateKeyStatus(state: CommandState, opt: {delayedUpdate: boolean}){
    if(keyStatusBar !== undefined){
        let count = state.get<number>(COUNT);
        let plannedUpdate = count ? count + "× " : '';
        plannedUpdate += prettifyPrefix(state.get(PREFIX) || '');
        if(opt.delayedUpdate){
            let currentUpdate = statusUpdates;
            setTimeout(() => {
                if(currentUpdate === statusUpdates){
                    if(statusUpdates < Number.MAX_SAFE_INTEGER){
                        statusUpdates += 1;
                    }else{
                        statusUpdates = Number.MIN_SAFE_INTEGER;
                    }

                    if(keyStatusBar){ keyStatusBar.text = plannedUpdate; }
                }
            });
        }else{
            keyStatusBar.text = plannedUpdate;
        }
    }
}

export function activate(context: vscode.ExtensionContext){
    keyStatusBar = vscode.window.createStatusBarItem('keys', vscode.StatusBarAlignment.Left, -10000);
    keyStatusBar.accessibilityInformation = { label: "Keys Typed" };
    keyStatusBar.show();

    // TODO: if `prefix` ever becomes a bare command, well need to copy some of the
    // state handling code I write up in `master-key.do` to here
    context.subscriptions.push(vscode.commands.registerCommand('master-key.prefix', prefix));
    context.subscriptions.push(vscode.commands.registerCommand('master-key.updateCount', updateCount));
}
