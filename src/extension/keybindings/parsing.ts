import * as vscode from 'vscode';
import TOML from 'smol-toml';
import * as semver from 'semver';
import z, { ZodIssue } from 'zod';
import { ZodError, fromZodError, fromZodIssue } from 'zod-validation-error';
import { expressionId } from '../expressions';
import { uniqBy } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { IParsedBindingDoc, parseBindingDocs } from './docParsing';
import { legacyParse } from './legacyParsing';
export const INPUT_CAPTURE_COMMANDS = [
    'captureKeys',
    'replaceChar',
    'insertChar',
    'search',
];

/**
 * @file bindings/index.md
 * @order -10
 *
 * # Master Keybindings
 *
 * This defines version 2.0 of the master keybinding file format.
 *
 * Master keybindings are [TOML](https://toml.io/en/) files composed of the following
 * top-level fields:
 *
 */

/**
 * @file bindings/index.md
 * @order 50
 *
 * Here's a minimal example, demonstrating the most basic use of each field
 *
 * ```toml
 * [header]
 * # this denotes the file-format version, it must be semver compatible with 2.0
 * version = "2.0"
 * name = "My Bindings"
 *
 * [[mode]]
 * name = "insert"
 *
 * [[mode]]
 * name = "normal"
 * default = true
 *
 * [[kind]]
 * name = "motion"
 * description = "Commands that move your cursor"
 *
 * [[kind]]
 * name = "mode"
 * description = "Commands that change the keybinding mode"
 *
 * [[bind]]
 * key = "i"
 * name = "insert"
 * mode = "normal"
 * command = "master-key.enterInsert"
 * kind = "mode"
 *
 * [[bind]]
 * key = "escape"
 * name = "normal"
 * mode = "insert"
 * command = "master-key.enterNormal"
 * kind = "mode"
 *
 * [[default]]
 * id = "basic_motion"
 * name = "Motion Keys"
 * default.mode = "normal"
 * default.kind = "motion"
 * default.command = "cursorMove"
 *
 * [[bind]]
 * name = "right"
 * defaults = "basic_motion"
 * key = "l"
 * args.to = "right"
 *
 * [[bind]]
 * name = "left"
 * defaults = "basic_motion"
 * key = "h"
 * args.to = "left"
 *
 * [define]
 * foo = 1
 *
 * [[bind]]
 * name = "double right"
 * key = "g l"
 * defaults = "basic_motion"
 * args.to = "right"
 * computedArgs.value = "foo+1"
 * ```
 */

/**
 * @bindingField header
 * @description top-level properties of the binding file
 *
 * **Example**
 *
 * ```toml
 * [header]
 * version = 2.0
 * name = "My Bindings"
 * requiredExtensions = ["Vue.volar"]
 * ```
 *
 * ## Required Fields
 *
 * - `version`: Must be version 2.0.x (typically 2.0); only version 2.0 currently exists.
 *    Follows [semantic versioning](https://semver.org/).
 * - `name`: The name of this keybinding set; shows up in menus to select keybinding presets
 * - `requiredExtensions`: An array of string identifiers for all extensions used by this
 *   binding set.
 *
 * In general if you use the commands from an extension in your keybinding file, it is good
 * to include them in `requiredExtensions` so that others can use your keybindings without
 * running into errors due to a missing extension.
 *
 * ## Finding Extension Identifiers
 *
 * You can find an extension's identifier as follows:
 *
 * 1. Open the extension in VSCode's extension marketplace
 * 2. Click on the gear (⚙︎) symbol
 * 3. Click "Copy Extension ID"; you now have the identifier in your system clipboard
 */
const bindingHeader = z.
    object({
        version: z.
            string().
            refine(x => semver.coerce(x), {
                message: 'header.version is not a valid version number',
            }).
            refine(x => semver.satisfies(semver.coerce(x)!, '2.0'), {
                message: 'header.version is not a supported version number ' +
                    '(must a compatible with 2.0)',
            }),
        requiredExtensions: z.string().array().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
    }).
    strict();
// type BindingHeader = z.infer<typeof bindingHeader>;

/**
 * @bindingField bind
 * @description an actual keybinding; extends the schema used by VSCode's `keybindings.json`
 *
 * **Example**
 *
 * ```toml
 * [[bind]]
 * name = "left"
 * key = "h"
 * mode = "normal"
 * command = "cursorLeft"
 * ```
 * The `bind` element has two categories of fields: functional and documenting.
 *
 * ## Functional Fields
 *
 * The functional fields determine what the keybinding does. Required fields are marked with
 * a `*`.
 *
 */

