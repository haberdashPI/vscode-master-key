import * as vscode from 'vscode';
import jsep from 'jsep';
import JSONC from 'jsonc-parser';
import { Utils } from 'vscode-uri';
const TOML = require("smol-toml");
import YAML from 'yaml';
import * as semver from 'semver';
import z, { ZodIssue } from "zod";
import { ZodError, fromZodError, fromZodIssue } from 'zod-validation-error';
import { expressionId } from '../expressions';
import { uniqBy } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
export const INPUT_CAPTURE_COMMANDS = ['captureKeys', 'replaceChar', 'insertChar', 'search'];

const bindingHeader = z.object({
    version: z.string().
        refine(x => semver.coerce(x), { message: "header.version is not a valid version number" }).
        refine(x => semver.satisfies(semver.coerce(x)!, '1'),
               { message: "header.version is not a supported version number (must a compatible with 1.0)"}),
    requiredExtensions: z.string().array().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
}).strict();
type BindingHeader = z.infer<typeof bindingHeader>;

const rawBindingCommand = z.object({
    command: z.string().optional(), // only optional before default expansion
    args: z.any(),
    computedArgs: z.object({}).passthrough().optional(),
    if: z.string().or(z.boolean()).default(true).optional(),
}).strict();
export type RawBindingCommand = z.infer<typeof rawBindingCommand>;

const definedCommand = z.object({ defined: z.string() }).strict();
export type DefinedCommand = z.infer<typeof definedCommand>;

const ALLOWED_MODIFIERS = /Ctrl|Shift|Alt|Cmd|Win|Meta/i;
const ALLOWED_KEYS = [
    /f[1-9]/i, /f1[0-9]/i, /[a-z]/, /[0-9]/,
    /`/, /-/, /=/, /\[/, /\]/, /\\/, /;/, /'/, /,/, /\./, /\//,
    /left/i, /up/i, /right/i, /down/i, /pageup/i, /pagedown/i, /end/i, /home/i,
    /tab/i, /enter/i, /escape/i, /space/i, /backspace/i, /delete/i,
    /pausebreak/i, /capslock/i, /insert/i,
    /numpad[0-9]/i, /numpad_multiply/i, /numpad_add/i, /numpad_separator/i,
    /numpad_subtract/i, /numpad_decimal/i, /numpad_divide/i,
    // layout independent versions
    /\[f[1-9]\]/i, /\[f1[0-9]\]/i, /\[Key[A-Z]\]/i, /\[Digit[0-9]\]/i, /\[Numpad[0-9]\]/i,
    /\[Backquote\]/, /\[Minus\]/, /\[Equal\]/, /\[BracketLeft\]/, /\[BracketRight\]/,
    /\[Backslash\]/, /\[Semicolon\]/, /\[Quote\]/, /\[Comma\]/, /\[Period\]/, /\[Slash\]/,
    /\[ArrowLeft\]/, /\[ArrowUp\]/, /\[ArrowRight\]/, /\[ArrowDown\]/, /\[PageUp\]/,
    /\[PageDown\]/, /\[End\]/, /\[Home\]/, /\[Tab\]/, /\[Enter\]/, /\[Escape\]/, /\[Space\]/,
    /\[Backspace\]/, /\[Delete\]/, /\[Pause\]/, /\[CapsLock\]/, /\[Insert\]/,
    /\[NumpadMultiply\]/, /\[NumpadAdd\]/, /\[NumpadComma\]/, /\[NumpadSubtract\]/,
    /\[NumpadDecimal\]/, /\[NumpadDivide\]/,
];

function fullMatch(x: string, ex: RegExp){
    let m = x.match(ex);
    if(m === null){ return false; }
    return m[0].length === x.length;
}

function isAllowedKeybinding(key: string){
    for(let press of key.split(/\s+/)){
        let modsAndPress = press.split("+");
        for(let mod of modsAndPress.slice(0, -1)){
            if(!ALLOWED_MODIFIERS.test(mod)){ return false; }
        }
        let unmodPress = modsAndPress[modsAndPress.length-1];
        if(ALLOWED_KEYS.every(a => !fullMatch(unmodPress, a))){ return false; }
    }
    return true;
}

export async function showParseError(prefix: string, error: ZodError | ZodIssue){
    let suffix = "";
    if((<ZodIssue>error).code === undefined){ // code is always defined on issues and undefined on errors
        suffix = fromZodError(<ZodError>error).message;
    }else{
        suffix = fromZodIssue(<ZodIssue>error).message;
    }
    var buttonPattern = /\s+\{button:\s*"(.+)(?<!\\)",\s*link:(.+)\}/;
    let match = suffix.match(buttonPattern);
    if(match !== null && match.index !== undefined && match[1] !== undefined &&
       match[2] !== undefined){
        suffix = suffix.slice(0, match.index) + suffix.slice(match.index + match[0].length, -1);
        let button = match[1];
        let link = match[2];
        let pressed = await vscode.window.showErrorMessage(prefix + suffix, button);
        if(button === pressed){
            vscode.env.openExternal(vscode.Uri.parse(link));
        }
    }else{
        vscode.window.showErrorMessage(prefix + suffix);
    }
}

function keybindingError(arg: string){
    return {
        message: `Invalid keybinding '${arg}'. Tip: capital letters are represented
        using e.g. "shift+a". {button: "Keybinding Docs",
        link:https://code.visualstudio.com/docs/getstarted/keybindings#_accepted-keys}`
    };
}
const bindingKey = z.string().refine(isAllowedKeybinding, keybindingError).
    transform((x: string) => x.toLowerCase());


