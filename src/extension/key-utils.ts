import replaceAll from 'string.prototype.replaceall';

// splits out the modifier key
export function modifierKey(str: string) {
    if (str.match(/\+/)) {
        return str.
            split('+').
            slice(0, -1).
            map(x => prettifyPrefix(x));
    }
    return [''];
}

export function prettifyPrefix(str: string) {
    str = str.toUpperCase();
    str = replaceAll(str, /shift(\+|$)/gi, '⇧');
    str = replaceAll(str, /ctrl(\+|$)/gi, '^');
    str = replaceAll(str, /alt(\+|$)/gi, '⌥');
    str = replaceAll(str, /meta(\+|$)/gi, '◆');
    str = replaceAll(str, /win(\+|$)/gi, '⊞');
    str = replaceAll(str, /cmd(\+|$)/gi, '⌘');
    // note: a bit hacky, to handle combined key descriptions
    str = replaceAll(str, /(?<!\/) (?!\/)/g, ', ');
    str = replaceAll(str, /escape/gi, 'ESC');
    str = replaceAll(str, /,{2,}/gi, ',');
    return str;
}

export type Replacer = (substring: string) => string;

export function replaceMatchesWith(str: string, regex: RegExp, replacer: Replacer): string {
    let result = '';

    // Loop to find all matches
    let match = regex.exec(str);
    let lastIndex = 0;
    while (match) {
        const fullMatch = match[0]; // e.g., "<key>shift+t</key>"
        const innerMatch = match[1]; // e.g., "shift+t"
        // replace matched text
        result += str.substring(lastIndex, match.index);
        result += fullMatch.replace(innerMatch, replacer(innerMatch));
        lastIndex = match.index + fullMatch.length;

        match = regex.exec(str);
    }

    result += str.substring(lastIndex);

    return result;
}
