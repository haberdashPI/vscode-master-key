
import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { wrapStateful, CommandState, CommandResult } from '../state';

export const COUNT = 'count';

const updateCountArgs = z.object({
    value: z.coerce.number()
}).strict();

async function updateCount(state: CommandState, args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.updateCount', args_, updateCountArgs);
    if(args !== undefined){
        state.set(COUNT, state.get<number>(COUNT, 0)! * 10 + args.value,
            { public: true, transient: true });
    }
    return [undefined, state];
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('master-key.updateCount',
        wrapStateful(updateCount)));
}
