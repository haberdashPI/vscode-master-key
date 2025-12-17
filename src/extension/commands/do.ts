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
import { MODE } from './mode';
import { CommandOutput, WhenNoBindingHeader } from '../../rust/parsing/lib/parsing';
import { commandPalette } from './palette';

export let maxHistory = 0;

const masterBinding = z.object({
    prefix_id: z.number().int().min(-1),
    command_id: z.number().int().min(0).default(-1),
});

let documentIdentifierCount = 0;
export const documentIdentifiers = new WeakMap();

// determines how long between key presses before a palette of next key presses is made
// visible; user-configurable
let paletteDelay: number = 0;
let paletteUpdate = Number.MIN_SAFE_INTEGER;

let expressionMessages: vscode.OutputChannel;
export function showExpressionMessages(command: CommandOutput) {
    if (command.messages) {
        for (const msg of command.messages) {
            expressionMessages.appendLine(
                `[DEBUG: ${new Date().toLocaleTimeString()}] ${msg}`,
            );
        }
        if (command.messages.length > 0) {
            expressionMessages.show(true);
        }
    }
}

export function showExpressionErrors(fallable: { errors?: string[]; error?: string[] }) {
    if (fallable.errors || fallable.error) {
        const errors = (fallable.errors || fallable.error || []);
        for (const err of errors) {
            expressionMessages.appendLine(
                `[ERROR: ${new Date().toLocaleTimeString()}] ${err}`,
            );
        }
        if (errors.length > 0) {
            expressionMessages.show(true);
            vscode.window.showErrorMessage(
                'The keybinding you pressed had an error. Review `Master Key` output.',
            );
            return true;
        }
    }
    return false;
}

type CommandCompletedHook = () => Promise<boolean>;
let commandCompletedHooks: CommandCompletedHook[] = [];

export function onCommandComplete(hook: CommandCompletedHook) {
    commandCompletedHooks.push(hook);
}

async function triggerCommandCompleteHooks() {
    const keep = await Promise.all(commandCompletedHooks.map(hook => hook()));
    const newHooks = [];
    for (let i = 0; i < keep.length; i++) {
        if (keep[i]) {
            newHooks.push(commandCompletedHooks[i]);
        }
    }
    commandCompletedHooks = newHooks;
}

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
 * recorded (so they can be replayed at a future date). It also is the mechanism by which
 * the additional keybinding behaviors are possible in master key,
 * such as [expressions](/expressions/index).
 */
export async function doCommandsCmd(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.do', args_, masterBinding);
    if (args) {
        const toRun = bindings.do_binding(args.command_id);
        showExpressionErrors(toRun);

        try {
            // this starts as true: repeating a command -1 or fewer times is equivalent
            // to canceling the command
            let canceled = true;
            for (let r = 0; r < toRun.repeat + 1; r++) {
                for (let i = 0; i < toRun.n_commands(); i++) {
                    // now we know that the command is begin run at least once
                    canceled = false;
                    const command = toRun.resolve_command(i, bindings);
                    showExpressionMessages(command);
                    showExpressionErrors(command);

                    // pass key codes down into the arguments to prefix
                    if (command.command != 'master-key.ignore') {
                        if (command.command == 'master-key.prefix') {
                            command.args.prefix_id = args.prefix_id;
                            command.args.key = toRun.key;
                        }
                        const result =
                            await vscode.commands.
                                executeCommand<WrappedCommandResult | void>(
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
                        // update the command arguments based on any user input collected
                        // during the call to run the command (e.g. for master-key.search).
                        toRun.store_command(i, command);
                    }
                }
                if (canceled) {
                    break;
                }
            }

            if (!canceled && toRun.finalKey) {
                const editor = vscode.window.activeTextEditor;
                let id = 0;
                if (editor) {
                    id = documentIdentifiers.get(editor.document.uri);
                    if (!id) {
                        id = documentIdentifierCount++;
                        documentIdentifiers.set(editor.document.uri, id);
                    }
                    await withState(async (state) => {
                        const mode = state.get(MODE, bindings.default_mode()) || 'default';
                        // we want to record edits if the current mode permits it
                        if (bindings.mode(mode)?.whenNoBinding() ==
                            WhenNoBindingHeader.InsertCharacters) {
                            toRun.edit_document_id = id;
                        }
                        return state;
                    });
                }
            }

            if (!canceled) {
                bindings.store_binding(toRun, maxHistory);
            }

            registerPaletteUpdate();
            if (!canceled && !toRun.finalKey) {
                showPaletteOnDelay();
            }
        } finally {
            if (toRun.finalKey) {
                registerPaletteUpdate();
                // this will be immediately cleared by `reset` but
                // its display will persist in the status bar for a little bit
                // (see `status/keyseq.ts`)
                const prefix = toRun.key;
                await withState(async (state) => {
                    return state.update<string>(PREFIX, {
                        transient: { reset: '' }, public: true, notSetValue: '',
                    }, _ => prefix);
                });
                // here is where we clear the key sequence displayed by setting `PREFIX`
                // above by calling `reset()`
                await withState(async (state) => {
                    return state.reset().resolve();
                });
            } else {
                await withState(async state => state.resolve());
            }
            await triggerCommandCompleteHooks();
        }
    }

    return args;
}

export function showPaletteOnDelay() {
    if (paletteDelay > 0) {
        const currentPaletteUpdate = paletteUpdate;
        setTimeout(async () => {
            if (currentPaletteUpdate === paletteUpdate) {
                registerPaletteUpdate();
                commandPalette(undefined, { useKey: true });
            }
        }, paletteDelay);
    }
}

export function registerPaletteUpdate() {
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

export async function activate(context: vscode.ExtensionContext) {
    expressionMessages = vscode.window.createOutputChannel('Master Key');
    context.subscriptions.push(expressionMessages);

    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);
}

export async function defineCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.do', recordedCommand(doCommandsCmd)),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.togglePaletteDisplay', () => {
            if (paletteDelay === 0) {
                const config = vscode.workspace.getConfiguration('master-key');
                paletteDelay = config.get<number>('suggestionDelay') || 500;
            } else {
                paletteDelay = 0;
            }
        }),
    );
}
