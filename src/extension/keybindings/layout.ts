import replaceAll from 'string.prototype.replaceall';
import { IConfigKeyBinding } from '../keybindings/parsing';

// linting disabled for legibility of an unusual constant
/* eslint-disable */
export const LI_KEY_TO_KEY = {
    "\\[F1\\]": "f1", "\\[F2\\]": "f2", "\\[F3\\]": "f3", "\\[F4\\]": "f4", "\\[F5\\]": "f5", "\\[F6\\]": "f6",
    "\\[F7\\]": "f7", "\\[F8\\]": "f8", "\\[F9\\]": "f9", "\\[F10\\]": "f10", "\\[F11\\]": "f11",
    "\\[F12\\]": "f12", "\\[F13\\]": "f13", "\\[F14\\]": "f14", "\\[F15\\]": "f15", "\\[F16\\]": "f16",
    "\\[F17\\]": "f17", "\\[F18\\]": "f18", "\\[F19\\]": "f19",
    "\\[KeyA\\]": "a", "\\[KeyB\\]": "b", "\\[KeyC\\]": "c", "\\[KeyD\\]": "d", "\\[KeyE\\]": "e",
    "\\[KeyF\\]": "f", "\\[KeyG\\]": "g", "\\[KeyH\\]": "h", "\\[KeyI\\]": "i", "\\[KeyJ\\]": "j",
    "\\[KeyK\\]": "k", "\\[KeyL\\]": "l", "\\[KeyM\\]": "m", "\\[KeyN\\]": "n", "\\[KeyO\\]": "o",
    "\\[KeyP\\]": "p", "\\[KeyQ\\]": "q", "\\[KeyR\\]": "r", "\\[KeyS\\]": "s", "\\[KeyT\\]": "t",
    "\\[KeyU\\]": "u", "\\[KeyV\\]": "v", "\\[KeyW\\]": "w", "\\[KeyX\\]": "x", "\\[KeyY\\]": "y",
    "\\[KeyZ\\]": "z",
    "\\[Digit0\\]": "0", "\\[Digit1\\]": "1", "\\[Digit2\\]": "2", "\\[Digit3\\]": "3",
    "\\[Digit4\\]": "4", "\\[Digit5\\]": "5", "\\[Digit6\\]": "6", "\\[Digit7\\]": "7",
    "\\[Digit8\\]": "8", "\\[Digit9\\]": "9",
    "\\[Backquote\\]": "`", "\\[Minus\\]": "-", "\\[Equal\\]": "=", "\\[BracketLeft\\]": "\[",
    "\\[BracketRight\\]": "]", "\\[Backslash\\]": "\\", "\\[Semicolon\\]": ";", "\\[Quote\\]": "'",
    "\\[Comma\\]": ",", "\\[Period\\]": ".", "\\[Slash\\]": "/",
    "\\[ArrowLeft\\]": "left", "\\[ArrowUp\\]": "up", "\\[ArrowRight\\]": "right",
    "\\[ArrowDown\\]": "down",
    "\\[PageUp\\]": "pageup", "\\[PageDown\\]": "pagedown", "\\[End\\]": "end", "\\[Home\\]": "home",
    "\\[Tab\\]": "tab", "\\[Enter\\]": "enter", "\\[Escape\\]": "escape", "\\[Space\\]": "space",
    "\\[Backspace\\]": "backspace", "\\[Delete\\]": "delete", "\\[Pause\\]": "pause",
    "\\[CapsLock\\]": "capslock", "\\[Insert\\]": "insert",
    "\\[Numpad0\\]": "numpad0", "\\[Numpad1\\]": "numpad1", "\\[Numpad2\\]": "numpad2",
    "\\[Numpad3\\]": "numpad3", "\\[Numpad4\\]": "numpad4", "\\[Numpad5\\]": "numpad5",
    "\\[Numpad6\\]": "numpad6", "\\[Numpad7\\]": "numpad7", "\\[Numpad8\\]": "numpad8",
    "\\[Numpad9\\]": "numpad9",
    "\\[NumpadMultiply\\]": "numpad_multiply", "\\[NumpadAdd\\]": "numpad_add",
    "\\[NumpadComma\\]": "numpad_separator", "\\[NumpadSubtract\\]": "numpad_subtract",
    "\\[NumpadDecimal\\]": "numpad_decimal", "\\[NumpadDivide\\]": "numpad_divide",
}
/* eslint-enable */

