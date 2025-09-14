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

const rawBindingCommand = z.
    object({
        command: z.string().optional(), // only optional before default expansion
        args: z.any(),
        computedArgs: z.object({}).passthrough().optional(),
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
    key: z.string().optional(),
    when: z.
        union([z.string(), z.string().array()]).
        optional().
        transform(parseWhen).
        pipe(parsedWhen.array()),
    mode: z.union([z.string(), z.string().array()]).optional(),
    priority: z.number().default(0).optional(),
    defaults: z.string().optional(),
    foreach: z.record(z.string(), z.array(z.string())).optional(),
    prefixes: z.
        preprocess(
            x => (x === '{{all_prefixes}}' ? [] : x),
            bindingKey.or(z.string().length(0)).array(),
        ).
        optional(),
    finalKey: z.boolean().optional(),
    computedRepeat: z.number().min(0).or(z.string()).default(0).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    hideInPalette: z.boolean().default(false).optional(),
    hideInDocs: z.boolean().default(false).optional(),
    combinedName: z.string().optional().default(''),
    combinedKey: z.string().optional().default(''),
    combinedDescription: z.string().optional().default(''),
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


export const bindingDefault = z.object({
    id: z.string().regex(/(^$|[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*)/),
    default: rawBindingItem.partial().optional(),
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
