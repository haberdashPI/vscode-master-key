import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import {
    withState,
    CommandResult,
    WrappedCommandResult,
    commandArgs,
    recordedCommand,
} from '../state';
import { PREFIX } from './prefix';
// import { commandPalette } from './palette';
import { bindings } from '../keybindings/config';

export const COMMAND_HISTORY = 'commandHistory';

let maxHistory = 0;

const masterBinding = z.object({
    key_id: z.number().int().min(0),
    command_id: z.number().int().min(0).default(-1),
});

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
 * the additional keybinding behaviors are possible in master key,
 * such as [expressions](/expressions/index).
 */
export async function doCommandsCmd(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.do', args_, masterBinding);
    if (args) {
        const toRun = bindings.resolve_commands(args.command_id);
        if ((toRun.error?.length || 0) > 0) {
            let count = 0;
            for (const e of (toRun.error || [])) {
                count++;
                if (count > 3) {
                    break;
                }
                vscode.window.showErrorMessage(e);
            }
        }

        try {
            let canceled = false;
            for (let r = 0; r < toRun.repeat + 1; r++) {
                for (const command of toRun.commands) {
                    // pass key codes down into the arguments to prefix
                    if (command.command == 'master-key.prefix') {
                        command.args.key_id = toRun.key_id;
                        command.args.prefix = toRun.key;
                    }
                    const result =
                        await vscode.commands.executeCommand<WrappedCommandResult | void>(
                            command.command,
                            command.args,
                        );
                    const resolvedArgs = commandArgs(result);
                    if (resolvedArgs === 'cancel') {
                        canceled = true;
                        break;
                    }
                    if (resolvedArgs) {
                        command.args = resolvedArgs;
                    }
                }
                if (canceled) {
                    break;
                }
            }
            // TODO: here is where we would save the command in history
            // (*after* updating the command args)

            if (!canceled && !toRun.finalKey && paletteDelay > 0) {
                const currentPaletteUpdate = paletteUpdate;
                setTimeout(async () => {
                    if (currentPaletteUpdate === paletteUpdate) {
                        registerPaletteUpdate();
                        // commandPalette(undefined, { useKey: true });
                    }
                }, paletteDelay);
            }
        } finally {
            if (toRun.finalKey) {
                // this will be immediately cleared by `reset` but
                // its display will persist in the status bar for a little bit
                // (see `status/keyseq.ts`)
                const prefix = toRun.key;
                await withState(async (state) => {
                    return state.update<string>(PREFIX, {
                        transient: { reset: '' }, public: true, notSetValue: '',
                    }, _ => prefix);
                });
                await withState(async (state) => {
                    return state.reset().resolve();
                });
            } else {
                await withState(async state => state.resolve());
            }
        }
    }
    // TODO: think about whether it is cool to nest `do` commands
    return args;
}

let paletteDelay: number = 0;
let paletteUpdate = Number.MIN_SAFE_INTEGER;

function registerPaletteUpdate() {
    if (paletteUpdate < Number.MAX_SAFE_INTEGER) {
        paletteUpdate += 1;
    } else {
        paletteUpdate = Number.MIN_SAFE_INTEGER;
    }
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
        const configPaletteDelay = config.get<number>('suggestionDelay');
        if (configPaletteDelay === undefined) {
            paletteDelay = 0;
        } else {
            paletteDelay = configPaletteDelay;
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