const rawBindingCommand = z.
    object({
        /**
         * @forBindingField bind
         *
         * - `command`*: A string denoting the command to execute. This is a command
         *   defined by VSCode or an extension thereof.
         *   See [finding commands](#finding-commands). This field has special
         *   behavior for the command `runCommands`
         *   (see [running multiple commands](#running-multiple-commands)).
         */
        command: z.string().optional(), // only optional before default expansion
        /**
         * @forBindingField bind
         *
         * - `args`: The arguments to directly pass to the `command`, these are static
         *   values.
         */
        args: z.any(),
        /**
         * @forBindingField bind
         *
         * - `computedArgs`: Like `args` except that each value is a string that is
         *   evaluated as an [expression](/expressions/index).
         */
        computedArgs: z.object({}).passthrough().optional(),
        /**
         * @forBindingField bind
         * @order 5
         *
         * - `whenComputed`: an [expression](/expressions/index) that, if evaluated to
         *   false, the command will not execute. Favor `when` clauses over `whenComputed`.
         *   The `whenComputed` field is distinct from the `when` clause because it uses the
         *   scope of expressions rather than when clause statements. Furthermore, even if
         *   the `whenComputed` is false, the binding is still considered to have triggered,
         *   and now downstream keybindings will be triggered. It is most useful in
         *   conjunction with `runCommands` or [`storeCommand`](/commands/storeCommand).
         */
        whenComputed: z.string().or(z.boolean()).default(true).optional(),
    }).
    strict();
export type RawBindingCommand = z.infer<typeof rawBindingCommand>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const definedCommand = z.object({ defined: z.string() }).strict();
export type DefinedCommand = z.infer<typeof definedCommand>;

const ALLOWED_MODIFIERS = /Ctrl|Shift|Alt|Cmd|Win|Meta/i;
const ALLOWED_KEYS = [
    /f[1-9]/i,
    /f1[0-9]/i,
    /[a-z]/,
    /[0-9]/,
    /`/,
    /-/,
    /=/,
    /\[/,
    /\]/,
    /\\/,
    /;/,
    /'/,
    /,/,
    /\./,
    /\//,
    /left/i,
    /up/i,
    /right/i,
    /down/i,
    /pageup/i,
    /pagedown/i,
    /end/i,
    /home/i,
    /tab/i,
    /enter/i,
    /escape/i,
    /space/i,
    /backspace/i,
    /delete/i,
    /pausebreak/i,
    /capslock/i,
    /insert/i,
    /numpad[0-9]/i,
    /numpad_multiply/i,
    /numpad_add/i,
    /numpad_separator/i,
    /numpad_subtract/i,
    /numpad_decimal/i,
    /numpad_divide/i,
    // layout independent versions
    /\[f[1-9]\]/i,
    /\[f1[0-9]\]/i,
    /\[Key[A-Z]\]/i,
    /\[Digit[0-9]\]/i,
    /\[Numpad[0-9]\]/i,
    /\[Backquote\]/,
    /\[Minus\]/,
    /\[Equal\]/,
    /\[BracketLeft\]/,
    /\[BracketRight\]/,
    /\[Backslash\]/,
    /\[Semicolon\]/,
    /\[Quote\]/,
    /\[Comma\]/,
    /\[Period\]/,
    /\[Slash\]/,
    /\[ArrowLeft\]/,
    /\[ArrowUp\]/,
    /\[ArrowRight\]/,
    /\[ArrowDown\]/,
    /\[PageUp\]/,
    /\[PageDown\]/,
    /\[End\]/,
    /\[Home\]/,
    /\[Tab\]/,
    /\[Enter\]/,
    /\[Escape\]/,
    /\[Space\]/,
    /\[Backspace\]/,
    /\[Delete\]/,
    /\[Pause\]/,
    /\[CapsLock\]/,
    /\[Insert\]/,
    /\[NumpadMultiply\]/,
    /\[NumpadAdd\]/,
    /\[NumpadComma\]/,
    /\[NumpadSubtract\]/,
    /\[NumpadDecimal\]/,
    /\[NumpadDivide\]/,
];

function fullMatch(x: string, ex: RegExp) {
    const m = x.match(ex);
    if (m === null) {
        return false;
    }
    return m[0].length === x.length;
}

function isAllowedKeybinding(key: string) {
    for (const press of key.split(/\s+/)) {
        const modsAndPress = press.split('+');
        for (const mod of modsAndPress.slice(0, -1)) {
            if (!ALLOWED_MODIFIERS.test(mod)) {
                return false;
            }
        }
        const unmodPress = modsAndPress[modsAndPress.length - 1];
        if (ALLOWED_KEYS.every(a => !fullMatch(unmodPress, a))) {
            return false;
        }
    }
    return true;
}

export async function showParseError(prefix: string, error: ZodError | ZodIssue) {
    let suffix = '';
    if ((<ZodIssue>error).code === undefined) {
        // code is always defined on issues and undefined on errors
        suffix = fromZodError(<ZodError>error).message;
    } else {
        suffix = fromZodIssue(<ZodIssue>error).message;
    }
    const buttonPattern = /\s+\{button:\s*"(.+)(?<!\\)",\s*link:(.+)\}/;
    const match = suffix.match(buttonPattern);
    if (
        match !== null &&
        match.index !== undefined &&
        match[1] !== undefined &&
        match[2] !== undefined
    ) {
        suffix =
            suffix.slice(0, match.index) + suffix.slice(match.index + match[0].length, -1);
        const button = match[1];
        const link = match[2];
        const pressed = await vscode.window.showErrorMessage(prefix + suffix, button);
        if (button === pressed) {
            vscode.env.openExternal(vscode.Uri.parse(link));
        }
    } else {
        vscode.window.showErrorMessage(prefix + suffix);
    }
}

function keybindingError(arg: string) {
    return {
        message: `Invalid keybinding '${arg}'. Tip: capital letters are represented
        using e.g. "shift+a". {button: "Keybinding Docs",
        link:https://code.visualstudio.com/docs/getstarted/keybindings#_accepted-keys}`,
    };
}
const bindingKey = z.
    string().
    refine(isAllowedKeybinding, keybindingError).
    transform((x: string) => x.toLowerCase());

