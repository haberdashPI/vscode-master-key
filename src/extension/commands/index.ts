import * as vscode from 'vscode';
import { state } from '../state';

// commands related to capturing user input
import * as capture from './capture';
// commands related to updating `key.count`
import * as count from './count';
// `mater-key.do`: the actual command run when any binding explicitly defined in a master
// keybinding file is executed
import * as doCommand from './do';
// commands related to changing the keybinding mode
import * as mode from './mode';
// TODO: reimplement
// commands related to storing and running stored commands
import * as storeCommand from './storeCommand';
// commands related to replay command history
import * as replay from './replay';
// commands related to searching for text
import * as search from './search';
// commands related to setting the keybinding prefix (`g` is the prefix to the binding `g g`)
import * as prefix from './prefix';
// commands related to showing keybinding suggestions in the sidebar
import * as palette from './palette';
// commands related to the visual documentation
import * as visualKeyDoc from './visualKeyDoc';

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

// NOTE: documentation for each command occurs within each respective file

export function defineState() {
    capture.defineState();
    count.defineState();
    doCommand.defineState();
    mode.defineState();
    storeCommand.defineState();
    replay.defineState();
    search.defineState();
    prefix.defineState();
    palette.defineState();
    visualKeyDoc.defineState();
}

export async function activate(context: vscode.ExtensionContext) {
    await capture.activate(context);
    await count.activate(context);
    await doCommand.activate(context);
    await mode.activate(context);
    await storeCommand.activate(context);
    await replay.activate(context);
    await search.activate(context);
    await prefix.activate(context);
    await palette.activate(context);
    await visualKeyDoc.activate(context);
}

export async function defineCommands(context: vscode.ExtensionContext) {
    await capture.defineCommands(context);
    await count.defineCommands(context);
    await doCommand.defineCommands(context);
    await mode.defineCommands(context);
    await storeCommand.defineCommands(context);
    await replay.defineCommands(context);
    await search.defineCommands(context);
    await prefix.defineCommands(context);
    await palette.defineCommands(context);
    await visualKeyDoc.defineCommands(context);

    /**
     * @command ignore
     * @order 131
     *
     * This command is used in a binding file to signal that the given keypress should do
     * nothing. This is useful for key presses that would otherwise cause some other action
     * to occur (e.g. insert characters in a file). *However*, it is often more effective
     * to use a `[[mode]]` section's `whenNoBinding = 'ignoreCharacters'`
     * [setting](/bindings/mode), instead of an explicit call to `master-key.ignore`.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.ignore', async () => {
            // NOTE: Thus the only time this function is run is when `mater-key.ignore` is
            // called *directly*, outside of `master-key.do`: the actual command
            // master-key.ignore is not called when inside of `master-key.do` because `do`
            // detects ignore commands and skips them. When called directly `ignore` should
            // reset any transient state because the user has hit some key that doesn't
            // actually define a binding. We want to prevent this from triggering an actual
            // command e.g. `gg` goes to the top of the buffer but `gog` should do nothing.
            doCommand.registerPaletteUpdate();
            state.reset();
            state.resolve();
            await doCommand.triggerCommandCompleteHooks();

            return;
        }),
    );
}
