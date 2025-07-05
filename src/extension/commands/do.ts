import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import { BindingCommand, doArgs } from '../keybindings/parsing';
import {
    withState,
    CommandResult,
    WrappedCommandResult,
    commandArgs,
    recordedCommand,
} from '../state';
import { cloneDeep, merge } from 'lodash';
import { evalContext, reifyStrings } from '../expressions';
import { keySuffix } from './prefix';
import { isSingleCommand } from '../utils';
import { MODE, defaultMode, modeSpecs } from './mode';
import { List } from 'immutable';
import { commandPalette } from './palette';

export async function doCommand(
    command: BindingCommand,
): Promise<BindingCommand | undefined> {
    const reifiedCommand = cloneDeep(command);
    if (command.whenComputed !== undefined) {
        let doRun: unknown = undefined;
        if (typeof command.whenComputed === 'boolean') {
            doRun = command.whenComputed;
        } else {
            const whenComputedResult = command.whenComputed;
            await withState(async (state) => {
                // TODO: ideally we would move string compilation outside
                // of this function, and only have evaluation of the compiled result
                // inside this call to `withState`
                doRun = evalContext.evalStr(whenComputedResult, state.values);
                return state;
            });
        }
        reifiedCommand.whenComputed = !!doRun;
        if (!doRun) {
            reifiedCommand.computedArgs = undefined;
            return reifiedCommand; // if the if check fails, don't run the command
        }
    }

    let reifyArgs: Record<string, unknown> = command.args || {};
    if (command.computedArgs !== undefined) {
        let computed;
        await withState(async (state) => {
            computed = reifyStrings(command.computedArgs, str =>
                evalContext.evalStr(str, state.values),
            );
            return state;
        });
        reifyArgs = merge(reifyArgs, computed);
        reifiedCommand.args = reifyArgs;
        reifiedCommand.computedArgs = undefined;
    }

    // sometime, based on user input, a command can change its final argument values we need
    // to capture this result and save it as part of the `reifiedCommand` (for example, see
    // `replaceChar` in `capture.ts`)
    const result = await vscode.commands.executeCommand<WrappedCommandResult | void>(
        command.command,
        reifyArgs,
    );
    const args = commandArgs(result);
    if (args === 'cancel') {
        return undefined;
    }
    if (args) {
        reifiedCommand.args = args;
    }
    return reifiedCommand;
}

export const runCommandsArgs = z.
    object({
        do: doArgs,
        key: z.string().optional(),
        finalKey: z.boolean().optional().default(true),
        computedRepeat: z.number().min(0).or(z.string()).optional(),
        hideInPalette: z.boolean().default(false).optional(),
        hideInDocs: z.boolean().default(false).optional(),
        priority: z.number().optional(),
        combinedKey: z.string().optional(),
        combinedName: z.string().optional(),
        combinedDescription: z.string().optional(),
        kind: z.string().optional(),
        defaults: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        prefixCode: z.number().optional(),
        mode: z.string().optional(),
    }).
    strict();
export type RunCommandsArgs = z.input<typeof runCommandsArgs>;

export type RecordedCommandArgs = RunCommandsArgs & {
    // if editing is being recorded, the text document where those edits are happening
    recordEdits: vscode.TextDocument | undefined;
    edits: vscode.TextDocumentChangeEvent[] | string;
};

async function resolveRepeat(args: RunCommandsArgs): Promise<number> {
    if (typeof args.computedRepeat === 'string') {
        let repeatEval;
        const repeatStr = args.computedRepeat;
        await withState(async (state) => {
            repeatEval = evalContext.evalStr(repeatStr, state.values);
            return state;
        });
        const repeatNum = z.number().safeParse(repeatEval);
        if (repeatNum.success) {
            return repeatNum.data;
        } else {
            vscode.window.showErrorMessage(`The expression '${args.computedRepeat}' did not
                evaluate to a number`);
            return -1;
        }
    } else {
        return args.computedRepeat || 0;
    }
}

const paletteDelay: number = 0;
let paletteUpdate = Number.MIN_SAFE_INTEGER;

