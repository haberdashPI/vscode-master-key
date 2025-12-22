import * as vscode from 'vscode';
import { getRequiredMode, getRequiredPrefixCode, prettifyPrefix } from '../utils';
import { onSet, withState } from '../state';
import { bindings, onChangeBindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import { MODE } from './mode';
import {
    normalizeLayoutIndependentString,
} from '../keybindings/layout';
import { KeyFileResult } from '../../rust/parsing/lib/parsing';
import { doCommandsCmd } from './do';

/**
 * Represents an individual command in the sidebar tree.
 */
class CommandTreeItem extends vscode.TreeItem {
    constructor(public readonly binding: IPaletteBinding) {
        // Label shows the keybinding; description shows the command name
        super(
            binding.combinedKey || binding.key || '',
            vscode.TreeItemCollapsibleState.None,
        );

        this.description = binding.name;
        this.tooltip = binding.combinedDescription || binding.description;

        // This command is triggered when the user clicks the item
        this.command = {
            command: 'master-key.executePaletteItem',
            title: 'Execute Binding',
            arguments: [binding],
        };

        // Optional: Add icons or context values for styling
        this.contextValue = 'masterKeyCommandEntry';
    }
}

export class MasterKeyDataProvider implements vscode.TreeDataProvider<IPaletteBinding> {
    private _onDidChangeTreeData: vscode.EventEmitter<IPaletteBinding | undefined | void> =
        new vscode.EventEmitter<IPaletteBinding | undefined | void>();

    readonly onDidChangeTreeData: vscode.Event<IPaletteBinding | undefined | void> =
        this._onDidChangeTreeData.event;

    // Store state locally for instant access
    private _prefixCode: number = 0;
    private _mode: string = '';

    get mode() {
        return this._mode;
    }

    get prefixCode() {
        return this._prefixCode;
    }

    set prefixCode(x: number) {
        this._prefixCode = x;
        this._onDidChangeTreeData.fire();
    }

    set mode(x: string) {
        this._mode = x;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: IPaletteBinding): vscode.TreeItem {
        return new CommandTreeItem(element);
    }

    getParent(_element: IPaletteBinding) {
        return undefined;
    }

    public refresh() {
        this._onDidChangeTreeData.fire();
    }

    async getChildren(element?: IPaletteBinding): Promise<IPaletteBinding[]> {
        // We only have a flat list, so if 'element' is provided, there are no sub-children
        if (element) return [];
        const key = `${this._prefixCode}:${this._mode}`;
        return paletteEntries[key] || [];
    }
}

interface IPaletteBinding {
    name?: string;
    description?: string;
    key?: string;
    combinedDescription?: string;
    combinedKey?: string;
    order: number;
    command_id?: number;
    prefix_id?: number;
}

const paletteEntries: Record<string, IPaletteBinding[]> = {};

function updateKeys(bindings: KeyFileResult) {
    const bindingMap: Record<string, Record<string, IPaletteBinding>> = {};
    for (let i = 0; i < bindings.n_bindings(); i++) {
        const binding = bindings.binding(i);
        if (binding.command === 'master-key.ignore') {
            continue;
        }
        const docs = bindings.docs(i);
        if (docs?.hideInPalette) {
            continue;
        }
        const paletteEntry = {
            key: docs?.combined?.key || binding.key,
            name: docs?.combined?.name || binding.args.name,
            description: docs?.combined?.description || binding.args.description,
            combinedKey: docs?.combined?.key,
            combinedDescription: docs?.combined?.description,
            order: binding.command === 'master-key.do' ? i : bindings.n_bindings() + 1,
        };
        let key = prettifyPrefix(paletteEntry.key);
        key = normalizeLayoutIndependentString(key, { noBrackets: true });
        let combinedKey = prettifyPrefix(paletteEntry.combinedKey || '');
        combinedKey = normalizeLayoutIndependentString(combinedKey, { noBrackets: true });

        const prefixCode = getRequiredPrefixCode(binding.when);
        const mode = getRequiredMode(binding.when);
        const context = `${prefixCode}:${mode}`;
        const mapping = bindingMap[context] || {};
        const name = paletteEntry.name;
        const oldEntry = mapping[name] || {};
        mapping[name] = {
            key: key || oldEntry.key,
            name,
            description: paletteEntry.description || oldEntry.description,
            combinedKey: combinedKey || oldEntry.combinedKey,
            combinedDescription: paletteEntry.combinedDescription ||
                oldEntry.combinedDescription,
            order: Math.max(paletteEntry.order || -1, oldEntry.order || -1),
            command_id: binding.args.command_id || oldEntry.command_id,
            prefix_id: binding.args.prefix_id || oldEntry.prefix_id,
        };
        bindingMap[context] = mapping;
    }

    for (const [key, bindings] of Object.entries(bindingMap)) {
        const entries = Object.values(bindings);
        entries.sort((x, y) => x.order - y.order);
        paletteEntries[key] = entries;
    }
}

let treeDataProvider: MasterKeyDataProvider;
let treeView: vscode.TreeView<IPaletteBinding>;

export async function activate(context: vscode.ExtensionContext) {
    treeDataProvider = new MasterKeyDataProvider();
    treeView = vscode.window.createTreeView('masterKeySidePanel', {
        treeDataProvider,
        showCollapseAll: true,
        canSelectMany: false,
    });
    context.subscriptions.push(treeView);

    onChangeBindings(async (x) => {
        updateKeys(x);
        treeDataProvider.refresh();
    });

    await withState(async (state) => {
        treeDataProvider.mode = <string>state.get(MODE, bindings.default_mode());
        treeDataProvider.prefixCode = <number>state.get(PREFIX_CODE, 0) || 0;
        return state;
    });
}

export async function commandPalette() {
    const items = await treeDataProvider.getChildren();
    if (items.length > 0) {
        await treeView.reveal(items[0], {
            select: false,
            focus: false,
            expand: true,
        });
    }
}

export async function defineCommands(context: vscode.ExtensionContext) {
    /**
     * @userCommand commandSuggestions
     * @name Key Suggestions...
     *
     * Display a list of possible key presses that follow after the current prefix of
     * keys that have been pressed so far.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.commandSuggestions', commandPalette),
    );

    /**
     * @userCommand toggleSuggestions
     * @name Toggle Key Suggestions
     *
     * Display or hide a list of possible key presses that follow after the current prefix
     * of keys that have been pressed so far.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.toggleSuggestions', async () => {
            if (treeView.visible) {
                await vscode.commands.executeCommand('workbench.action.closeSidebar');
            } else {
                await commandPalette();
            }
        }),
    );

    // Command to handle clicking an item in the tree
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'master-key.executePaletteItem',
            async (binding: IPaletteBinding) => {
                // Reconstruct the 'pick' object your doCommandsCmd expects
                const state = await withState(async s => s);
                await doCommandsCmd({
                    label: binding.combinedKey || binding.key || '',
                    command_id: binding.command_id,
                    prefix_id: binding.prefix_id,
                    mode: state?.get(MODE, '') || '',
                    old_prefix_id: state?.get(PREFIX_CODE, 0) || 0,
                });
            },
        ),
    );

    onSet(MODE, (state) => {
        treeDataProvider.mode = <string>state.get(MODE, bindings.default_mode());
        return true;
    });

    onSet(PREFIX_CODE, (state) => {
        treeDataProvider.prefixCode = <number>state.get(PREFIX_CODE, 0) || 0;
        return true;
    });
}