function prefixError(arg: string){
    return {
        message: `Expected either an array of kebydinings or the string '<all-prefixes>',
        but got '${arg}' instead`
    };
}

const parsedWhen = z.object({
    str: z.string(),
    id: z.string()
});
export type ParsedWhen = z.infer<typeof parsedWhen>;

export function parseWhen(when_: string | string[] | undefined): ParsedWhen[] {
    let when = when_ === undefined ? [] : !Array.isArray(when_) ? [when_] : when_;
    return when.map(w => {
        w = replaceAll(w, /editorTextFocus/g, "(editorTextFocus || master-key.keybindingPaletteBindingMode)");
        // let p = jsep(w);
        return { str: w, id: expressionId(w) };
    });
}

export const vscodeBinding = z.object({
    key: bindingKey,
    command: z.string(),
    args: z.object({}).optional(),
    when: z.string().optional()
});

export const rawBindingItem = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    hideInPalette: z.boolean().default(false).optional(),
    combinedName: z.string().optional().default(""),
    combinedKey: z.string().optional().default(""),
    combinedDescription: z.string().optional().default(""),
    path: z.string().optional(),
    priority: z.number().default(0).optional(),
    kind: z.string().optional(),
    key: z.string().optional(),
    foreach: z.record(z.string(), z.array(z.string())).optional(),
    when: z.union([z.string(), z.string().array()]).optional().
        transform(parseWhen).
        pipe(parsedWhen.array()),
    mode: z.union([z.string(), z.string().array()]).optional(),
    prefixes: z.preprocess(x => x === "<all-prefixes>" ? [] : x,
        bindingKey.or(z.string().length(0)).array()).optional(),
    resetTransient: z.boolean().optional(),
    repeat: z.number().min(0).or(z.string()).default(0).optional()
}).merge(rawBindingCommand).strict();
export type RawBindingItem = z.output<typeof rawBindingItem>;

// a strictBindingItem is satisfied after expanding all default fields
export const bindingCommand = rawBindingCommand.required({command: true});
export type BindingCommand = z.infer<typeof bindingCommand>;

export const doArgs = bindingCommand.array().refine(xs => {
    let acceptsInput = 0;
    for(let x of xs){
        if(INPUT_CAPTURE_COMMANDS.some(i => i === x.command)){ acceptsInput =+ 1; }
    }
    return acceptsInput <= 1;
}, { message: "`runCommand` arguments can include only one command that accepts user input."});
export type DoArgs = z.infer<typeof doArgs>;

