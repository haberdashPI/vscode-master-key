import * as vscode from 'vscode';
import * as capture from './capture';
import * as count from './count';
import * as doCommand from './do';
import * as mode from './mode';
import * as namedStore from './namedStore';
import * as replay from './replay';
import * as search from './search';
import * as prefix from './prefix';
import * as palette from './palette';
import * as visualKeyDoc from './visualKeyDoc';
import * as textKeyDoc from './textDocs';

/**
 * @file commands/index.md
 * @order -1
 *
 * # Commands
 *
 * There are two categories of commands available in Master Key: the user commands and the
 * keybinding commands.
 *
 */

export async function activate(context: vscode.ExtensionContext) {
    await capture.activate(context);
    await count.activate(context);
    await doCommand.activate(context);
    await mode.activate(context);
    await namedStore.activate(context);
    await replay.activate(context);
    await search.activate(context);
    await prefix.activate(context);
    await palette.activate(context);
    await visualKeyDoc.activate(context);
    await textKeyDoc.activate(context);

    /**
     * @command ignore
     * @order 131
     *
     * This command is used in a binding file to signal that the given keypress should do
     * nothing. This is useful for key presses that would otherwise cause some other action
     * to occur (e.g. type keys).
     *
     * ## Example
     *
     * Master key ensures that when in a command-related mode (e.g. `normal`) key presses to
     * letters do not cause keys to be typed.
     *
     * ```toml
     * #- in "command" like modes (e.g. normal), typing keys without a command defined
     * #- below should have no effect
     * [[bind]]
     * defaults = "modes"
     * name = "ignore"
     * description = "this key does nothing"
     * #- all keys whose bindings are described by a single character
     * foreach.key = ['{{key: .}}', 'shift+{{key: .}}']
     * key = "{{key}}"
     * command = "master-key.ignore"
     * prefixes = "{{all_prefixes}}"
     * mode = ["normal", "selectedit"]
     * when = "editorTextFocus"
     * hideInDocs = true
     * hideInPalette = true
     * priority = -10
     * ```
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.ignore', () => undefined),
    );
}
