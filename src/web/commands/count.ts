
import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { withState, recordedCommand, CommandState, CommandResult } from '../state';

export const COUNT = 'count';

const updateCountArgs = z.object({
    value: z.coerce.number()
}).strict();

async function updateCount(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.updateCount', args_, updateCountArgs);
    if(args !== undefined){
        let a = args;
        await withState(async state => {
            return state.update<number>(
                COUNT,
                { public: true, transient: {reset: 0}, notSetValue: 0},
                count => count * 10 + a.value
            );
        });
    }
    return;
}

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('master-key.updateCount',
        recordedCommand(updateCount)));
    await withState(async state => state.set(COUNT, 0));
}
