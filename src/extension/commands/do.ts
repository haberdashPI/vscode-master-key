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
let keyPressCount = Number.MIN_SAFE_INTEGER;

////////////////////////////////////////////////////////////////////////////////////////////
// command related output

// TODO: should probably move to another file

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

let warningsShown = false;
export function showCommandWarnings(warnings: string[]) {
    for (const warn of warnings) {
        expressionMessages.appendLine(
            `[WARN: ${new Date().toLocaleTimeString()}] ${warn}` +
            ' (If you are using a default binding set, consider reactivating ' +
            'your Master Key bindings.)',
        );
    }
    if (warnings.length > 0 && !warningsShown) {
        warningsShown = false;
        expressionMessages.show(true);
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

////////////////////////////////////////////////////////////////////////////////////////////
// command execution

type CommandEventHook = () => Promise<boolean>;
let commandCompletedHooks: CommandEventHook[] = [];

// we need some way to know that a command has completed, as certain state / behaviors are
// canceled upon command completion (see `search.ts`).
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

// used to ensure orderly execution of commands within `master-key.do`
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
    // see extension-profiles/README.md for details
    // console.profile('master-key-do');
    // register that a key was pressed (cancelling the display of the quick pick for
    // prefixes of this keypress
    registerKeyPress();

    // we should execute a single do command at a time
    const release = await commandMutex.acquire();
    try {
        const args = validateInput('master-key.do', args_, masterBinding);
        if (args) {
            const toRun = bindings.prepare_binding_to_run(args.command_id);
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

                // command history needs to record edits to the current document; however we
                // only want to track those edits that occur within a single document. We
                // avoid the complexity of storing edits across multiple documents.
                // Therefore each recorded command needds to know which editor it is
                // recording edits for.
                if (!canceled && toRun.finalKey) {
                    const editor = vscode.window.activeTextEditor;
                    let id = 0;
                    if (editor) {
                        // we rely on the URI to identify documents, this does mean that the
                        // user can switch between different *views* of the same document
                        // and the edits will get recorded all the same. We accept this as a
                        // limitation. Ideally the user employs a master-key defined binding
                        // to switch between windows so the edits are recorded correctly for
                        // replay, with the two parts of the edit (before and after the
                        // window switch) getting recorded on separate command items in the
                        // history
                        id = documentIdentifiers.get(editor.document.uri);
                        if (!id) {
                            id = documentIdentifierCount++;
                            documentIdentifiers.set(editor.document.uri, id);
                        }
                        // we only record edits if the keybinding mode is supposed to
                        // respond to typed keys. Other sorts of edits that occur to the
                        // document would be do to executed commands, which we are already
                        // recording
                        const mode: string = state.get(MODE) || bindings.default_mode();
                        if (bindings.mode(mode)?.whenNoBinding() ==
                            WhenNoBindingHeader.InsertCharacters) {
                            toRun.edit_document_id = id;
                        }
                    }
                }

                // Actually save the commands we ran. Any subsequent edits to the document
                // will be stored to the binding using `store_edit` (see `replay.ts`).
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

// the palette shows suggested keybindings: if no additional keys are pressed
// we show the palette on a delay. We register key presses using `registerPaletteUpdate`
export function showPaletteOnDelay() {
    if (paletteEnabled) {
        const currentKeyPressCount = keyPressCount;
        setTimeout(async () => {
            if (currentKeyPressCount === keyPressCount) {
                registerKeyPress();
                commandPalette();
            }
        }, paletteDelay);
    }
}

// the palette shows suggested keybindings: each time a key is pressed we want to udpate
// this counter. We show the palette for a given key press if there has been a sufficient
// delay before completing another key press.
export function registerKeyPress() {
    if (keyPressCount < Number.MAX_SAFE_INTEGER) {
        keyPressCount += 1;
    } else {
        keyPressCount = Number.MIN_SAFE_INTEGER;
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
