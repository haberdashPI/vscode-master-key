import * as vscode from 'vscode';
import { getRequiredMode, getRequiredPrefixCode, prettifyPrefix } from '../utils';
import { state, onResolve } from '../state';
import { bindings, onSetBindings } from '../keybindings/config';
import { PREFIX_CODE } from './prefix';
import { MODE } from './mode';
import {
    simplifyLayoutIndependentString,
} from '../keybindings/layout';
import { BindingDoc, KeyFileResult } from '../../rust/parsing/lib/parsing';
import { doCommandsCmd, paletteEnabled } from './do';
import { isEqual } from 'lodash';

// the representation of a single palette item
interface IPaletteBinding {
    // fields from [[bind.doc]]
    name?: string;
    description?: string;
    key?: string;
    combinedDescription?: string;
    combinedKey?: string;
    // represents the bindings position relative to markdown sections
    // each item in the array is an additional level of subsections
    // e.g. the item under `# Title`, `## Section 1`, `### Subsection 1.2`
    // will have three values in this field `["Title", "Section 1", "Section 1.2"]`
    sections: string[];
    // indicates whether the current item is a section label rather than an actual binding
    isSection?: boolean;
    // indicates whether this is just a setting toggle rather than an actual binding
    isToggle?: boolean;
    // name is a fallback (e.g. "prefix" for undoc'd prefixes)
    isFallbackName?: boolean;
    // determines the ordering of the binding in this view
    order: number;
    // the command associated with this binding (used to execute it when clicked)
    command_id?: number;
    // the prefix for this binding, used when executing the binding (if it's a prefix
    // related binding)
    prefix_id?: number;
}

// the list of all palette entries organized by the binding mode and prefix it should show
// up under
const paletteEntries: Record<string, IPaletteBinding[]> = {};

// Represents an individual command in the sidebar tree.
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

