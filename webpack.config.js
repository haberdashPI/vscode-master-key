/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/
/** @typedef {import('webpack').Configuration} options */

const path = require('path');
const webpack = require('webpack');

// TODO: we need to configure this so that ux tests are compiled in a node context; we can
// do this by exporting a function and passing an `--env` argument to webpack to select the
// appropriate configuration

/** @type WebpackConfig */
const uxtestConfig = {
    mode: 'none',
    target: 'es2020',
    entry: { 'test/suite/uxtests': './src/web/test/suite/index.uxtest.ts' },
    output: {
        filename: '[name].js',
        path: path.join(__dirname, './dist/uxtest'),
        library: { type: 'commonjs' },
        devtoolModuleFilenameTemplate: '../../[resource-path]',
        chunkFormat: 'commonjs'
    },
    resolve: {
        mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
        extensions: ['.ts', '.js'],
        fallback: {
            // Webpack 5 no longer polyfills Node.js core modules automatically.
            // see https://webpack.js.org/configuration/resolve/#resolvefallback
            // for the list of Node.js core module polyfills.
            'assert': require.resolve('assert'),
            'process/browser': require.resolve('process/browser')
        }
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{ loader: 'ts-loader' }]
        }]
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser', // provide a shim for the global `process` variable
        }),
    ],
    externals: {
        'vscode': 'commonjs vscode', // ignored because it doesn't exist
    },
    devtool: 'nosources-source-map', // create a source map that points to the original source file
    infrastructureLogging: {
        level: "log", // enables logging required for problem matchers
    },
};

/** @type WebpackConfig */
const webExtensionConfig = {
    mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
    target: 'webworker', // extensions run in a webworker context
    entry: {
        'extension': './src/web/extension.ts',
        'test/suite/index': './src/web/test/suite/index.ts',
    },
    output: {
        filename: '[name].js',
        path: path.join(__dirname, './dist/web'),
        library: { type: 'commonjs' },
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    },
    resolve: {
        mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
        extensions: ['.ts', '.js'], // support ts-files and js-files
        alias: {
            // provides alternate implementation for node module and source files
        },
        fallback: {
            // Webpack 5 no longer polyfills Node.js core modules automatically.
            // see https://webpack.js.org/configuration/resolve/#resolvefallback
            // for the list of Node.js core module polyfills.
            'assert': require.resolve('assert'),
            'process/browser': require.resolve('process/browser')
        }
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{
                loader: 'ts-loader'
            }]
        }]
    },
    plugins: [
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1 // disable chunks by default since web extensions must be a single bundle
        }),
        new webpack.ProvidePlugin({
            process: 'process/browser', // provide a shim for the global `process` variable
        }),
    ],
    externals: {
        'vscode': 'commonjs vscode', // ignored because it doesn't exist
    },
    performance: {
        hints: false
    },
    devtool: 'nosources-source-map', // create a source map that points to the original source file
    infrastructureLogging: {
        level: "log", // enables logging required for problem matchers
    },
};

module.exports = function(env, options){
    return env.uxtest ? uxtestConfig : webExtensionConfig;
};
