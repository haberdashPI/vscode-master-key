import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import {
    commandArgs,
    CommandResult,
    recordedCommand,
    WrappedCommandResult,
} from '../state';
import { merge } from 'lodash';
import { bindings } from '../keybindings/config';
import { showExpressionErrors, showExpressionMessages } from './do';

/**
 * @command storeCommand
 * @order 105
 *
 * Stores a command (or part of one) to run later using
 * [`executeStoredCommand`](/commands/executeStoredCommand).
 *
 * **Arguments**
 * - `command`: (optional) the name of the command to store
 * - `args`: (optional) The arguments to pass to the `command`
 * - `register`: a unique name where the command and its arguments will be stored
 */
const storeCommandArgs = z.object({
    register: z.string(),
    command: z.string().optional(),
    args: z.any().optional(),
});
type StoreCommandArgs = z.infer<typeof storeCommandArgs>;

const storedCommands: Record<string, StoreCommandArgs> = {};

async function storeCommand(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.storeCommand', args_, storeCommandArgs);
    if (args) {
        storedCommands[args.register] = args;
    }
    return undefined;
}

/**
 * @command executeStoredCommand
 * @order 105
 *
 * Runs a command previously stored with [`storeCommand`](/commands/storeCommand).
 * The arguments passed to `storeCommand` are merged with those passed here before
 * running the command.
 *
 * **Arguments**
 * - `command`: (optional) the name of the command to run
 * - `args`: (optional) The arguments to pass to the `command`.
 * - `register`: a unique name where the command and its arguments will be stored
 */

const executeStoredCommandArgs = z.object({
    register: z.string(),
    command: z.string().optional(),
    args: z.any().optional(),
});

async function executedStoredCommand(args_: unknown): Promise<CommandResult> {
    const args = validateInput(
        'master-key.executeStoredCommand',
        args_,
        executeStoredCommandArgs,
    );
    if (args) {
        const command = merge(storedCommands[args.register], args);
        const reified = bindings.do_stored_command(command);

        if (!showExpressionErrors(reified)) {
            for (let i = 0; i < reified.n_commands(); i++) {
                const resolved_command = reified.resolve_command(i, bindings);
                showExpressionMessages(resolved_command);

                if (resolved_command.command === 'master-key.ignore') {
                    showExpressionErrors(resolved_command);
                } else {
                    const result = await vscode.commands.
                        executeCommand<WrappedCommandResult | void>(
                            resolved_command.command,
                            resolved_command.args,
                        );
                    const resolvedArgs = commandArgs(result);
                    if (resolvedArgs === 'cancel') {
                        return 'cancel';
                    }
                }
            }
        }
        return args;
    }
    return undefined;
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
}

export async function activate(_context: vscode.ExtensionContext) {
    return;
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.storeCommand',
            recordedCommand(storeCommand),
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.executeStoredCommand',
            recordedCommand(executedStoredCommand),
        ),
    );
}