// represents the global variable `paletteEntries` to our TreeView
export class MasterKeyDataProvider implements vscode.TreeDataProvider<IPaletteBinding> {
    // TODO: this is a bit of cargo culting mumbo jumbo that I'm fairly certain we don't
    // need that I copied from an example. I don't have the time/bandwidth to clean this up
    // right now, but we can probably do something more idiomatic to trigger changes when
    // set call the setters
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

// use the `.sections` field of each binding item to generate section headers
function addSections(items: IPaletteBinding[]) {
    let currentSections: string[] = [];
    let sectionCounts: number[] = [];
    const result: IPaletteBinding[] = [];
    let firstSection = true;

    for (const item of items) {
        // when the sections change we introduce a new header
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

// when the bindings are first set or change we need to set `paletteEntries`
function updateKeys(bindings: KeyFileResult) {
    const bindingMap: Record<string, Record<string, IPaletteBinding>> = {};
    // Track which keys have an explicit (non-fallback) entry so we can
    // skip fallback entries for keys already claimed.
    const explicitKeys: Record<string, Set<string>> = {};

    // Two-pass: process explicit entries first, then fallback entries.

    // Pass 1: explicit (non-fallback) entries
    for (const candidate of iterPaletteCandidates(bindings)) {
        if (candidate.kind !== 'explicit') {
            continue;
        }
        const { binding, docs } = candidate;
        const key = normalizeKey(candidate.rawKey);
        const combinedKey = candidate.rawCombinedKey ?
                normalizeKey(candidate.rawCombinedKey) :
            '';
        const context = bindingContext(binding);

        // Track this key so fallback entries for the same key are skipped
        const keys = explicitKeys[context] || (explicitKeys[context] = new Set());
        if (key) keys.add(key);
        if (combinedKey) keys.add(combinedKey);

        storeEntry(bindings, bindingMap, context, candidate.name, {
            binding,
            key,
            name: candidate.name,
            description: docs?.combined?.description || binding.args.description,
            combinedKey,
            combinedDescription: docs?.combined?.description,
            isFallbackName: false,
        });
    }

    // Pass 2: fallback entries (undocumented master-key.prefix)
    for (const candidate of iterPaletteCandidates(bindings)) {
        if (candidate.kind !== 'fallback') {
            continue;
        }
        const { binding } = candidate;
        const key = normalizeKey(binding.key);
        const context = bindingContext(binding);

        // Skip if an explicit entry already claims this key
        if (explicitKeys[context]?.has(key)) {
            continue;
        }

        storeEntry(bindings, bindingMap, context, `prefix:${key}`, {
            binding,
            key,
            name: 'prefix',
            description: binding.args.description,
            combinedKey: '',
            combinedDescription: undefined,
            isFallbackName: true,
        });
    }

    for (const [key, bindings] of Object.entries(bindingMap)) {
        const entries = Object.values(bindings);
        entries.sort((x, y) => x.order - y.order);
        paletteEntries[key] = addSections(entries);
    }
}

// the wasm lib types `binding(i)` as `any`; this is the shape used here
interface PaletteKeyBinding {
    command: string;
    key: string;
    when: string;
    args: {
        command_id?: number;
        prefix_id?: number;
        description?: string;
    };
}

// A binding classified for palette display: `explicit` entries have a doc name
// (possibly with combined docs); `fallback` entries are undocumented
// `master-key.prefix` bindings shown as "prefix".
type PaletteCandidate =
    | {
        kind: 'explicit';
        binding: PaletteKeyBinding;
        docs: BindingDoc | undefined;
        name: string;
        rawKey: string;
        rawCombinedKey: string | undefined;
    } |
    { kind: 'fallback'; binding: PaletteKeyBinding };

// Yields each binding eligible for the palette, classified as explicit or
// fallback. Shared by both passes of `updateKeys` so the skip/classify rules
// live in exactly one place.
function* iterPaletteCandidates(keyFile: KeyFileResult): Generator<PaletteCandidate> {
    for (let i = 0; i < keyFile.n_bindings(); i++) {
        const binding: PaletteKeyBinding = keyFile.binding(i);
        if (binding.command === 'master-key.ignore') {
            continue;
        }
        const docs = keyFile.docs(i);
        if (docs?.hideInPalette) {
            continue;
        }
        const docName = docs?.name;
        if (binding.command === 'master-key.prefix' && !docName) {
            yield { kind: 'fallback', binding };
        } else if (docName) {
            yield {
                kind: 'explicit',
                binding,
                docs,
                name: docs?.combined?.name || docName,
                rawKey: docs?.combined?.key || binding.key,
                rawCombinedKey: docs?.combined?.key,
            };
        }
    }
}

// the palette bucket a binding belongs to: its required prefix code and mode
function bindingContext(binding: PaletteKeyBinding): string {
    return `${getRequiredPrefixCode(binding.when)}:${getRequiredMode(binding.when)}`;
}

/** Normalize a key string for palette display. */
function normalizeKey(raw: string): string {
    return simplifyLayoutIndependentString(prettifyPrefix(raw), { noBrackets: true });
}

/** Insert or merge a palette entry into the per-context map. */
function storeEntry(
    keyFile: KeyFileResult,
    bindingMap: Record<string, Record<string, IPaletteBinding>>,
    context: string,
    mapKey: string,
    entry: {
        binding: PaletteKeyBinding;
        key: string;
        name: string;
        description: string | undefined;
        combinedKey: string;
        combinedDescription: string | undefined;
        isFallbackName: boolean;
    },
) {
    const commandId = entry.binding.args.command_id;
    const mapping = bindingMap[context] || {};
    const old = mapping[mapKey] || {};
    mapping[mapKey] = {
        key: entry.key || old.key,
        name: entry.name,
        sections: keyFile.binding_section(commandId ?? -1)?.names || [],
        description: entry.description || old.description,
        combinedKey: entry.combinedKey || old.combinedKey,
        combinedDescription: entry.combinedDescription || old.combinedDescription,
        order: Math.max(commandId ?? -1, old.order || -1),
        command_id: commandId || old.command_id,
        prefix_id: entry.binding.args.prefix_id || old.prefix_id,
        isFallbackName: entry.isFallbackName,
    };
    bindingMap[context] = mapping;
}

let treeDataProvider: MasterKeyDataProvider;
let treeView: vscode.TreeView<IPaletteBinding>;

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

////////////////////////////////////////////////////////////////////////////////////////////
// activation

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

    onSetBindings(async (x) => {
        updateKeys(x);
        treeDataProvider.refresh();
    });

    treeDataProvider.mode = <string>state.get(MODE) || bindings.default_mode();
    treeDataProvider.prefixCode = <number>state.get(PREFIX_CODE) || 0;
}

export async function defineCommands(context: vscode.ExtensionContext) {
    vscode.workspace.onDidChangeConfiguration(updateConfig);

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
     * of keys pressed so far. Assumes the primary sidebar is used to display the bindings
     * (the bar on the left side).
     *
     * When hidden, this makes the binding visible. When already visible, this command hides
     * the sidebar, which is where the key suggestions are placed by default.
     *
     * Extensions do not control where tree views show up. The user is able to explicitly
     * move these views around as they see fit, and Master Key has no visibility into this
     * choice. Users wishing to keep the key suggestions in the right pane, can use the
     * command `master-key.toggleSuggestionsInAuxiliaryBar`.
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

    /**
     * @userCommand toggleSuggestionsInAuxiliaryBar
     * @name Toggle Key Suggestions
     *
     * Display or hide a list of possible key presses which follow from the current prefix
     * of keys pressed so far. Assumes the auxiliary sidebar is used to display the bindings
     * (the bar on the right side).
     *
     * When hidden, this makes the binding visible. When already visible, this command hides
     * the auxiliary sidebar. Users wishing to use this command to toggle suggestions should
     * first move the key suggestions over to the auxiliary bar.
     *
     * Extensions do not control where tree views show up. The user is able to explicitly
     * move these views around as they see fit, and Master Key has no visibility into this
     * choice. Users wishing to keep the key suggestions in the left pane, can use the
     * command `master-key.toggleSuggestions`.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.toggleSuggestionsInAuxiliaryBar',
            async () => {
                if (treeView.visible) {
                    await vscode.commands.executeCommand(
                        'workbench.action.toggleAuxiliaryBar',
                    );
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

    onResolve('palette', () => {
        treeDataProvider.mode = state.get<string>(MODE) || '';
        treeDataProvider.prefixCode = state.get<number>(PREFIX_CODE) || 0;
        return true;
    });
}
