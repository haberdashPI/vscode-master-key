import { pause, movesCursorInEditor, setBindings, setupEditor } from "./utils";
import expect from "expect";
import { Key, TextEditor, Workbench } from "vscode-extension-tester";

export const run = () => describe('Search motions', () => {
    before(async function(){
        this.timeout(5 * 1000);
        await setBindings(`
            [header]
            version = "1.0"

            [define]
            validModes = ["insert", "capture", "normal"]

            [[bind]]
            description = "Enter normal mode"
            key = "escape"
            mode = []
            command = "runCommands"
            args = ["master-key.enterInsert", "master-key.reset"]
            when = "!findWidgetVisible"
            prefixes = "<all-prefixes>"

            [[bind]]
            name = "search"
            key = "/"
            command = "master-key.search"
       `);
    });

    // TODO: start working on testing out the most basic command
    // TODO: test out each argument
    // - backwards
    // - caseSensitive
    // - wrapAround
    // - acceptAfter
    // - selectTillMatch
    // - highlightMatches
    // - offset
    // - text
    // - regex
    // - register
    // - doAfter

});

export default { run };
