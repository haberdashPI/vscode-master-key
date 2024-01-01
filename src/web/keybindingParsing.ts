import * as vscode from 'vscode';
import jsep from 'jsep';
const TOML = require("smol-toml");
import * as semver from 'semver';
import { TextDecoder } from 'text-encoding';
import { ZodIssue, z } from "zod";
import { ZodError, fromZodError, fromZodIssue } from 'zod-validation-error';
import { expressionId } from './expressions';
export const INPUT_CAPTURE_COMMANDS = ['captureKeys', 'replaceChar', 'insertChar', 'search'];

let decoder = new TextDecoder("utf-8");

const bindingHeader = z.object({
    version: z.string().
        refine(x => semver.coerce(x), { message: "header.version is not a valid version number" }).
        refine(x => semver.satisfies(semver.coerce(x)!, '1'), 
               { message: "header.version is not a supported version number (must a compatible with 1.0)"}),
    requiredExtensions: z.string().array()
});
type BindingHeader = z.infer<typeof bindingHeader>;

const rawBindingCommand = z.object({
    command: z.string().optional(), // only optional before default expansion
    args: z.object({}).passthrough().optional(),
    computedArgs: z.object({}).passthrough().optional(),
    if: z.string().or(z.boolean()).default(true).optional()
}).strict();
export type RawBindingCommand = z.infer<typeof rawBindingCommand>;

const definedCommand = z.object({ defined: z.string() }).strict();
export type DefinedCommand = z.infer<typeof definedCommand>;

const ALLOWED_MODIFIERS = /Ctrl|Shift|Alt|Cmd|Win|Meta/i;
const ALLOWED_KEYS = [
    /<all-keys>/, /(f[1-9])|(f1[0-9])/i, /[a-z]/, /[0-9]/,
    /`/, /-/, /=/, /\[/, /\]/, /\\/, /;/, /'/, /,/, /\./, /\//,
    /left/i, /up/i, /right/i, /down/i, /pageup/i, /pagedown/i, /end/i, /home/i,
    /tab/i, /enter/i, /escape/i, /space/i, /backspace/i, /delete/i,
    /pausebreak/i, /capslock/i, /insert/i,
    /numpad[0-9]/i, /numpad_multiply/i, /numpad_add/i, /numpad_separator/i,
    /numpad_subtract/i, /numpad_decimal/i, /numpad_divide/i,
    // layout independent versions
    /(\[f[1-9]\])|(\[f1[0-9]\])/i, /\[Key[A-Z]\]/i, /\[Digit[0-9]\]/i, /\[Numpad[0-9]\]/i,
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
    try{
        return when.map(w => {
            let p = jsep(w);
            return { str: w, id: expressionId(w) };
        });
    }catch(e){
        if(e instanceof Error){
            vscode.window.showErrorMessage(`Exception while parsing ${when}: ${e.message}`);
        }else{
            throw e;
        }
    }
    return [];
}

export const rawBindingItem = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    path: z.string(),
    kind: z.string().optional(),
    key: z.union([bindingKey, bindingKey.array()]).optional(),
    when: z.union([z.string(), z.string().array()]).optional().
        transform(parseWhen).
        pipe(parsedWhen.array()),
    mode: z.union([z.string(), z.string().array()]).optional(),
    prefixes: z.preprocess(x => x === "<all-prefixes>" ? [] : x,
        z.string().array()).optional(),
    resetTransient: z.boolean().default(true).optional()
}).merge(bindingCommand).strict();
export type BindingItem = z.output<typeof rawBindingItem>;

// a strictBindingItem is satisfied after expanding all default fields
export const strictBindingCommand = bindingCommand.required({command: true});
export type StrictBindingCommand = z.infer<typeof strictBindingCommand>;

export const doArgs = strictBindingCommand.array().refine(xs => {
    let acceptsInput = 0;
    for(let x of xs){
        let cmd = (<BindingCommand>x).command;
        if(INPUT_CAPTURE_COMMANDS.some(i => i === cmd)){ acceptsInput =+ 1; }
    }
    return acceptsInput <= 1;
}, { message: "`runCommand` arguments can include only one command that accepts user input."})

export const bindingItem = z.object({
    key: rawBindingItem.shape.key,
    when: parsedWhen.array(),
    command: z.literal("master-key.do"),
    mode: rawBindingItem.shape.mode,
    prefixes: z.string().array(),
    args: z.object({
        do: doArgs,
        path: z.string(),
    }).merge(rawBindingItem.pick({name: true, description: true, kind: true, 
        resetTransient: true}))
}).required({
    key: true,
    kind: true
});

export const bindingPath = z.object({
    for: z.string().regex(/[a-ZA-Z0-9_-]+(\.[a-ZA-Z0-9_-]+)*/),
    name: z.string(),
    description: z.string(),
    default: bindingItem,
});

function contains(xs: string[], el: string){
    return xs.some(x => x === el);
}
export const validModes = z.string().array().
    refine(x => contains(x, 'insert') && contains(x, 'capture'), ms => {
        let modes = ms.join(', ');
        return { message: `The modes 'insert' and 'capture' are required, but the 
                 only valid modes listed modes were: ` + modes };
    });

export const bindingSpec = z.object({
    header: bindingHeader,
    bind: bindingItem.array(),
    paths: bindingPath.array(),
    define: z.object({ validModes: validModes }).passthrough().optional()
});
export type BindingSpec = z.infer<typeof bindingSpec>;

export async function parseBindingFile(file: vscode.Uri){
    let fileData = await vscode.workspace.fs.readFile(file);
    let fileText = decoder.decode(fileData);
    if(file.fsPath.endsWith(".json")){
        return bindingSpec.safeParse(JSON.parse(fileText));
    }else{
        return bindingSpec.safeParse(TOML.parse(fileText));
    }
}
