import * as vscode from 'vscode';
import * as capture from './capture';
import * as count from './count';
import * as doCommand from './do';
import * as mode from './mode';
import * as namedStore from './namedStore';
import * as replay from './replay';
import * as search from './search';

export function activate(context: vscode.ExtensionContext){
    capture.activate(context);
    count.activate(context);
    doCommand.activate(context);
    mode.activate(context);
    namedStore.activate(context);
    replay.activate(context);
    search.activate(context);

    context.subscriptions.push(vscode.commands.registerCommand('master-key.ignore',
        () => undefined));
}
