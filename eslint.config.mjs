import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import stylistic from '@stylistic/eslint-plugin';

export default defineConfig([
    stylistic.configs.customize({
        indent: 4,
        quotes: 'single',
        semi: true,
        braceStyle: '1tbs',
    }),
    globalIgnores([
        'src/rust/parsing/lib/**/*.{js,ts,t.ds}',
        'out/**/*.js',
        'src/oldtest/**',
        'docs/.vitepress/theme/**/*.{js,ts,t.ds}',
    ]),
    {
        rules: {
            '@stylistic/max-len': ['error', { code: 92 }],
            '@stylistic/dot-location': ['error', 'object'],
            '@stylistic/no-tabs': 'error',
            '@stylistic/operator-linebreak': ['error', 'after'],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
        },
        files: ['**/*.{js,mjs,cjs,ts,mts,cts,yml}'],
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
            sourceType: 'commonjs',
        },
    },
    tseslint.configs.recommended,
]);
