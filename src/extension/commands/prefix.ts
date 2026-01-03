import * as vscode from 'vscode';
import z from 'zod';
import {
    STRING_TO_CURSOR,
    updateCursorAppearance,
    validateInput,
} from '../utils';
import { recordedCommand, CommandResult, state, onSet } from '../state';
import { restoreModesCursorState } from './mode';
import {
    commandMutex,
    registerPaletteUpdate,
    showPaletteOnDelay,
    triggerCommandCompleteHooks,
} from './do';

const prefixArgs = z.
    object({
        key_id: z.number().optional(),
        old_prefix_id: z.number().optional(),
        command_id: z.number(),
        mode: z.string(),
        prefix_id: z.number(),
        fromDo: z.boolean().default(true),
        key: z.string(),
        cursor: z.enum([
            'Line',
            'Block',
            'Underline',
            'LineThin',
            'BlockOutline',
            'UnderlineThin',
        ]).optional(),
    }).
    strict();

export const PREFIX_CODE = 'prefixCode';
export const PREFIX_CODES = 'prefixCodes';
export const PREFIX = 'prefix';
const PREFIX_CURSOR = 'prefixCursor';

/**
 * @command prefix
 * @order 131
 *
 * This command is used to implement multi-key sequence bindings in master key. It causes
 * the current key press to be appended to the variable `key.prefix`. This prefix shows up
 * in the status bar in VSCode. It can also be used explicitly within a binding file for a
 * few purposes:
 *
 * - provide helpful documentation for a given key prefix.
 * - define a command that has several possible follow-up key presses (such as operators in
 *   vim).
 * - execute commands in addition to updating the prefix
 *   (see [running multiple commands](#running-multiple-commands))
 *
 * **Arguments**
 * - `cursor`: Transiently change the cursor shape until the last key in a multi-key
 *   sequence is pressed. Valid values are:
 *    - 'Line',
 *    - 'Block',
 *    - 'Underline',
 *    - 'LineThin',
 *    - 'BlockOutline',
 *    - 'UnderlineThin',
 *
 * ## Example
 *
 * The `tab` prefix is documented in the `Larkin` bindings as follows
 *
 * ```toml
 * [[bind]]
 * defaults = "util"
 * name = "utility"
 * key = "tab"
 * description = """
 * utility related commands: file opening, window manipulation, debugging etc...
 * """
 * command = "master-key.prefix"
 * ```
 *
 * The prefix command is used here so that this prefix binding is well documented.
 *
 * ## Prefix Format
 *
 * The prefix state is stored under `key.prefix` (when evaluating an
 * [expression](/expressions/index)) and under `master-key.prefix` in a `when` clause
 * (though it should rarely be necessary to access the prefix explicitly in a `when`
 * clause). It is stored as a space delimited sequence of keybindings in the same form that
 * the [`key`](/bindings/bind) field is specified (which is the same as the binding format
 * for any VSCode keybinding). It is displayed in the status bar in a stylized fashion: e.g.
 * Ctrl+J becomes ^J.
 *
 * ## Transient State
 *
 * A binding that includes a `prefix` command has `finalKey` set to `false`. Whereas,
 * without a `prefix` command present, the default is `true`. When `finalKey` is `false`
 * master key does not reset any previously set transient state (e.g. from previous calls to
 * `prefix` or `updateCount`). When `finalKey` is `true` any
 * transient state is returned to a default, unset state.
 *
 * In most circumstances you do not want to set `finalKey` to false *without* using
 * `master-key.prefix`, but there are exceptions. In this situation the key's commands will
 * be executed but the key the user pressed will *not* update the prefix state. For example,
 * pressing "shift+;" in Larkin displays a menu of possible key suffixes. This command is
 * implemented as follows
 *
 * ```toml
 * [[bind]]
 * key = "shift+;"
 * doc.name = "suggest"
 * finalKey = false
 * doc.hideInPalette = true
 * prefixes.any = true
 * mode = '{{not_modes(["insert"])}}'
 * doc.description = """
 * show command suggestions within the context of the current mode and keybinding prefix
 * (if any). E.g. `TAB, ⇧;` in `normal` mode will show all `normal` command suggestions
 * that start with `TAB`.
 * """
 * command = "master-key.toggleSuggestions"
 * ```
 *
 * A few things are going on here:
 *
 * 1. The binding applies regardless of the current prefix (`prefixes.any = true`).
 * 2. This calls a command that lists possible keys that can be pressed given the current
 *    prefix (`command = "master-key.toggleSuggestions"`). `master-key.prefix` is not
 *    called, so the press of `shift+;` will not update to the current sequence of keys that
 *    have been pressed. It's "invisible" as far as the sequence of a multi-key binding is
 *    concerned.
 * 3. The binding does not reset the prefixes state since `finalKey = false`, so master key
 *    will continue to wait for additional key presses that can occur for the given
 *    keybinding prefix.
 *
 * In this way the user can ask for help regarding which keys they can press next, without
 * resetting the state.
 */

let oldPrefixCursor: boolean = false;
async function prefix(args_: unknown): Promise<CommandResult> {
    // console.profile('master-key-prefix');
    registerPaletteUpdate();
    const args = validateInput('master-key.prefix', args_, prefixArgs);

    if (args !== undefined) {
        const release = !args.fromDo ? await commandMutex.acquire() : undefined;
        try {
            const a = args;
            const prefix = a.key;
            state.set(PREFIX_CODE, a.prefix_id);
            state.set(PREFIX, prefix);

            if (a.cursor) {
                const cursorShape = STRING_TO_CURSOR[a.cursor];
                state.set(PREFIX_CURSOR, true);
                oldPrefixCursor = true;
                updateCursorAppearance(vscode.window.activeTextEditor, cursorShape);
            }

            state.resolve();
            showPaletteOnDelay();
            await triggerCommandCompleteHooks();
            return args;
        } finally {
            if (release) {
                release();
            }
            // console.profileEnd('master-key-prefix');
        }
    }
}

export async function keySuffix(key: string) {
    const prefix: string = state.get(PREFIX) || '';
    state.set(PREFIX, prefix.length > 0 ? prefix + ' ' + key : key);
}

export function defineState() {
    state.define(PREFIX, '', { transient: { reset: '' } });
    state.define(PREFIX_CODE, 0, { transient: { reset: 0 } });
    state.define(PREFIX_CURSOR, false, { transient: { reset: false } });
}

export async function activate(_context: vscode.ExtensionContext) {
    onSet(PREFIX_CURSOR, (prefixCursor) => {
        if (!prefixCursor && oldPrefixCursor) {
            restoreModesCursorState();
        }
        return true;
    });
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.prefix', recordedCommand(prefix)),
    );
}
