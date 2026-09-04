// This script generates a set of bindings that call `master-key.ignore`. This swallows key
// presses from the user when `master-key.prefixCode` is non-zero, which happens whenever
// the user presses the first key in a bound key sequence. This ensure that other bindings
// defined in `keybindings.json` that have no prefix do not get triggered. Likewise if
// `whenNoBinding = "insertCharactesr"`, characters will not be inserted once a user has
// pressed the prefix of a bound key sequence. (e.g. in an emacs like binding set, with
// these fallbacks, pressing `C-x x` will not type `x` into the buffer if `C-x` is a valid
// prefix, and `C-x x` is not bound to anything)

import * as fs from 'fs';

const modifiers = ['ctrl', 'alt', 'shift'];
const osModifiers = ['win', 'meta', 'cmd'];
const characters = 'abcdefghijklmnopqrstuvwxyz0123456789`-=[];/'.split('');
const fkeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `f${n}`);
const charactersNeedingEscape = ['\\'];
const namedKeys = [
    'left', 'up', 'right', 'down', 'pageup', 'pagedown', 'end', 'home', 'tab',
    'enter', 'escape', 'space', 'backspace', 'delete', 'pausebreak', 'capslock', 'insert',
    'numpad_multiply', 'numpad_add', 'numpad_separator', 'numpad_subtract',
    'numpad_decimal', 'numpad_divide',
];
const allKeys = [...characters, ...fkeys, ...charactersNeedingEscape, ...namedKeys];

// The on/off status of each modifier follows the bits of an increasing binary number:
// bit `i` of `mask` is set when `modifiers[i]` is held down, so counting `mask` from 0
// to 2^modifiers.length - 1 visits every unique combination exactly once.
const maskCount = 1 << modifiers.length;
const heldModifiers = mask => modifiers.filter((_, i) => mask & (1 << i));

const modifierCombos = ['']; // include empty modifiers
// all combos without os modifier
for (let mask = 1; mask < maskCount; mask++) {
    modifierCombos.push(heldModifiers(mask).join('+') + '+');
}
// each combo along with the os modifier (only one of those can be pressed at a time)
for (const osMod of osModifiers) {
    for (let mask = 0; mask < maskCount; mask++) {
        modifierCombos.push([osMod, ...heldModifiers(mask)].join('+') + '+');
    }
}

const generatedBindings = [];

for (const mod of modifierCombos) {
    for (const k of allKeys) {
        generatedBindings.push({
            key: `${mod}${k}`,
            command: 'master-key.ignore',
            when: 'master-key.prefixCode',
        });
    }
}

// Inject into package.json
fs.copyFileSync('package.json', 'package.backup.json');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.contributes.keybindings = [
    ...pkg.contributes.keybindings.filter(b => !b.generated),
    ...generatedBindings.map(b => ({ ...b, generated: true })),
];

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
