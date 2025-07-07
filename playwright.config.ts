import { defineConfig } from '@playwright/test';
import { TestOptions } from './src/test/integration/config';

export default defineConfig<void, TestOptions>({
    testDir: './src/test/integration',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: { trace: 'on-first-retry' },
    timeout: 5 * 60_000,
    globalSetup: './src/test/integration/setup',
    projects: [
        {
            name: 'VSCode insiders',
            use: {
                vscodeVersion: 'insiders',
            },
        },
    ],
});
