import { mapValues, isEqual } from 'lodash';
import replaceAll from 'string.prototype.replaceall';
import { BindingSpec } from './parsing';
import * as semver from 'semver';

export function legacyParse(toml: unknown) {
    if (!validateLegacy(toml)) {
        return { success: false };
    } else {
        return { success: true, data: legacyParseStepper(toml, toml)[1] };
    }
}

function legacyParseStepper(
    toml: unknown,
    root: unknown,
    path: string[] = [],
): [string, unknown] {
    if (isEqual(path, ['header', 'version'])) {
        return ['version', '2.0'];
    } else if (isEqual(path, ['bind', path[1], 'path'])) {
        // bind[i].path -> defaults
        return legacyParseStepper(toml, root, [path[0], path[1], 'defaults']);
    } else if (isEqual(path, ['bind', path[1], 'resetTransient'])) {
        // bind[i].resetTransient -> finalKey
        return legacyParseStepper(toml, root, [path[0], path[1], 'finalKey']);
    } else if (isEqual(path, ['bind', path[1], 'repeat'])) {
        // bind[i].repeat -> computedRepeat
        return legacyParseStepper(toml, root, [path[0], path[1], 'computedRepeat']);
    } else if (isEqual(path, ['bind', path[1], 'if'])) {
        // bind[i].if -> whenComputed
        return legacyParseStepper(toml, root, [path[0], path[1], 'whenComputed']);
    } else if (isEqual(path, ['bind', path[1], 'prefixes'])) {
        // replaces <all-prefixes> with {{all_prefixes}}
        return ['prefixes', handlePrefixes(toml)];
    } else if (isEqual(path, ['bind', path[1], 'forearch']) && typeof toml === 'object') {
        // replaces {x} with {{x}}
        return ['foreach', handleForEach(<object>toml)];
    } else if (isEqual(path, ['bind', path[1], 'args'])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const command = (<any>root)['bind'] ?? [Number(path[1])] ?? ['command'];
        // replace {x} with {{x}} (for `foreach` arguments)
        // and rename arguments for updated commands
        return ['args', handleCommandArgs(command, toml)];
    } else if (isEqual(path, ['bind', path[1], 'computedArgs'])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const command = (<any>root)['bind'] ?? [Number(path[1])] ?? ['command'];
        // replace {x} with {{x}} (for `foreach` arguments)
        // and rename arguments for updated commands
        return ['computedArgs', handleCommandArgs(command, toml)];
    } else if (isEqual(path, ['path'])) {
        return legacyParseStepper(toml, root, ['defaults']);
    } else if (isEqual(path, ['defaults', path[1], 'when'])) {
        return ['appendWhen', cleanupBrackets(<string>toml)];
    } else if (Array.isArray(toml)) {
        return [
            path[path.length - 1],
            toml.map((x, i) => legacyParseStepper(x, root, [...path, `${i}`])[1]),
        ];
    } else if (typeof toml === 'object') {
        const o = <object>toml;
        let entries = Object.entries(o);
        entries = entries.map(([k, v]) => legacyParseStepper(v, root, [...path, k]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = {};
        for (const [k, v] of entries) {
            result[k] = v;
        }
        return [path[path.length - 1], result];
    } else {
        return [path[path.length - 1], toml];
    }
}

function validateLegacy(toml: unknown) {
    const vstr = (<BindingSpec>toml)?.header?.version;
    if (vstr) {
        const cvstr = semver.coerce(vstr);
        if (cvstr && semver.satisfies(cvstr, '1.0')) {
            return true;
        }
    }
    return false;
}

function handlePrefixes(prefixes: unknown) {
    if (prefixes === '<all-prefixes>') {
        return '{{all_prefixes}}';
    }
    return prefixes;
}

function handleCommandArgs(command: string, args: unknown) {
    if (!command && !args) {
        return args;
    } else if (command === 'runCommands') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (<any>args)?.commands?.map((command: any) => {
            const subArgs = handleCommandArgs(command?.command, command?.args);
            const subComputedArgs = handleCommandArgs(
                command?.command,
                command?.computedArgs,
            );
            return { command, args: subArgs, computedArgs: subComputedArgs };
        });
    } else if (command === 'restoreNamed' || command === 'storeNamed') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = <any>args;
        return {
            description: cleanupBrackets(a?.description ?? ''),
            register: cleanupBrackets(a?.name ?? ''),
        };
    } else if (
        command === 'master-key.pushHistoryToStack' ||
        command === 'master-key.replayFromStack'
    ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = <any>args;
        return {
            whereComputedIndexIs: a?.at ? cleanupBrackets(a?.at) : undefined,
            whereComputedRangeIs: a?.range ? cleanupBrackets(a?.range) : undefined,
        };
    } else {
        return cleanupNestedBrackets(args);
    }
}

function cleanupBrackets(x: string) {
    // use `replaceAll` instead of `replace` to ensure all instances get replaced
    // (it's easier to debug with `replace` because it doesn't flag a caught exception)
    x = replaceAll(x, /\{\{/g, '{');
    x = replaceAll(x, /\}\}/g, '}');
    // x = x.replace(/\{\{/g, '{');
    // x = x.replace(/\}\}/g, '}');
    return x;
}

function cleanupNestedBrackets(x: unknown): unknown {
    if (Array.isArray(x)) {
        return x.map(cleanupBrackets);
    } else if (typeof x === 'object') {
        return mapValues(<object>x, cleanupNestedBrackets);
    } else if (typeof x === 'string') {
        return cleanupBrackets(<string>x);
    } else {
        return x;
    }
}

// foreach expressions use {{}} instead of {}
function handleForEach(value: object) {
    return mapValues(<object>value, (x: unknown) => {
        if (Array.isArray(x)) {
            return x.map(cleanupBrackets);
        } else {
            return cleanupBrackets(<string>x);
        }
    });
}
