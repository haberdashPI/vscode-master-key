import * as vscode from 'vscode';
import { getRequiredMode, getRequiredPrefixCode, prettifyPrefix } from '../utils';
import { state, onResolve } from '../state';
import { bindings, onChangeBindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import { MODE } from './mode';
import {
    normalizeLayoutIndependentString,
} from '../keybindings/layout';
import { KeyFileResult } from '../../rust/parsing/lib/parsing';
import { doCommandsCmd, paletteEnabled } from './do';
import { isEqual } from 'lodash';

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
        if (binding.isToggle) {
            this.command = {
                command: 'master-key.togglePaletteDisplay',
                title: 'toggle binding',
            };
        } else {
            this.command = {
                command: 'master-key.executePaletteItem',
                title: 'Execute Binding',
                arguments: [binding],
            };
        }

        this.iconPath = binding.isSection ?
            new vscode.ThemeIcon('primitive-square') :
            undefined;

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
        const items = paletteEntries[key] || [];
        let toggle: IPaletteBinding;
        if (paletteEnabled) {
            toggle = {
                key: '',
                name: 'Automatic display enabled (click to disable)',
                sections: [],
                isToggle: true,
                order: -1,
            };
        } else {
            toggle = {
                key: '',
                name: 'Automatic display disabled (click to enable)',
                sections: [],
                isToggle: true,
                order: -1,
            };
        }
        return [toggle].concat(items);
    }
}

interface IPaletteBinding {
    name?: string;
    description?: string;
    key?: string;
    combinedDescription?: string;
    combinedKey?: string;
    sections: string[];
    isSection?: boolean;
    isToggle?: boolean;
    order: number;
    command_id?: number;
    prefix_id?: number;
}

const paletteEntries: Record<string, IPaletteBinding[]> = {};

function addSections(items: IPaletteBinding[]) {
    let currentSections: string[] = [];
    let sectionCounts: number[] = [];
    const result: IPaletteBinding[] = [];
    let firstSection = true;

    for (const item of items) {
        if (!isEqual(currentSections, item.sections)) {
            if (firstSection) {
                firstSection = false;
            } else {
                result.push({
                    key: '',
                    order: item.order,
                    sections: [],
                });
            }

            const minLen = Math.min(item.sections.length, currentSections.length);
            let i = 0;
            for (; i < minLen; i++) {
                if (item.sections[i] !== currentSections[i]) {
                    if (sectionCounts[i] === undefined) {
                        sectionCounts[i] = 1;
                    } else {
                        sectionCounts[i] += 1;
                    }
                    i++;
                    break;
                }
            }
            for (; i < item.sections.length; i++) {
                if (i >= 1 && (i - 1) < (item.sections.length - 1)) {
                    const superSectionTitle =
                        (i === 1 ? '' : sectionCounts.slice(1, i).join('.') + ': ') +
                        item.sections[i - 1];
                    result.push({
                        key: superSectionTitle,
                        sections: currentSections.slice(0, i),
                        order: item.order,
                        isSection: true,
                    });
                }
                sectionCounts[i] = 1;
            }
            sectionCounts = sectionCounts.slice(0, item.sections.length);
            currentSections = item.sections;
            const sectionTitle = sectionCounts.slice(1).join('.') + ': ' +
                currentSections[currentSections.length - 1];
            result.push({
                key: sectionTitle,
                sections: currentSections,
                order: item.order,
                isSection: true,
            });
        }
        result.push(item);
    }
    return result;
}

function updateKeys(bindings: KeyFileResult) {
    const bindingMap: Record<string, Record<string, IPaletteBinding>> = {};
    for (let i = 0; i < bindings.n_bindings(); i++) {
        const binding = bindings.binding(i);
        if (binding.command === 'master-key.ignore') {
            continue;
        }
        const docs = bindings.docs(i);
        let docName = docs?.name;
        if (binding.command === 'master-key.prefix' && !docName) {
            docName = 'prefix';
        }
        if (docs?.hideInPalette || !docName) {
            continue;
        }

        const paletteEntry = {
            name: docs?.combined?.name || docName,
            key: docs?.combined?.key || binding.key,
            description: docs?.combined?.description || binding.args.description,
            combinedKey: docs?.combined?.key,
            combinedDescription: docs?.combined?.description,
            order: binding.args.command_id,
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
        const section = bindings.binding_section(binding.args.command_id);
        const oldEntry = mapping[name] || {};
        mapping[name] = {
            key: (key || oldEntry.key),
            name,
            sections: section?.names || [],
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
        paletteEntries[key] = addSections(entries);
    }
}

let treeDataProvider: MasterKeyDataProvider;
let treeView: vscode.TreeView<IPaletteBinding>;

export function defineState() {
}

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

    treeDataProvider.mode = <string>state.get(MODE) || bindings.default_mode();
    treeDataProvider.prefixCode = <number>state.get(PREFIX_CODE) || 0;
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

function updateConfig(event?: vscode.ConfigurationChangeEvent) {
    if (!event || event?.affectsConfiguration('master-key')) {
        treeDataProvider.refresh();
    }
}

export async function defineCommands(context: vscode.ExtensionContext) {
    /**
     * @userCommand commandSuggestions
     * @name Key Suggestions...
     *
     * Display a list of possible key presses which follow from the current prefix of
     * keys pressed so far.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.commandSuggestions', commandPalette),
    );

    /**
     * @userCommand toggleSuggestions
     * @name Toggle Key Suggestions
     *
     * Display or hide a list of possible key presses which follow from the current prefix
     * of keys pressed so far.
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
                await doCommandsCmd({
                    label: binding.combinedKey || binding.key || '',
                    command_id: binding.command_id,
                    prefix_id: binding.prefix_id,
                    mode: state.get(MODE) || '',
                    old_prefix_id: state.get(PREFIX_CODE) || 0,
                });
            },
        ),
    );

    vscode.workspace.onDidChangeConfiguration(updateConfig);

    onResolve('palette', () => {
        treeDataProvider.mode = state.get<string>(MODE) || '';
        treeDataProvider.prefixCode = state.get<number>(PREFIX_CODE) || 0;
        return true;
    });
}
