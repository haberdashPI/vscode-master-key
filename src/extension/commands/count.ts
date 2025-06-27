import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { withState, recordedCommand, CommandResult } from '../state';

export const COUNT = 'count';

const updateCountArgs = z.object({ value: z.coerce.number() }).strict();

/**
 * @command updateCount
 * @order 103
 *
 * Updates the count. If already set, adds a new digit to the count. This shows up in the
 * status bar in front of any keybinding It can be accessed in when clauses using
 * `master-key.count` and in [expressions](/expressions/index) using `count`. Typically one
 * should set `finalKey` to false when using `updateCount`, as the count is only set
 * transiently; see [`master-key.prefix`](/commands/prefix) for details.
 *
 * **Arguments**
 * - `value`: The numeric value to set the `count` variable to
 *
 * ## Example:
 *
 * ```toml
 * [[bind]]
 * foreach.num = ['{{key: [0-9]}}']
 * name = "count {{num}}"
 * key = "{{num}}"
 * command = "master-key.updateCount"
 * args.value = "{{num}}"
 * finalKey = false
 * mode = "normal"
 *
 * [[bind]]
 * key = "j"
 * name = "↓"
 * mode = "normal"
 * command = "cursorMove"
 * computedArgs.value = "count"
 * args.to = "down"
 * args.by = "wrappedLine"
 * ```
 *
 * Typing 5j with the above bindings defined would move the cursor to the fifth line down.
 */
async function updateCount(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.updateCount', args_, updateCountArgs);
    if (args !== undefined) {
        const a = args;
        await withState(async (state) => {
            return state.update<number>(
                COUNT,
                { public: true, transient: { reset: 0 }, notSetValue: 0 },
                count => count * 10 + a.value,
            );
        });
    }
    return;
}

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.updateCount',
            recordedCommand(updateCount),
        ),
    );
    await withState(async state => state.set(COUNT, { public: true }, 0).resolve());
}