const parsedWhen = z.object({
    str: z.string(),
    id: z.string(),
});
export type ParsedWhen = z.infer<typeof parsedWhen>;

export function parseWhen(when_: string | string[] | undefined): ParsedWhen[] {
    const when = when_ === undefined ? [] : !Array.isArray(when_) ? [when_] : when_;
    return when.map((w) => {
        w = replaceAll(
            w,
            /editorTextFocus/g,
            '(editorTextFocus || master-key.keybindingPaletteOpen && ' +
            'master-key.keybindingPaletteBindingMode)',
        );
        // let p = jsep(w);
        return { str: w, id: expressionId(w) };
    });
}

export const vscodeBinding = z.object({
    key: bindingKey,
    command: z.string(),
    args: z.object({}).optional(),
    when: z.string().optional(),
});

export const rawBindingItem = z.object({
    /**
     * @forBindingField bind
     *
     * - `key`*: the
     *   [keybinding](https://code.visualstudio.com/docs/getstarted/keybindings) that
     *   triggers `command`.
     */
    key: z.string().optional(),
    /**
     * @forBindingField bind
     *
     * - `when`: A [when
     *   clause](https://code.visualstudio.com/api/references/when-clause-contexts)
     *   context under which the binding will be active. Also see Master Key's
     *   [available contexts](#available-contexts)
     */
    when: z.
        union([z.string(), z.string().array()]).
        optional().
        transform(parseWhen).
        pipe(parsedWhen.array()),
    /**
     * @forBindingField bind
     *
     * - `mode`: The mode during which the binding will be active. The default mode is
     *   used when this field is not specified (either directly or via the `defaults`
     *   field)
     */
    mode: z.union([z.string(), z.string().array()]).optional(),
    /**
     * @forBindingField bind
     *
     * - `priority`: The ordering of the keybinding relative to others; determines which
     *   bindings take precedence. Defaults to 0.
     */
    priority: z.number().default(0).optional(),
    /**
     * @forBindingField bind
     *
     * - `defaults`: the hierarchy of defaults applied to this binding, see
     *   [`default`](/bindings/default) for more details.
     */
    defaults: z.string().optional(),
    /**
     * @forBindingField bind
     *
     * - `foreach`: Allows parametric definition of multiple keybindings, see
     *   [`foreach` clauses](#foreach-clauses).
     */
    foreach: z.record(z.string(), z.array(z.string())).optional(),
    /**
     * @forBindingField bind
     *
     * - `prefixes`: (array of strings or the string
     *   <code v-pre>{{all_prefixes}}</code>). Determines one or more *unresolved* key
     *   sequences that can have occurred before typing this key. See
     *   [`master-key.prefix`](/commands/prefix) for details. Defaults to `""` (a.k.a.
     *   no prefix is allowed). This can be set to <code v-pre>{{all_prefixes}}</code>,
     *   if you wish to allow the key binding to work regardless of any unresolved key
     *   sequence that has been pressed (e.g. this is used for the "escape" key binding
     *   in Larkin).
     */
    prefixes: z.
        preprocess(
            x => (x === '{{all_prefixes}}' ? [] : x),
            bindingKey.or(z.string().length(0)).array(),
        ).
        optional(),
    /**
     * @forBindingField bind
     *
     * - `finalKey`: (boolean, default=true) Whether this key should clear any transient
     *   state associated with the pending keybinding prefix. See
     *   [`master-key.prefix`](/commands/prefix) for details.
     */
    finalKey: z.boolean().optional(),
    /**
     * @forBindingField bind
     *
     * - `computedRepeat`: This is an [expression](/expressions/index). It is expected
     *   to evaluate to the number of times to repeat the command. Defaults to zero: one
     *   repeat means the command is run twice.
     * - `command` will be repeated the given
     *   number of times.
     */
    computedRepeat: z.number().min(0).or(z.string()).default(0).optional(),
    /**
     * @forBindingField bind
     * @order 10
     *
     * ## Documenting Fields
     *
     * The documenting fields determine how the keybinding is documented. They are all
     * optional.
     *
     * - `name`: A very description for the command; this must fit in the visual
     *   documentation so it shouldn't be much longer than five characters for most
     *   keys. Favor unicode symbols such as → and ← over text.
     */
    name: z.string().optional(),
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `description`: A longer description of what the command does. Shouldn't be much
     *   longer than a single sentence for most keys. Save more detailed descriptions
     *   for the literate comments.
     */
    description: z.string().optional(),
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `hideInPalette/hideInDocs`: whether to show the keys in the popup suggestions
     *   and the documentation. These both default to false.
     */
    hideInPalette: z.boolean().default(false).optional(),
    hideInDocs: z.boolean().default(false).optional(),
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `combinedName/combinedKey/combinedDescription`: in the suggestion palette and
     *   textual documentation, keys that have the same `combinedName` will be
     *   represented as single entry, using the `combinedKey` and `combinedDescription`
     *   instead of `key` and `description`. The `combinedKey` for a multi-key sequence
     *   should only include the suffix key. All but the first key's `combinedKey` and
     *   `combinedDescription` are ignored.
     */
    combinedName: z.string().optional().default(''),
    combinedKey: z.string().optional().default(''),
    combinedDescription: z.string().optional().default(''),
    /**
     * @forBindingField bind
     * @order 10
     *
     * - `kind`: The broad cagegory of commands this binding falls under. There should
     *   be no more than 4-5 of these. Each `kind` here should have a corresponding
     *   entry in the top-level `kind` array.
     */
    kind: z.string().optional(),
}).merge(rawBindingCommand).strict();
export type RawBindingItem = z.output<typeof rawBindingItem>;

