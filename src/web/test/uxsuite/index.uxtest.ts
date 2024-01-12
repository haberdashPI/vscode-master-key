require('mocha/mocha');

// Bundles all files in the current directory matching `*.test`
const importAll = (r: __WebpackModuleApi.RequireContext) => r.keys().forEach(r);
importAll(require.context('.', true, /\.uxtest$/));
