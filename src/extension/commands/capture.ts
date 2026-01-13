import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { commandArgs, CommandResult, WrappedCommandResult } from '../state';
import { MODE } from './mode';
import { state, onSet, recordedCommand } from '../state';
import { Mode, WhenNoBindingHeader } from '../../rust/parsing/lib/parsing';

import { bindings } from '../keybindings/config';
import { maxHistory, showExpressionErrors, showExpressionMessages } from './do';

// the `typeSubscription` tracks a hook on vscode's `type` event, which triggers an event
// for every keypress, and prevent the user's input from inserting characters in a file
let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function (_text: string) {
    return;
};
async function onType(event: { text: string }) {
    return await onTypeFn(event.text);
}

// the `key.captured` value stores the content of type events
export const CAPTURE = 'captured';

function clearTypeSubscription() {
    if (typeSubscription) {
        typeSubscription.dispose();
        typeSubscription = undefined;
    }
}

// for each key press run a sequence of commands associated with `mode`
// (ala `mode.whenNoBinding.run`)
export async function runCommandsForMode(mode: Mode) {
    if (mode.name !== 'capture') {
        clearTypeSubscription();
    }
    if (mode.whenNoBinding() === WhenNoBindingHeader.Run) {
        if (!typeSubscription) {
            try {
                typeSubscription = vscode.commands.registerCommand('type', onType);
            } catch (_) {
                vscode.window.
                    showErrorMessage(
                        `Master key failed to capture keyboard input. You
                        might have an extension that is already listening to type events
                        (e.g. vscodevim).`,
                    );
            }
        }
        onTypeFn = async (typed: string) => {
            state.set(CAPTURE, typed);
            const binding = mode.run_commands(bindings);
            if (!showExpressionErrors(binding)) {
                for (let i = 0; i < binding.n_commands(); i++) {
                    const resolved_command = binding.resolve_command(i, bindings);
                    showExpressionMessages(resolved_command);
                    showExpressionErrors(resolved_command);
                    if (resolved_command.command !== 'master-key.ignore') {
                        const result = await vscode.commands.
                            executeCommand<WrappedCommandResult | void>(
                                resolved_command.command,
                                resolved_command.args,
                            );
                        const resolvedArgs = commandArgs(result);
                        if (resolvedArgs === 'cancel') {
                            return 'cancel';
                        }
                        if (resolvedArgs) {
                            resolved_command.args = resolvedArgs;
                        }
                        binding.store_command(i, resolved_command);
                    }
                }
                bindings.store_binding(binding, maxHistory);
            }
        };
    }
}

// captureKeys requests input from the user by subscribing to `type` events `onUpdate` is
// called for every key press, it receives two values, `result` containing the entire
// sequence of previous keys pressed and `char` containing the current key press. It should
// return the final result (usually result + char) and a boolean indicating whether to stop
// capturing keys. The return value of `captureKeys` contains the entire sequence of keys
// captured, as computed by `onUpdate`.

// TODO: `onUpdate` is needlessly complicated. We can handle updating the text inside
// `captureKeys`, we can have an `acceptsAfter` implemented in `captureKeys` and we can
// handle cancel keys via the ability to define commands inside the `capture` mode.
type UpdateFn = (captured: string, nextChar: string) => [string, boolean];
export async function captureKeys(onUpdate: UpdateFn): Promise<string> {
    const oldMode = state.get<string>(MODE)!;
    if (!typeSubscription) {
        try {
            typeSubscription = vscode.commands.registerCommand('type', onType);
            state.set(MODE, 'capture');
            state.resolve();
        } catch (_) {
            vscode.window.
                showErrorMessage(
                    `Master key failed to capture keyboard input. You
                    might have an extension that is already listening to type events
                    (e.g. vscodevim).`,
                );
        }
    }

    // setup a promise that we'll fulfill within the `onType` function
    let stringResult = '';
    let isCaptured = false;
    let captureValue: (str: string) => void;
    const returnValue = new Promise<string>((res, _rej) => {
        captureValue = res;
    });

    // if a keybinding is defined that changes the key mode, we want to stop capturing keys
    // at this point
    onSet(MODE, (mode) => {
        if (mode !== 'capture') {
            clearTypeSubscription();
            if (!isCaptured) {
                isCaptured = true;
                captureValue(stringResult);
                return false;
            }
        }
        return !isCaptured;
    });

    // actually handle key presses
    onTypeFn = async (str: string) => {
        let stop;
        [stringResult, stop] = onUpdate(stringResult, str);
        if (stop) {
            clearTypeSubscription();
            // setting the mode will call `captureValue`
            state.set(MODE, oldMode);
            state.resolve();

            // if the old mode wasn't 'capture', `captureValue` will have already been
            // called (in the `onSet` block above)
            if (!isCaptured) {
                isCaptured = true;
                captureValue(stringResult);
            }
        }
    };

    return returnValue;
}

