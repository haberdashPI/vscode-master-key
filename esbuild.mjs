import { context } from 'esbuild';
import * as path from 'path';
import * as glob from 'glob';
import * as polyfill from '@esbuild-plugins/node-globals-polyfill';
import esbuildPluginIstanbul from 'esbuild-plugin-istanbul';

const release = process.argv.includes('--release');
const watch = process.argv.includes('--watch');
const coverage = process.argv.includes('--coverage');

/**
 * Format esbuild output so that it can be parsed by the esbuild problem matcher
 *
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

/**
 * Bundle all tests, including the test runner, into
 * a single module that has a exported `run` function .
 * @type {import('esbuild').Plugin}
 */
const webTestBundlePlugin = {
    name: 'webTestBundlePlugin',
    setup(build) {
        build.onResolve({ filter: /[\/\\]webExtensionTests\.ts$/ }, (args) => {
            if (args.kind === 'entry-point') {
                return { path: path.resolve(args.path) };
            }
        });
        build.onLoad({ filter: /[\/\\]webExtensionTests\.ts$/ }, async () => {
            const testsRoot = path.join(
                import.meta.url,
                '..', 'src/test/unit/',
            );
            const files = await glob.glob('*.test.ts', {
                cwd: testsRoot.split('file:')[1], posix: true,
            });
            const contents = `
                    export { run } from './webTestRunner.ts';
                    ${files.map(f => `import('./${f}');`).join('')}
                `;
            return {
                contents: contents,
                watchDirs: files.map(f => path.dirname(path.resolve(testsRoot, f))),
                watchFiles: files.map(f => path.resolve(testsRoot, f)),
            };
        });
    },
};

const web = process.argv.includes('--web');

async function main() {
    const ctx = await context({
        entryPoints: web && !release ?
                ['src/extension/index.ts', 'src/test/unit/webExtensionTests.ts'] :
                ['src/extension/index.ts'],
        bundle: true,
        format: 'cjs',
        minify: release,
        sourcemap: !release,
        sourcesContent: false,
        platform: web ? 'browser' : 'node',
        entryNames: '[name]',
        outdir: web ? 'out/browser' : 'out/node',
        external: ['vscode'],
        logLevel: 'silent',
        define: {
            'process.env.COVERAGE': coverage ? 'true' : 'false',
            ...(web && !release ? { global: 'globalThis' } : {}),
        },
        plugins: [
            ...(web && !release ?
                    [
                        polyfill.NodeGlobalsPolyfillPlugin({
                            process: true,
                            buffer: true,
                        }),
                        webTestBundlePlugin,
                    ] :
                    []),
            ...(coverage ?
                    esbuildPluginIstanbul({
                        filter: /\.[cm]?ts$/,
                        loader: 'ts',
                        name: 'istanbul-loader-ts',
                    }) :
                    []),
            esbuildProblemMatcherPlugin,
        ],
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
