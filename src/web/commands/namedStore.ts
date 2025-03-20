import * as vscode from 'vscode';
import z from 'zod';
import {validateInput} from '../utils';
import {CommandResult, recordedCommand} from '../state';
import {evalContext} from '../expressions';
import {withState} from '../state';
import {doCommand} from './do';
import {merge, omit} from 'lodash';
import {bindingCommand} from '../keybindings/parsing';

const storeNamedArgs = z.object({
    description: z.string().optional(),
    register: z.string(),
    contents: z.string(),
});

async function storeNamed(args_: unknown): Promise<CommandResult> {
    const argsNow = validateInput('master-key.storeNamed', args_, storeNamedArgs);
    if (argsNow) {
        const args = argsNow;
        let value: unknown = undefined;
        await withState(async state => {
            value = evalContext.evalStr(args.contents, state.values);
            return state;
        });
        if (value !== undefined) {
            return new Promise<CommandResult>((resolve, reject) => {
                try {
                    const picker = vscode.window.createQuickPick();
                    picker.title = args.description || args.register;
                    picker.placeholder = 'Enter a new or existing name';
                    const options: vscode.QuickPickItem[] = Object.keys(
                        stored[args.register] || {}
                    ).map(k => ({label: k}));
                    options.unshift(
                        {label: 'New Name...', alwaysShow: true},
                        {
                            label: 'Existing Names:',
                            kind: vscode.QuickPickItemKind.Separator,
                        }
                    );
                    picker.items = options;
                    picker.onDidAccept(_ => {
                        const item = picker.selectedItems[0];
                        let name;
                        if (item.label === 'New Name...') {
                            name = picker.value;
                        } else {
                            name = item.label;
                        }
                        if (stored[args.register] === undefined) {
                            stored[args.register] = {};
                        }
                        stored[args.register][name] = value;
                        picker.hide();
                    });
                    picker.onDidHide(_ => {
                        resolve(undefined);
                    });
                    picker.show();
                } catch (e) {
                    reject(e);
                }
            });
        }
    }
    return Promise.resolve(undefined);
}

const restoreNamedArgs = z.object({
    description: z.string().optional(),
    register: z.string(),
});

const stored: Record<string, Record<string, unknown>> = {};

const CAPTURED = 'captured';

async function restoreNamed(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.restoreNamed', args_, restoreNamedArgs);
    if (args) {
        if (!stored[args.register]) {
            vscode.window.showErrorMessage(
                `No values are stored under '${args.register}'.`
            );
        }
        const items = Object.keys(stored[args.register]).map(x => ({label: x}));
        const selected = await vscode.window.showQuickPick(items);
        if (selected !== undefined) {
            const a = args;
            const s = selected;
            await withState(async state => {
                return state.set(CAPTURED, {public: true}, stored[a.register][s.label]);
            });
        }
    }
    return;
}

const storeCommandArgs = z.object({
    register: z.string(),
    command: z.string(),
    args: z.any().optional(),
    computedArgs: z.object({}).passthrough().optional(),
});
type StoreCommandArgs = z.infer<typeof storeCommandArgs>;

const storedCommands: Record<string, StoreCommandArgs> = {};

async function storeCommand(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.storeCommand', args_, storeCommandArgs);
    if (args) {
        storedCommands[args.register] = args;
    }
    return undefined;
}

const executeStoredCommandArgs = z.object({
    register: z.string(),
    command: z.string().optional(),
    args: z.any().optional(),
    computedArgs: z.object({}).passthrough().optional(),
});

async function executedStoredCommand(args_: unknown): Promise<CommandResult> {
    const args = validateInput(
        'master-key.executeStoredCommand',
        args_,
        executeStoredCommandArgs
    );
    if (args) {
        const command_ = merge(storedCommands[args.register], args);
        const command = validateInput(
            'master-key.executeStoredCommand',
            omit(command_, 'register'),
            bindingCommand
        );
        if (command !== undefined) {
            await doCommand(command);
        }
        return merge(args, command);
    }
    return undefined;
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.storeNamed',
            recordedCommand(storeNamed)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.restoreNamed',
            recordedCommand(restoreNamed)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.storeCommand',
            recordedCommand(storeCommand)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.executeStoredCommand',
            recordedCommand(executedStoredCommand)
        )
    );
}