// TODO: the errors are not very informative if we transform the result so early in this
// way; we need to keep this as close as possible to the form in the raw file
export const bindingItem = z.object({
    key: bindingKey,
    when: parsedWhen.array(),
    command: z.literal("master-key.do"),
    mode: z.string().array().optional(),
    prefixes: z.string().array().optional().default([""]),
    args: z.object({
        do: doArgs,
        path: z.string().optional().default(""),
        hideInPalette: z.boolean().default(false).optional(),
        priority: z.number().optional().default(0),
        combinedName: z.string().optional().default(""),
        combinedKey: z.string().optional().default(""),
        combinedDescription: z.string().optional().default(""),
        resetTransient: rawBindingItem.shape.resetTransient,
        kind: z.string().optional().default(""),
        repeat: z.number().min(0).or(z.string()).default(0)
    }).merge(rawBindingItem.pick({name: true, description: true}))
}).required({key: true, when: true, args: true}).strict();
export type BindingItem = z.output<typeof bindingItem>;

export const bindingPath = z.object({
    // TODO: change from an empty `id` path, to fields at the top level in the header
    id: z.string().regex(/(^$|[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9_\-]+)*)/),
    name: z.string(),
    description: z.string().optional(),
    default: rawBindingItem.partial().optional(),
    when: z.string().optional().transform(parseWhen).pipe(parsedWhen.array().optional())
});

// TODO: implement processing step
const modeSpec = z.object({
    name: z.string(),
    default: z.boolean().optional().default(false),
    highlight: z.enum(["NoHighlight", "Highlight", "Alert"]).default('NoHighlight'),
    cursorShape: z.enum(["Line", "Block", "Underline", "LineThin", "BlockOutline", "UnderlineThin"]).default('Line'),
});
export type ModeSpec = z.output<typeof modeSpec>;

export const bindingSpec = z.object({
    header: bindingHeader,
    bind: rawBindingItem.array(),
    path: bindingPath.array().refine(xs => uniqBy(xs, x => x.id).length === xs.length,
        { message: "Defined [[path]] entries must all have unique 'id' fields."}).
        optional().default([]),
    mode: modeSpec.array().optional().default([{name: 'default', default: true, cursorShape: 'Line', highlight: 'NoHighlight'}]).refine(xs => {
        return uniqBy(xs, x => x.name).length === xs.length;
    }, { message: "All mode names must be unique!" }).refine(xs => {
        let defaults = xs.filter(x => x.default);
        return defaults.length === 1;
    }, { message: "There must be one and only one default mode" }).transform(xs => {
        let captureMode = xs.filter(x => x.name === 'capture');
        if(captureMode.length === 0){
            return xs.concat({name: "capture", cursorShape: "Underline", default: false, highlight: "Highlight"});
        }
        return xs;
    }),
    define: z.object({}).passthrough().optional()
}).strict();
export type BindingSpec = z.infer<typeof bindingSpec>;

export function parseBindings<T>(text: string, parse: string | ((data: string) => unknown)){
    if(typeof parse === 'string'){
        let ext = parse.toLowerCase();
        let match = ext.match(/^\.(.+)$/);
        if(match){ ext = match[1]; }
        if(ext === 'json' || ext === 'jsonc'){ return parseBindings(text, JSONC.parse); }
        else if(ext === 'yaml' || ext === 'yml'){ return parseBindings(text, YAML.parse); }
        else if(ext === 'toml' ){ return parseBindings(text, TOML.parse); }
        else{
            throw new Error("Unexpected file extension: "+ext);
        }
    }else{
        return bindingSpec.safeParse(parse(text));
    }
}

export async function parseBindingFile(file: vscode.Uri){
    let fileData = await vscode.workspace.fs.readFile(file);
    let fileText = new TextDecoder().decode(fileData);
    let ext = Utils.extname(file);
    return parseBindings(fileText, ext);
}