function registerPaletteUpdate() {
    if (paletteUpdate < Number.MAX_SAFE_INTEGER) {
        paletteUpdate += 1;
    } else {
        paletteUpdate = Number.MIN_SAFE_INTEGER;
    }
}

export async function doCommands(args: RunCommandsArgs): Promise<CommandResult> {
    registerPaletteUpdate();

    // run the commands
    let reifiedCommands: BindingCommand[] | undefined = undefined;
    let computedRepeat = 0;
    try {
        // `doCommand` can call a command that calls `doCommandsCmd` and will therefore
        // clear transient values; thus we have to compute the value of `repeat` *before*
        // running `doCommand` or the value of any transient variables (e.g. `count`) will
        // be cleared
        computedRepeat = await resolveRepeat(args);
        if (computedRepeat < 0) {
            return 'cancel';
        }

        reifiedCommands = [];
        for (const cmd of args.do) {
            const command = await doCommand(cmd);
            if (command) {
                reifiedCommands.push(command);
            }
        }
        if (computedRepeat > 0) {
            for (let i = 0; i < computedRepeat; i++) {
                for (const cmd of reifiedCommands) {
                    await doCommand(cmd);
                }
            }
        }
        if (!args.finalKey && paletteDelay > 0) {
            const currentPaletteUpdate = paletteUpdate;
            setTimeout(async () => {
                if (currentPaletteUpdate === paletteUpdate) {
                    registerPaletteUpdate();
                    commandPalette(undefined, { useKey: true });
                }
            }, paletteDelay);
        }
    } finally {
        if (args.finalKey) {
            // this will be immediately cleared by `reset` but
            // its display will persist in the status bar for a little bit
            // (see `status/keyseq.ts`)
            if (args.key) {
                await keySuffix(args.key);
            }
            await withState(async (state) => {
                return state.reset().resolve();
            });
        } else {
            await withState(async state => state.resolve());
        }
    }
    evalContext.reportErrors();
    return { ...args, do: reifiedCommands, computedRepeat };
}

export const COMMAND_HISTORY = 'commandHistory';

let maxHistory = 0;

/**
 * @command do
 * @section Performing Actions
 * @order 130
 *
 * This command is an implementation detail of master key and its specific arguments may be
 * changed, without notice, in a minor or patch release of the project. They are not
 * documented here.
 *
 * The command is listed here for completeness, but users should not make use of `do` inside
 * of a master keybinding file. Every binding stored in a master keybinding file is
 * ultimately implemented as a keybinding in VSCode's base `keybindings.json` file as a call
 * to `master-key.do`. This command ensures that all master-key triggered bindings get
 * recorded (so they can be replayed at a future date). It is also is the mechanism by which
 * the additional keybinding behaviors are possible in master key (e.g. `computedArgs`).
 */

export async function doCommandsCmd(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.do', args_, runCommandsArgs);
    if (args) {
        const command = await doCommands(args);
        if (!isSingleCommand(args.do, 'master-key.prefix')) {
            await withState(async (state) => {
                return state.update<List<unknown>>(
                    COMMAND_HISTORY,
                    { notSetValue: List() },
                    (history) => {
                        let recordEdits = undefined;
                        if (
                            (modeSpecs[state.get(MODE, defaultMode) || ''] || {})?.
                                recordEdits
                        ) {
                            recordEdits = vscode.window.activeTextEditor?.document;
                        }
                        if (command !== 'cancel') {
                            history = history.push({ ...command, edits: [], recordEdits });
                            if (history.count() > maxHistory) {
                                history = history.shift();
                            }
                        }
                        return history;
                    },
                );
            });
        }
    }
    // TODO: think about whether it is cool to nest `do` commands
    return args;
}

function updateConfig(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event?.affectsConfiguration('master-key')) {
        const config = vscode.workspace.getConfiguration('master-key');
        let configMaxHistory = config.get<number>('maxCommandHistory');
        if (configMaxHistory === undefined) {
            configMaxHistory = 1024;
        } else {
            maxHistory = configMaxHistory;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.do', recordedCommand(doCommandsCmd)),
    );

    updateConfig();
    console.log('configured max history: ' + maxHistory);
    vscode.workspace.onDidChangeConfiguration(updateConfig);
}