// linting disabled for legibility of an unusual constant
/* eslint-disable */
export const KEY_TO_LI_KEY = {
    "f1": "[F1]", "f2": "[F2]", "f3": "[F3]", "f4": "[F4]", "f5": "[F5]", "f6": "[F6]",
    "f7": "[F7]", "f8": "[F8]", "f9": "[F9]", "f10": "[F10]", "f11": "[F11]",
    "f12": "[F12]", "f13": "[F13]", "f14": "[F14]", "f15": "[F15]", "f16": "[F16]",
    "f17": "[F17]", "f18": "[F18]", "f19": "[F19]",
    "a": "[KeyA]", "b": "[KeyB]", "c": "[KeyC]", "d": "[KeyD]", "e": "[KeyE]",
    "f": "[KeyF]", "g": "[KeyG]", "h": "[KeyH]", "i": "[KeyI]", "j": "[KeyJ]",
    "k": "[KeyK]", "l": "[KeyL]", "m": "[KeyM]", "n": "[KeyN]", "o": "[KeyO]",
    "p": "[KeyP]", "q": "[KeyQ]", "r": "[KeyR]", "s": "[KeyS]", "t": "[KeyT]",
    "u": "[KeyU]", "v": "[KeyV]", "w": "[KeyW]", "x": "[KeyX]", "y": "[KeyY]",
    "z": "[KeyZ]",
    "0": "[Digit0]", "1": "[Digit1]", "2": "[Digit2]", "3": "[Digit3]",
    "4": "[Digit4]", "5": "[Digit5]", "6": "[Digit6]", "7": "[Digit7]",
    "8": "[Digit8]", "9": "[Digit9]",
    "`": "[Backquote]", "-": "[Minus]", "=": "[Equal]", "\\[": "[BracketLeft]",
    "\\]": "[BracketRight]", "\\\\": "[Backslash]", ";": "[Semicolon]", "'": "[Quote]",
    ",": "[Comma]", "\\.": "[Period]", "/": "[Slash]",
    "left": "[ArrowLeft]", "up": "[ArrowUp]", "right": "[ArrowRight]",
    "down": "[ArrowDown]",
    "pageup": "[PageUp]", "pagedown": "[PageDown]", "end": "[End]", "home": "[Home]",
    "tab": "[Tab]", "enter": "[Enter]", "escape": "[Escape]", "space": "[Space]",
    "backspace": "[Backspace]", "delete": "[Delete]", "pause": "[Pause]",
    "capslock": "[CapsLock]", "insert": "[Insert]",
    "numpad0": "[Numpad0]", "numpad1": "[Numpad1]", "numpad2": "[Numpad2]",
    "numpad3": "[Numpad3]", "numpad4": "[Numpad4]", "numpad5": "[Numpad5]",
    "numpad6": "[Numpad6]", "numpad7": "[Numpad7]", "numpad8": "[Numpad8]",
    "numpad9": "[Numpad9]",
    "numpad_multiply": "[NumpadMultiply]", "numpad_add": "[NumpadAdd]",
    "numpad_separator": "[NumpadComma]", "numpad_subtract": "[NumpadSubtract]",
    "numpad_decimal": "[NumpadDecimal]", "numpad_divide": "[NumpadDivide]",
}
/* eslint-enable */

export function normalizeLayoutIndependentBindings(
    curBindings: IConfigKeyBinding[],
    opts: { noBrackets: boolean } = { noBrackets: false },
): IConfigKeyBinding[] {
    return curBindings.map((b) => {
        const key = normalizeLayoutIndependentString(b.args.key, opts);
        return { ...b, args: { ...b.args, key } };
    });
}

export function toLayoutIndependentString(key: string) {
    for (const [fromKey, toLiKey] of Object.entries(KEY_TO_LI_KEY)) {
        key = replaceAll(
            key,
            RegExp('(?<![a-z0-9])' + fromKey + '(?![a-z0-9])', 'ig'),
            toLiKey,
        );
    }
    return key;
}

export function normalizeLayoutIndependentString(
    key: string,
    opts: { noBrackets: boolean } = { noBrackets: false },
) {
    for (const [liKey, toKey] of Object.entries(LI_KEY_TO_KEY)) {
        if (opts.noBrackets) {
            key = replaceAll(key, RegExp(liKey, 'ig'), toKey);
        } else {
            key = replaceAll(key, RegExp(liKey, 'ig'), '[' + toKey + ']');
        }
    }
    return key;
}
