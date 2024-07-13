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

    context.subscriptions.push(
        vscode.commands.registerCommand('master-key.ignore', () => undefined)
    );
}