// a strictBindingItem is satisfied after expanding all default fields
export const bindingCommand = rawBindingCommand.required({ command: true });
export type BindingCommand = z.infer<typeof bindingCommand>;

export const doArgs = bindingCommand.array().refine(
    (xs) => {
        let acceptsInput = 0;
        for (const x of xs) {
            if (INPUT_CAPTURE_COMMANDS.some(i => i === x.command)) {
                acceptsInput = +1;
            }
        }
        return acceptsInput <= 1;
    },
    {
        message:
            '`runCommand` arguments can include only one command that accepts user input.',
    },
);
export type DoArgs = z.infer<typeof doArgs>;

/**
 * @forBindingField bind
 * @order 20
 *
 * ## Finding Commands
 *
 * You can find commands in a few ways:
 *
 * - Find command you want to use from the command palette, and click on the gear (`⚙︎`)
 *   symbol to copy the command string to your clipboard
 * - Review the
 *  [list of built-in commands](https://code.visualstudio.com/api/references/commands/index)
 * - Run the command `Preferences: Open Default Keyboard Shortcuts (JSON)` to get a list of
 *   built-in commands and extension commands already associated with a keybinding
 *
 * Furthermore, you can also use:
 *
 * - [Master Key Commands](/commands/index)
 * - [Selection Utility Commands](https://haberdashpi.github.io/vscode-selection-utilities/)
 *
 * Selection Utilities is a complimentary extension used extensively by the `Larkin` preset.
 *
 * ## Running Multiple Commands
 *
 * When `command` is set to `runCommands`, you can run multiple commands with a signle key
 * press. The`args.commands` list can be:
 *
 * - an array of strings listing the commands
 * - an array of objects with `command`, `args` `computedWhen` and `computedArgs` fields,
 *   defined in the same way as the top-level `bind` fields of the same names are defined.
 *   You cannot have nested calls to `"runCommands"`.
 * - an object with the field `defined` set to a command object defined under a
 *   [`define`](/bindings/define) field.
 *
 * ## Available `when` Contexts
 *
 * Each keybinding can make use of any context defined in VSCode across any extension.
 * Master Key adds the follow contexts:
 *
 * - All variables available in [expression](/expressions/index), prefixed with
 *   `master-key.`
 * - `master-key.keybindingPaletteBindingMode`: true when the suggestion palette accepts
 *   keybinding key presses, false it accepts a string to search the descriptions of said
 *   keybindings
 * - `master-key.keybindingPaletteOpen`: true when the suggestion palette is open
 *
 * ## `foreach` Clauses
 *
 * The `foreach` clause of a keybinding can be used to generate many bindings from one
 * entry. Each field under `foreach` is looped through exhaustively. On each iteration, any
 * string values that contain <code v-pre>{{[var]}}</code> where `[var]` is a `foreach`
 * field, is replaced with that fields value for the given iteration. For example, the
 * following defines 9 bindings:
 *
 * ::: v-pre
 * ```toml
 * [[bind]]
 * foreach.a = [1,2,3]
 * foreach.b = [1,2,3]
 * key = "ctrl+; {{a}} {{b}}"
 * command = "type"
 * args.text = "{{a-b}}"
 * ```
 * :::
 *
 * Furthermore, if the value <code v-pre>{{key: [regex]}}</code> is included in a `foreach`
 * field, it is expanded to all keybindings that match the given regular expression. For
 * example, the following definition is used in `Larkin` to allow the numeric keys to be
 * used as count prefix for motions.
 *
 * ::: v-pre
 * ```toml
 * [[bind]]
 * foreach.num = ['{{key: [0-9]}}']
 * name = "count {{num}}"
 * key = "{{num}}"
 * command = "master-key.updateCount"
 * description = "Add digit {{num}} to the count argument of a command"
 * args.value = "{{num}}"
 * # etc...
 * ```
 * :::
 */

