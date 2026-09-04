import * as fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const keybindings = Array.isArray(pkg?.contributes?.keybindings) ?
    pkg.contributes.keybindings :
        [];

const generatedBindings = keybindings.filter(b => b.generated);

if (generatedBindings.length > 0) {
    console.error(
        `Error: Found ${generatedBindings.length} generated keybinding(s) ` +
        'committed in package.json.',
    );
    console.error(
        'Generated bindings should not be committed to source control. ' +
        'Remove generated keybindings from package.json before committing.',
    );
    process.exit(1);
}

console.log('Verified: package.json does not contain any generated keybindings.');