const captureKeysArgs = z.object({
    text: z.string().optional(),
    acceptAfter: z.number().min(1),
});

/**
 * @command captureKeys
 * @section Inputting Strings
 * @order 110
 *
 * Awaits user input for a fixed number of key presses, and then stores the resulting
 * characters as a string in the variable `key.captured`, accessible in any subsequent
 * [expression](/expressions/index).
 *
 * **Arguments**
 * - `acceptAfter`: The number of keys to capture
 *
 * > [!NOTE] Implementation detail
 * > The command also accepts a second, optional argument called `text`, which can
 * > directly express what keys to store in `captured` instead of requesting input from the
 * > user. This is not really useful when writing a `[[bind]]` entry, but is defined to make
 * > it easy to replay previously executed versions of this command (e.g. in a keyboard
 * > macro).
 */

async function captureKeysCmd(args_: unknown): Promise<CommandResult> {
    let args = validateInput('master-key.captureKeys', args_, captureKeysArgs);
    if (args) {
        const a = args;
        let text: string;
        if (args.text) {
            text = args.text;
        } else {
            text = await captureKeys((result, char) => {
                let stop = false;
                if (char === '\n') {
                    stop = true;
                } else {
                    result += char;
                    if (result.length >= a.acceptAfter) {
                        stop = true;
                    }
                }
                return [result, stop];
            });
        }
        if (!text) {
            return 'cancel';
        }
        state.set(CAPTURE, text);
        args = { ...args, text };
    }
    return args;
}

function captureOneKey() {
    return captureKeys((_result, char) => [char, true]);
}

const charArgs = z.
    object({
        char: z.string().optional(),
    }).
    strict();

/**
 * @command replaceChar
 * @order 110
 *
 * Replace character under the cursor with the given character: if `char` is left blank,
 * user is prompted for the character.
 *
 * **Arguments**
 * - `char` (optional): character to replace with
 */
async function replaceChar(args_: unknown): Promise<CommandResult> {
    const editor_ = vscode.window.activeTextEditor;
    if (!editor_) {
        return;
    }
    const editor = editor_!;

    let args = validateInput('replaceChar', args_, charArgs);
    if (args) {
        const char = args.char === undefined ? await captureOneKey() : args.char;
        editor.edit((edit) => {
            for (const s of editor.selections) {
                edit.replace(new vscode.Range(s.active, s.active.translate(0, 1)), char);
            }
        });
        args = { ...args, char };
    }
    return args;
}

/**
 * @command insertChar
 * @order 110
 *
 * Insert given character at the cursor location: if `char` is left blank,
 * user is prompted for the character.
 *
 * **Arguments**
 * - `char` (optional): character to insert with
 */
async function insertChar(args_: unknown): Promise<CommandResult> {
    const editor_ = vscode.window.activeTextEditor;
    if (!editor_) {
        return;
    }
    const editor = editor_!;

    let args = validateInput('insertChar', args_, charArgs);
    if (args) {
        const char = args.char === undefined ? await captureOneKey() : args.char;
        editor.edit((edit) => {
            for (const s of editor.selections) {
                edit.insert(s.active, char);
            }
        });
        args = { ...args, char };
    }
    return args;
}

////////////////////////////////////////////////////////////////////////////////////////////
// activation

export function defineState() {
    state.define(CAPTURE, '');
}

export async function activate(_context: vscode.ExtensionContext) {
    return;
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.captureKeys',
            recordedCommand(captureKeysCmd),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.replaceChar',
            recordedCommand(replaceChar),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.insertChar',
            recordedCommand(insertChar),
        ),
    );
}