// TODO: the errors are not very informative if we transform the result so early in this
// way; we need to keep this as close as possible to the form in the raw file
export const bindingItem = z.
    object({
        key: bindingKey,
        when: parsedWhen.array(),
        command: z.literal('master-key.do'),
        mode: z.
            string().
            or(z.object({ implicit: z.string() })).
            array().
            optional(),
        prefixes: z.string().array().optional().default(['']),
        args: z.
            object({
                do: doArgs,
                defaults: z.string().optional().default(''),
                hideInPalette: z.boolean().default(false).optional(),
                hideInDocs: z.boolean().default(false).optional(),
                priority: z.number().optional().default(0),
                combinedName: z.string().optional().default(''),
                combinedKey: z.string().optional().default(''),
                combinedDescription: z.string().optional().default(''),
                finalKey: rawBindingItem.shape.finalKey,
                kind: z.string().optional().default(''),
                computedRepeat: z.number().min(0).or(z.string()).default(0),
            }).
            merge(rawBindingItem.pick({ name: true, description: true })),
    }).
    required({ key: true, when: true, args: true }).
    strict();
export type BindingItem = z.output<typeof bindingItem>;

/**
 * @bindingField default
 * @description array that defines structured defaults that apply to keybinding subsets
 *
 * The `default` field describes a series of hierarchical defaults according to a
 * period-delimited set of identifiers.
 *
 * **Example**
 *
 * ```toml
 * [[default]]
 * id = "motion"
 * default.mode = "normal"
 *
 * [[default]]
 * id = "motion.cursor"
 * command = "cursorMove"
 *
 * [[bind]]
 * name = "lines"
 * description = "expand selection to full-line selections"
 * key = "shift+l"
 * command = "expandLineSelection"
 * defaults = "motion"
 * # mode = "normal" (because of the "motion" defaults)
 *
 * [[bind]]
 * key = "l"
 * name = "left"
 * defaults = "motion.cursor"
 * # mode = "normal" (because of the "motion" defaults)
 * # command = "cursorMove" (because of the "motion.cursor" defaults)
 * args.to = "left"
 * ```
 *
 * When you specify the defaults of a keybinding it draws not only from the exact id, but
 * also any of its period-delimited prefixes. Prefixes match when the same set of
 * identifiers in the same order occurs up until the end of the prefix: substrings are not
 * matched. For example `foo.bar.baz` matches `foo.bar` and `foo` but it does not match
 * `foo.ba`. In the above example, `motion.cursor` matches both `motion` and `motion.cursor`
 * path definitions.
 *
 * The following fields are available.
 *
 */

