import * as vscode from 'vscode';
import z from 'zod';
import { validateInput } from '../utils';
import {
    state,
    CommandResult,
    WrappedCommandResult,
    commandArgs,
    recordedCommand,
} from '../state';
import { PREFIX, PREFIX_CODE } from './prefix';
// import { commandPalette } from './palette';
import { bindings } from '../keybindings/config';
import { MODE } from './mode';
import {
    CommandOutput,
    ReifiedBinding,
    WhenNoBindingHeader,
} from '../../rust/parsing/lib/parsing';
import { commandPalette } from './palette';
import { Mutex } from 'async-mutex';

export let maxHistory = 0;

const masterBinding = z.object({
    prefix_id: z.number().int().min(-1),
    command_id: z.number().int().min(0).default(-1),
    old_prefix_id: z.number().int().min(-1),
    mode: z.string(),
});

let documentIdentifierCount = 0;
export const documentIdentifiers = new WeakMap();

// determines how long between key presses before a palette of next key presses is made
// visible; user-configurable
let paletteDelay: number = 0;
export let paletteEnabled = true;
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

type CommandEventHook = () => Promise<boolean>;
let commandCompletedHooks: CommandEventHook[] = [];

export function onCommandComplete(hook: CommandEventHook) {
    commandCompletedHooks.push(hook);
}

export async function triggerCommandCompleteHooks() {
    const keep = await Promise.all(commandCompletedHooks.map(hook => hook()));
    const newHooks = [];
    for (let i = 0; i < keep.length; i++) {
        if (keep[i]) {
            newHooks.push(commandCompletedHooks[i]);
        }
    }
    commandCompletedHooks = newHooks;
}

function commandChangesModeOrPrefix(command: ReifiedBinding) {
    return command.has_command('master-key.prefix') ||
        command.has_command('master-key.setMode') ||
        command.has_command('master-key.enterInsert') ||
        command.has_command('master-key.enterNormal');
}

// TODO: we could also probably use Mutex to improve the legibility of `state.ts`
export const commandMutex = new Mutex();

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
    // console.profile('master-key-do');
    // register that a key was pressed (cancelling the display of the quick pick for
    // prefixes of this keypress
    registerPaletteUpdate();

    // we should execute a single do command at a time
    const release = await commandMutex.acquire();
    try {
        const args = validateInput('master-key.do', args_, masterBinding);
        if (args) {
            const toRun = bindings.do_binding(args.command_id);
            showExpressionErrors(toRun);

            // if the current binding state, after obtaining a lock, doesn't match what's
            // expected by this key binding, then we need to cancel the binding (keys were
            // pressed too fast and the binding that was triggered for this call doesn't
            // match the updates caused by previous key presses)
            const newPrefixCode = state.get(PREFIX_CODE) || 0;
            const newMode = state.get(MODE) || 0;

            if (args.old_prefix_id !== newPrefixCode || args.mode !== newMode) {
                return;
            }

            // if a command runs for too long, don't force the other pressed bindings
            // to wait for it
            setTimeout(release, 1500);

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

                        // if a command waits for user input, we don't want other bindings
                        // to become unresponsive (most bindings will not be available
                        // during the "capture" mode that will be active during these
                        // commands, but we still want some bindings, such as `ESC`, to
                        // work)
                        if (command.command === 'master-key.search' ||
                            command.command === 'master-key.captureKeys' ||
                            command.command === 'master-key.replaceChar' ||
                            command.command === 'master-key.insertChar') {
                            release();
                        }

                        // pass key codes down into the arguments to prefix
                        if (command.command !== 'master-key.ignore') {
                            if (command.command === 'master-key.prefix') {
                                command.args.prefix_id = args.prefix_id;
                                command.args.key = toRun.key;
                                command.args.mode = args.mode;
                                command.args.command_id = args.command_id;
                                // we need to know we're calling it from `master-key.do` so
                                // that we don't try to acquire the commandMutex a second
                                // time
                                command.args.fromDo = true;
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
                            // update the command arguments based on any user input
                            // collected during the call to run the command (e.g. for
                            // master-key.search).
                            toRun.store_command(i, command);
                        }
                    }
                    if (canceled) {
                        break;
                    }
                }

                if (!canceled && !toRun.finalKey && commandChangesModeOrPrefix(toRun)) {
                    showPaletteOnDelay();
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
                        const mode: string = state.get(MODE) || bindings.default_mode();
                        if (bindings.mode(mode)?.whenNoBinding() ==
                            WhenNoBindingHeader.InsertCharacters) {
                            toRun.edit_document_id = id;
                        }
                    }
                }

                if (!canceled) {
                    bindings.store_binding(toRun, maxHistory);
                }
            } finally {
                if (toRun.finalKey) {
                    // this will be immediately cleared by `reset` but
                    // its display will persist in the status bar for a little bit
                    // (see `status/keyseq.ts`)
                    const prefix = toRun.key;
                    state.set(PREFIX, prefix);
                    // here is where we clear the key sequence displayed by setting `PREFIX`
                    // above by calling `reset()`
                    state.reset();
                    state.resolve();
                } else {
                    state.resolve();
                }
                await triggerCommandCompleteHooks();
            }
        }

        return args;
    } finally {
        release();
        // console.profileEnd('master-key-do');
    }
}

export function showPaletteOnDelay() {
    if (paletteEnabled) {
        const currentPaletteUpdate = paletteUpdate;
        setTimeout(async () => {
            if (currentPaletteUpdate === paletteUpdate) {
                registerPaletteUpdate();
                commandPalette();
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
        paletteDelay = config.get<number>('suggestionDelay', 500);
        paletteEnabled = config.get<boolean>('commandSuggestionsEnabled', true);
    }
}

export function defineState() {
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
            const config = vscode.workspace.getConfiguration('master-key');
            config.update(
                'commandSuggestionsEnabled',
                !paletteEnabled,
                vscode.ConfigurationTarget.Global,
            );
        }),
    );
}
