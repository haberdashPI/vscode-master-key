import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'out/test/unit/**/*.test.js',
    version: 'insiders',
    workspaceFolder: 'src/test/unit/unit-workspace/',
});
