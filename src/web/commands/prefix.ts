import * as vscode from 'vscode';
import z from 'zod';
import {CURSOR_SHAPES, CursorShape, updateCursorAppearance, validateInput} from '../utils';
import {recordedCommand, CommandState, CommandResult, withState, onSet} from '../state';
import {PrefixCodes} from '../keybindings/processing';
import {restoreModesCursorState} from './mode';

const prefixArgs = z
    .object({
        code: z.number(),
        flag: z.string().min(1).endsWith('_on').optional(),
        cursor: z.enum(CURSOR_SHAPES).optional(),
        // `automated` is used during keybinding preprocessing and is not normally used otherwise
        automated: z.boolean().optional(),
    })
    .strict();

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

let oldPrefixCursor: boolean = false;
async function prefix(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.prefix', args_, prefixArgs);
    if (args !== undefined) {
        const a = args;
        await withState(async state => {
            return state.withMutations(state => {
                let codes;
                [state, codes] = prefixCodes(state);
                const prefix = codes.nameFor(a.code);
                state.set(PREFIX_CODE, {transient: {reset: 0}, public: true}, a.code);
                state.set(PREFIX, {transient: {reset: ''}, public: true}, prefix);

                if (a.flag) {
                    state.set(a.flag, {transient: {reset: false}, public: true}, true);
                }
                if (a.cursor) {
                    const cursorShape = <CursorShape>a.cursor;
                    state.set(PREFIX_CURSOR, {transient: {reset: false}}, true);
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
    await withState(async state => {
        return state.update<string>(
            PREFIX,
            {transient: {reset: ''}, public: true, notSetValue: ''},
            prefix => (prefix.length > 0 ? prefix + ' ' + key : key)
        );
    });
}

export async function activate(context: vscode.ExtensionContext) {
    await withState(async state => {
        return state.set(PREFIX_CODE, {public: true}, 0).resolve();
    });
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.prefix', recordedCommand(prefix))
    );

    await onSet(PREFIX_CURSOR, state => {
        if (!state.get(PREFIX_CURSOR, false) && oldPrefixCursor) {
            restoreModesCursorState();
        }
        return true;
    });
}
