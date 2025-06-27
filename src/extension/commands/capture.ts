import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { CommandResult } from '../state';
import { MODE, defaultMode } from './mode';
import { withState, recordedCommand } from '../state';
import { DoArgs } from '../keybindings/parsing';
import { doCommandsCmd } from './do';

let typeSubscription: vscode.Disposable | undefined;
let onTypeFn: (text: string) => void = async function (_text: string) {
    return;
};
async function onType(event: { text: string }) {
    return await onTypeFn(event.text);
}

const CAPTURE = 'captured';

function clearTypeSubscription() {
    if (typeSubscription) {
        typeSubscription.dispose();
        typeSubscription = undefined;
    }
}

export async function runCommandOnKeys(doArgs: DoArgs | undefined, mode: string) {
    if (mode !== 'capture') {
        clearTypeSubscription();
    }
    if (doArgs) {
        // we await on state to avoid race conditions here (rather than
        // to change or read anything about the state)
        if (!typeSubscription) {
            try {
                typeSubscription = vscode.commands.registerCommand('type', onType);
            } catch (_) {
                vscode.window.
                    showErrorMessage(`Master key failed to capture keyboard input. You
                    might have an extension that is already listening to type events
                    (e.g. vscodevim).`);
            }
        }
        onTypeFn = async (typed: string) => {
            await withState(async state =>
                state.set(CAPTURE, { transient: { reset: '' } }, typed),
            );
            await doCommandsCmd({ do: doArgs });
        };
    }
}

type UpdateFn = (captured: string, nextChar: string) => [string, boolean];
export async function captureKeys(onUpdate: UpdateFn) {
    let oldMode: string;
    await withState(async (state) => {
        oldMode = state.get<string>(MODE)!;
        if (!typeSubscription) {
            try {
                typeSubscription = vscode.commands.registerCommand('type', onType);
                return state.set(MODE, { public: true }, 'capture').resolve();
            } catch (_) {
                vscode.window.
                    showErrorMessage(`Master key failed to capture keyboard input. You
                    might have an extension that is already listening to type events
                    (e.g. vscodevim).`);
            }
        }
        return state;
    });

    let stringResult = '';
    let isResolved = false;
    let resolveFn: (str: string) => void;
    const stringPromise = new Promise<string>((res, _rej) => {
        resolveFn = res;
    });

    await withState(async (state) => {
        return state.onSet(MODE, (state) => {
            if (state.get(MODE, defaultMode) !== 'capture') {
                clearTypeSubscription();
                if (!isResolved) {
                    isResolved = true;
                    resolveFn(stringResult);
                    return false;
                }
            }
            return !isResolved;
        });
    });

    onTypeFn = async (str: string) => {
        let stop;
        [stringResult, stop] = onUpdate(stringResult, str);
        if (stop) {
            clearTypeSubscription();
            // setting the mode will call `resolveFn`
            await withState(async state =>
                state.set(MODE, { public: true }, oldMode).resolve(),
            );
            // if the old mode wasn't 'capture', `resolveFn` will have already been called
            // (in the `onSet` block above)
            if (!isResolved) {
                isResolved = true;
                resolveFn(stringResult);
            }
        }
    };

    return stringPromise;
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
 * characters as a string in the variable `captured`, accessible in any subsequent
 * [expression](/expressions/index).
 *
 * **Arguments**
 * - `acceptAfter`: The number of keys to capture
 *
 * > [!NOTE] The command also accepts a second, optional argument called `text`, which can
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
        await withState(async (state) => {
            return state.set(CAPTURE, { transient: { reset: '' } }, text);
        });
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

export function activate(context: vscode.ExtensionContext) {
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