export const bindingDefault = z.object({
    /**
     * @forBindingField default
     *
     * - `id` is a period-delimited set of identifiers that describe this default; each
     *   identifier can include letters, numbers as well as `_` and `-`.
     */
    id: z.string().regex(/(^$|[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*)/),
    /**
     * @forBindingField default
     *
     * - `default`: contains all of the same fields as [`bind`](/bindings/bind),
     * but they are all optional here. These are propagated to any keybindings
     * associated with this default.
     */
    default: rawBindingItem.partial().optional(),
    /**
     * @forBindingField default
     *
     * - `appendWhen`: this when clause is appended to the when clause of all associated
     *   keybindings using `(when) && (appendWhen)`, and must therefore be true for any
     *   associated keybindings to trigger.
     */
    appendWhen: z.
        string().
        optional().
        transform(parseWhen).
        pipe(parsedWhen.array().optional()),
}).strict();

/**
 * @bindingField mode
 * @description array describing behavior of keybinding modes
 *
 * The `mode` element defines a distinct keybinding mode. Like vim modes, they affect which
 * keybindings are currently active.
 *
 * **Example**
 *
 * ```toml
 * [[mode]]
 * name = "normal"
 * default = true
 * cursorShape = "Block"
 * highlight = "Highlight"
 *
 * [[mode]]
 * name = "insert"
 * cursorShape = "Line"
 * highlight = "NoHighlight"
 * recordEdits = true
 * ```
 *
 * ## Fields
 *
 * The only required field for a mode is its name (marked with "*") but there are a number
 * of optional fields that impact the behavior of the mode.
 */
const modeSpec = z.object({
    /**
     * @forBindingField mode
     *
     * - `name`*: The name of the mode; displayed in the bottom left corner of VSCode
     */
    name: z.string(),

    /**
     * @forBindingField mode
     *
     * - `default`: whether this mode is the default when the editor is opened. There should
     *   only be one default mode.
     */
    default: z.boolean().optional().default(false),
    /**
     * @forBindingField mode
     *
     * - `highlight`: Whether and how to highlight the name of this mode in the bottom left
     *   corner of VSCode. Possible values are:
     *     - `NoHighlight` does not add coloring
     *     - `Highlight` adds warning related colors (usually orange)
     *     - `Alert` adds error related colors (usually red)
     */
    highlight: z.enum(['NoHighlight', 'Highlight', 'Alert']).default('NoHighlight'),
    /**
     * @forBindingField mode
     *
     * - `recordEdits`: Whether the changes to the text should be recorded instead of any
     *   commands that get executed. Modes that issue commands (e.g. vim-like `Normal` mode)
     *   should set this to `false` and modes that do not (e.g. vim-like `Insert` mode)
     *   should set this to `true`.
     */
    recordEdits: z.boolean().optional().default(false),
    /**
     * @forBindingField mode
     *
     * - `cursorShape`: The shape of the cursor when in this mode. One of the following:
     *   - `Line`
     *   - `Block`
     *   - `Underline`
     *   - `LineThin`
     *   - `BlockOutline`
     *   - `UnderlineThin`
     */
    cursorShape: z.
        enum(['Line', 'Block', 'Underline', 'LineThin', 'BlockOutline', 'UnderlineThin']).
        default('Line'),
    /**
     * @forBindingField mode
     *
     * - `onType`: A command to execute when typing keys that have no associated binding;
     *   see the [section below](#ontype-field) for details.
     */
    onType: doArgs.optional(),
    fallbackBindings: z.string().optional().default(''),
});

/**
 * @forBindingField mode
 *
 * ### `onType` Field
 *
 * The `onType` field has the following subfields:
 *
 * - `command`: The command to execute
 * - `args`: The commands arguments
 * - `computedArgs`: Command arguments evaluated as [expressions](/expressions/index).
 * - `whenComputed`: if present and this expression evaluates to false, the command is not
 *   executed
 *
 * While evaluating expressions `captured` is set to the key which got typed.
 *
 * **Example**: Symmetric insert mode (in `Larkin` keybindings) includes the following
 * definition so that typed characters are inserted on both sides of a selection.
 *
 * ```toml
 * [[mode]]
 * name = "syminsert"
 * highlight = "Highlight"
 * cursorShape = "BlockOutline"
 *
 * [[mode.onType]]
 * command = "selection-utilities.insertAround"
 * computedArgs.before = "braces[captured].before || captured"
 * computedArgs.after = "braces[captured].after || captured"
 * args.followCursor = true
 * ```
 */

export type ModeSpec = z.output<typeof modeSpec>;

/**
 * @bindingField kind
 * @description array that documents broad categories of keys.
 *
 * Each binding key can be associated with a `kind`. This shows up as a distinct color in
 * the visual documentation. Mousing over a key also displays a description associated with
 * its kind. It has two fields:
 */

const kindItem = z.
    object({
        /**
         * @forBindingField kind
         *
         * - `name`: A string identify the kind.
         */
        name: z.string(),
        /**
         * @forBindingField kind
         *
         * - `description`: A longer (1-2 sentence) description of the kind.
         */
        description: z.string(),
    }).
    strict();
export type KindItem = z.output<typeof kindItem>;
/**
 * @forBindingField kind
 *
 * These two fields are displayed as part of the visual documentation for key kinds.
 *
 * **Example**
 *
 * ```toml
 * [[kind]]
 * name = "action"
 *
 * [[kind]]
 * name = "motion"
 *
 * [[bind]]
 * kind = "action"
 * key = "d"
 * command = "deleteLeft"
 *
 * [[bind]]
 * kind = "motion"
 * key = "l"
 * command = "cursorLeft"
 * ```
 */

export const bindingSpec = z.
    object({
        header: bindingHeader,
        bind: rawBindingItem.array(),
        kind: kindItem.array().optional(),
        default: bindingDefault.
            array().
            refine(xs => uniqBy(xs, x => x.id).length === xs.length, {
                message: 'Defined [[defaults]] entries must all have unique \'id\' fields.',
            }).
            optional().
            default([]),
        mode: modeSpec.
            array().
            optional().
            default([
                {
                    name: 'default',
                    default: true,
                    recordEdits: true,
                    cursorShape: 'Line',
                    highlight: 'NoHighlight',
                },
            ]).
            refine(
                (xs) => {
                    return uniqBy(xs, x => x.name).length === xs.length;
                },
                { message: 'All mode names must be unique!' },
            ).
            refine(
                (xs) => {
                    const defaults = xs.filter(x => x.default);
                    return defaults.length === 1;
                },
                { message: 'There must be one and only one default mode' },
            ).
            transform((xs) => {
                const captureMode = xs.filter(x => x.name === 'capture');
                if (captureMode.length === 0) {
                    return xs.concat({
                        name: 'capture',
                        cursorShape: 'Underline',
                        default: false,
                        recordEdits: false,
                        highlight: 'Highlight',
                        fallbackBindings: '',
                    });
                }
                return xs;
            }),
        /**
         * @bindingField define
         * @description object of arbitrary fields which can be used in computed arguments.
         *
         * The `define` field accepts an arbitrary set of key-value pairs
         * that can be referenced inside an [expression](/expressions/index)
         * or a call to "runCommands".
         *
         * **Examples**
         *
         * A common command pattern in Larkin is to allow multiple lines to be
         * selected using a count followed by the operation to perfrom on those lines.
         * The line selection is defined as follows
         *
         * ```toml
         * [[define.selectLinesDown]]
         * command = "selection-utilities.shrinkToActive"
         *
         * [[define.selectLinesDown]]
         * whenComputed = "count"
         * command = "cursorMove"
         * args = { to = "down", by = "wrappedLine", select = true }
         * computedArgs = { value = "count" }
         *
         * [[define.selectLinesDown]]
         * command = "expandLineSelection"
         * ```
         *
         * And use of this definition is as follows
         *
         * ```toml
         * [[bind]]
         * defaults = "edit.action.basic"
         * key = "c"
         * when = "!editorHasSelection && master-key.count > 1"
         * command = "runCommands"
         * args.commands = [
         *       { defined = "selectLinesDown" },
         *       "deleteRight",
         *       "editor.action.insertLineBefore",
         *       "master-key.enterInsert",
         * ]
         * ```
         *
         * To handle symmetric insert of brackets, Larkin uses the following definition
         *
         * ```toml
         * [define.braces]
         *
         * "{".before = "{"
         * "{".after = "}"
         * "}".before = "{"
         * "}".after = "}"
         *
         * "[".before = "["
         * "[".after = "]"
         * "]".before = "["
         * "]".after = "]"
         *
         * "(".before = "("
         * "(".after = ")"
         * ")".before = "("
         * ")".after = ")"
         *
         * "<".before = "<"
         * "<".after = ">"
         * ">".before = "<"
         * ">".after = ">"
         * ```
         *
         * This is then applied when handling symmetric typing using the
         * [`onType`](/bindings/mode#ontype-field) field of `[[mode]]`.
         *
         * ```toml
         * [[mode]]
         * name = "syminsert"
         * highlight = "Highlight"
         * cursorShape = "BlockOutline"
         *
         * [[mode.onType]]
         * command = "selection-utilities.insertAround"
         * computedArgs.before = "braces[captured].before || captured"
         * computedArgs.after = "braces[captured].after || captured"
         * args.followCursor = true
         * ```
         */
        define: z.record(z.string(), z.any()).optional().default({}),
    }).

    strict();
export type BindingSpec = z.infer<typeof bindingSpec>;

export type FullBindingSpec = BindingSpec & {
    doc?: IParsedBindingDoc[];
};

export interface SuccessResult<T> {
    success: true;
    data: T;
}
export interface ErrorResult {
    success: false;
    error: ZodError;
}
export type ParsedResult<T> = SuccessResult<T> | ErrorResult;

function parseBindingsHelper(
    text: string,
    data: BindingSpec,
): ParsedResult<FullBindingSpec> {
    const doc = parseBindingDocs(text);
    if (doc.success) {
        return { success: true, data: { ...data, doc: doc.data?.doc } };
    } else {
        return <ParsedResult<FullBindingSpec>>doc;
    }
}

export async function parseBindings(text: string): Promise<ParsedResult<FullBindingSpec>> {
    const toml = (await TOML).parse(text);
    const data = bindingSpec.safeParse(toml);
    if (data.success) {
        return parseBindingsHelper(text, data.data);
    } else {
        const legacyParsing = legacyParse(toml);
        if (legacyParsing.success) {
            const legacyData = bindingSpec.safeParse(legacyParsing.data);
            if (legacyData.success) {
                vscode.window.
                    showWarningMessage(
                        'Your Master Key bindings use a legacy keybinding format. ' +
                        'Consider re-activating your desired preset and any user ' +
                        'bindings. You will need to update your user bindings according ' +
                        'to the documentation.',
                        'Open Docs',
                    ).
                    then(async (request) => {
                        if (request === 'Open Docs') {
                            await vscode.env.openExternal(
                                vscode.Uri.parse(
                                    'https://haberdashpi.github.io/vscode-master-key/',
                                ),
                            );
                        }
                    });
                return parseBindingsHelper(text, legacyData.data);
            }
        }
    }
    return <ParsedResult<FullBindingSpec>>data;
}

export async function parseBindingFile(file: vscode.Uri) {
    const fileData = await vscode.workspace.fs.readFile(file);
    const fileText = new TextDecoder().decode(fileData);
    return parseBindings(fileText);
}

export interface IConfigKeyBinding {
    key: string;
    command: 'master-key.do';
    prefixDescriptions: string[];
    when: string;
    args: {
        do: DoArgs;
        key: string; // repeated here so that commands can display the key pressed
        name?: string;
        description?: string;
        finalKey?: boolean;
        hideInPalette?: boolean;
        hideInDocs?: boolean;
        priority: number;
        combinedName: string;
        combinedKey: string;
        combinedDescription: string;
        kind: string;
        defaults: string;
        mode: string | undefined;
        prefixCode: number | undefined;
    };
}
