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

/* eslint-disable */
// /**
//  * @command storeNamed
//  * @order 105
//  *
//  * Allow the user to specify a name where an [expression's](/expression/index)
//  * result can be stored. Can be retrieved later using
//  * [`restoreNamed`](/commands/restoreNamed).
//  *
//  * **Arguments**
//  * - `description`: Message to show the user to explain why they are providing a name
//  * - `register`: This labels the store where user specified key-value pairs will be stored;
//  *   this allows calls to store and restore values to be specific to the relevant context
//  *   (e.g. only stored macros show up in commands related to macros, and only stored
//  *   bookmarks show up in commands related to bookmarks).
//  * - `content`: the value to store, usually passed as an [expression](/expression/index).
//  */

// const storeNamedArgs = z.object({
//     description: z.string().optional(),
//     register: z.string(),
//     contents: z.string(),
// });

// async function storeNamed(args_: unknown): Promise<CommandResult> {
//     const argsNow = validateInput('master-key.storeNamed', args_, storeNamedArgs);
//     if (argsNow) {
//         const args = argsNow;
//         let value: unknown = undefined;
//         await withState(async (state) => {
//             value = evalContext.evalStr(args.contents, state.values);
//             return state;
//         });
//         if (value !== undefined) {
//             return new Promise<CommandResult>((resolve, reject) => {
//                 try {
//                     const picker = vscode.window.createQuickPick();
//                     picker.title = args.description || args.register;
//                     picker.placeholder = 'Enter a new or existing name';
//                     const options: vscode.QuickPickItem[] = Object.keys(
//                         stored[args.register] || {},
//                     ).map(k => ({ label: k }));
//                     options.unshift(
//                         { label: 'New Name...', alwaysShow: true },
//                         {
//                             label: 'Existing Names:',
//                             kind: vscode.QuickPickItemKind.Separator,
//                         },
//                     );
//                     picker.items = options;
//                     picker.onDidAccept((_) => {
//                         const item = picker.selectedItems[0];
//                         let name;
//                         if (item.label === 'New Name...') {
//                             name = picker.value;
//                         } else {
//                             name = item.label;
//                         }
//                         if (stored[args.register] === undefined) {
//                             stored[args.register] = {};
//                         }
//                         stored[args.register][name] = value;
//                         picker.hide();
//                     });
//                     picker.onDidHide((_) => {
//                         resolve(undefined);
//                     });
//                     picker.show();
//                 } catch (e) {
//                     reject(e);
//                 }
//             });
//         }
//     }
//     return Promise.resolve(undefined);
// }

// /**
//  * @command restoreNamed
//  * @order 105
//  *
//  * Restore a previously stored value (via [`storeNamed`](/commands/storeNamed)), storing
//  * it in `captured`, to be used in a subsequent [`expression`](/bindings/bind#expression).
//  *
//  * **Arguments**
//  * - `description`
//  */

// const restoreNamedArgs = z.object({
//     description: z.string().optional(),
//     register: z.string(),
// });

// const stored: Record<string, Record<string, unknown>> = {};

// const CAPTURED = 'captured';

// async function restoreNamed(args_: unknown): Promise<CommandResult> {
//     const args = validateInput('master-key.restoreNamed', args_, restoreNamedArgs);
//     if (args) {
//         if (!stored[args.register]) {
//             vscode.window.showErrorMessage(
//                 `No values are stored under '${args.register}'.`,
//             );
//         }
//         const items = Object.keys(stored[args.register]).map(x => ({ label: x }));
//         const selected = await vscode.window.showQuickPick(items);
//         if (selected !== undefined) {
//             const a = args;
//             const s = selected;
//             await withState(async (state) => {
//                 return state.set(CAPTURED, { public: true }, stored[a.register][s.label]);
//             });
//         }
//     }
//     return;
// }
/* eslint-enable */

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
        if ((reified.error?.length || 0) > 0) {
            let count = 0;
            for (const e of (reified.error || [])) {
                count++;
                if (count > 3) {
                    break;
                }
                vscode.window.showErrorMessage(e);
            }
        } else {
            for (let i = 0; i < reified.n_commands(); i++) {
                const resolved_command = reified.resolve_command(i, bindings);
                if (resolved_command.command === 'master-key.ignore') {
                    let count = 0;
                    for (const error of (resolved_command.errors || [])) {
                        count++;
                        if (count >= 3) {
                            vscode.window.showErrorMessage(
                                'There were additional errors when running a \
                                key binding; they have been ignored to maintain \
                                a reasonable number of notifications ',
                            );
                        } else {
                            vscode.window.showErrorMessage(error);
                        }
                    }
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

export function activate(context: vscode.ExtensionContext) {
    // context.subscriptions.push(
    //     vscode.commands.registerCommand(
    //         'master-key.storeNamed',
    //         recordedCommand(storeNamed),
    //     ),
    // );
    // context.subscriptions.push(
    //     vscode.commands.registerCommand(
    //         'master-key.restoreNamed',
    //         recordedCommand(restoreNamed),
    //     ),
    // );
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
