import * as vscode from 'vscode';
import z from 'zod';
import {
    CURSOR_SHAPES,
    CursorShape,
    updateCursorAppearance,
    validateInput,
} from '../utils';
import { recordedCommand, CommandState, CommandResult, withState, onSet } from '../state';
import { PrefixCodes } from '../keybindings/processing';
import { restoreModesCursorState } from './mode';

const prefixArgs = z.
    object({
        code: z.number(),
        flag: z.string().min(1).endsWith('_on').optional(),
        cursor: z.enum(CURSOR_SHAPES).optional(),
        // `automated` is used during keybinding preprocessing and is not normally used
        // otherwise
        automated: z.boolean().optional(),
    }).
    strict();

export const PREFIX_CODE = 'prefixCode';
export const PREFIX_CODES = 'prefixCodes';
export const PREFIX = 'prefix';
const PREFIX_CURSOR = 'prefixCursor';

// HOLD ON!! this feels broken — really when the prefix codes get LOADED
// we should translate them into the proper type of object
// (and this would keep us from having this weird async api within `withState`)
export function prefixCodes(state: CommandState): [CommandState, PrefixCodes] {
    const prefixCodes_ = state.get(PREFIX_CODES);
    let prefixCodes: PrefixCodes;
    if (!prefixCodes_) {
        prefixCodes = new PrefixCodes();
        state = state.set(PREFIX_CODES, prefixCodes);
    } else if (!(prefixCodes_ instanceof PrefixCodes)) {
        prefixCodes = new PrefixCodes(<Record<string, number>>prefixCodes_);
        state = state.set(PREFIX_CODES, prefixCodes);
    } else {
        prefixCodes = prefixCodes_;
    }
    return [state, prefixCodes];
}

/**
 * @command prefix
 * @order 131
 *
 * This command is used to implement multi-key sequence bindings in master key. It causes
 * the current key press to be appended to a variable storing the pending key sequence. It
 * can also be used explicitly within a binding file for a few purposes:
 *
 * - provide helpful documentation for a given key prefix.
 * - define a command that has several possible follow-up key presses (such as operators in
 *   vim).
 * - execute commands in addition to updating the prefix (via `runCommands`)
 *
 * **Arguments**
 * - `flag`: If present, transiently sets the given flag to true. See also
 *   [`setFlag`](/commands/setFlag)
 * - `cursor`: Transiently change the cursor shape until the last key in a multi-key
 *   sequence is pressed
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
 * These prefixes may be explicitly specified in this way so they can be documented. When
 * users do not provide an explicit prefix, Master key explicitly creates these bindings by
 * itself, but without documentation. As such, all of the bindings written in a
 * `keybinding.json` file have just a single key press, with some conditioned on the
 * specific prefix that must occur beforehand. This is so that master key can explicitly
 * manage state across the key presses of a multi-key sequence keybinding.
 *
 * ## Prefix Format
 *
 * The prefix state is stored under `prefix` (when evaluating an
 * [expression](/expressions/index)) and under `master-key.prefix` in a `when` clause
 * (though it should rarely be necessary to access the prefix explicitly in a `when`
 * clause). It is stored as a space delimited sequence of keybindings in the same form that
 * the [`key`](/bindings/bind) field is specified (which is the same as the binding format
 * for any VSCode keybinding).
 *
 * ## Transient State
 *
 * A binding that includes a `prefix` command has `finalKey` set to `false`. Whereas,
 * without a `prefix` command present, the default is `true`. When `finalKey` is `false`
 * master key not reset any previously set transient state (e.g. from previous calls to
 * `prefix` or transient [`setFlag`](/commands/setFlag)). When `finalKey` is `true` any
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
 * name = "suggest"
 * finalKey = false
 * hideInPalette = true
 * prefixes = "{{all_prefixes}}"
 * mode = ["!capture", "!insert"]
 * description = """
 * show command suggestions within the context of the current mode and keybinding prefix
 * (if any). E.g. `TAB, ⇧;` in `normal` mode will show all `normal` command suggestions
 * that start with `TAB`.
 * """
 * command = "master-key.commandSuggestions"
 * ```
 *
 * A few things are going on here:
 *
 * 1. The binding applies regardless of the current prefix (`prefixes =
 *    "&#123;&#123;all_prefixes&#125;&#125;").
 * 2. This calls a command that lists possible keys that can be pressed given the current
 *    prefix (`command = "master-key.commandSuggestions"`). `master-key.prefix` is not
 *    called, so the press of `shift+;` will not update to the current sequence of keys that
 *    have been pressed. (It's "invisible")
 * 3. The binding does not reset the prefixes state since `finalKey = false`, so master key
 *    will continue to wait for additional key presses that can occur for the given
 *    keybinding prefix.
 *
 * In this way the user can ask for help regarding which keys they can press next.
 */

let oldPrefixCursor: boolean = false;
async function prefix(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.prefix', args_, prefixArgs);
    if (args !== undefined) {
        const a = args;
        await withState(async (state) => {
            return state.withMutations((state) => {
                let codes;
                [state, codes] = prefixCodes(state);
                const prefix = codes.nameFor(a.code);
                state.set(PREFIX_CODE, { transient: { reset: 0 }, public: true }, a.code);
                state.set(PREFIX, { transient: { reset: '' }, public: true }, prefix);

                if (a.flag) {
                    state.set(a.flag, { transient: { reset: false }, public: true }, true);
                }
                if (a.cursor) {
                    const cursorShape = <CursorShape>a.cursor;
                    state.set(PREFIX_CURSOR, { transient: { reset: false } }, true);
                    oldPrefixCursor = true;
                    updateCursorAppearance(vscode.window.activeTextEditor, cursorShape);
                }
            });
        });
        return args;
    }
    return args;
}

export async function keySuffix(key: string) {
    await withState(async (state) => {
        return state.update<string>(
            PREFIX,
            { transient: { reset: '' }, public: true, notSetValue: '' },
            prefix => (prefix.length > 0 ? prefix + ' ' + key : key),
        );
    });
}

export async function activate(context: vscode.ExtensionContext) {
    await withState(async (state) => {
        return state.set(PREFIX_CODE, { public: true }, 0).resolve();
    });
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.prefix', recordedCommand(prefix)),
    );

    await onSet(PREFIX_CURSOR, (state) => {
        if (!state.get(PREFIX_CURSOR, false) && oldPrefixCursor) {
            restoreModesCursorState();
        }
        return true;
    });
}
