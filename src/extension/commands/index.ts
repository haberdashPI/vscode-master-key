import * as vscode from 'vscode';
import * as capture from './capture';
import * as count from './count';
import * as doCommand from './do';
import * as mode from './mode';
// TODO: reimplement
import * as namedStore from './namedStore';
import * as replay from './replay';
import * as search from './search';
import * as prefix from './prefix';
// import * as palette from './palette';
// import * as visualKeyDoc from './visualKeyDoc';
// import * as textKeyDoc from './textDocs';

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
    // TODO: reimplement
    await namedStore.activate(context);
    await replay.activate(context);
    await search.activate(context);
    await prefix.activate(context);
    // await palette.activate(context);
    // await visualKeyDoc.activate(context);
    // await textKeyDoc.activate(context);

    /**
     * @command ignore
     * @order 131
     *
     * This command is used in a binding file to signal that the given keypress should do
     * nothing. This is useful for key presses that would otherwise cause some other action
     * to occur (e.g. insert characters in a file). **However**, it is often more effective
     * to use a `[[mode]]` section's `whenNoBinding = 'ignoreCharacters'`
     * [setting](/bindings/mode), instead of an explicit call of `master-key.ignore`, which
     * is implemented by creating ignore commands for all standard character-related keys.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.ignore', () => {
            console.log('ignore!');
            return;
        }),
    );
}
