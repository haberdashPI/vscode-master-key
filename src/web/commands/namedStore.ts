import * as vscode from 'vscode';
import z from 'zod';
import {validateInput} from '../utils';
import {CommandResult, recordedCommand} from '../state';
import {evalContext} from '../expressions';
import {withState} from '../state';

const restoreNamedArgs = z.object({
    description: z.string().optional(),
    name: z.string(),
});

const stored: Record<string, Record<string, unknown>> = {};

const CAPTURED = 'captured';

async function restoreNamed(args_: unknown): Promise<CommandResult> {
    const args = validateInput('master-key.restoreNamed', args_, restoreNamedArgs);
    if (args) {
        if (!stored[args.name]) {
            vscode.window.showErrorMessage(`No values are stored under '${args.name}'.`);
        }
        const items = Object.keys(stored[args.name]).map(x => ({label: x}));
        const selected = await vscode.window.showQuickPick(items);
        if (selected !== undefined) {
            const a = args;
            const s = selected;
            await withState(async state => {
                return state.set(CAPTURED, {public: true}, stored[a.name][s.label]);
            });
        }
    }
    return;
}

const storeNamedArgs = z.object({
    description: z.string().optional(),
    name: z.string(),
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
                    picker.title = args.description || args.name;
                    picker.placeholder = 'Enter a new or existing name';
                    const options: vscode.QuickPickItem[] = Object.keys(
                        stored[args.name] || {}
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
                        if (stored[args.name] === undefined) {
                            stored[args.name] = {};
                        }
                        stored[args.name][name] = value;
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
}
