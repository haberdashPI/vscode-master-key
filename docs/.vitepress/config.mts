import { defineConfig } from 'vitepress';
import {
    commandItems,
    userCommandItems,
} from './commands.mjs'; // auto generated file (see .simple-src-docs.config.toml)
import {
    bindingItems,
} from './bindings.mjs'; // auto generated file (see .simple-src-docs.config.toml)

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: 'Master Key',
    srcExclude: ['templates/**/*.md'],
    description: 'Powerful VSCode Keybinding Customization',
    base: '/vscode-master-key/',
    themeConfig: {
        search: { provider: 'local' },
        logo: '../../logo.png',
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            { text: 'User Guide', link: '/guide' },
            { text: 'Bindings', link: '/bindings' },
            { text: 'Commands', link: '/commands' },
        ],

        sidebar: [
            { text: 'Home', link: '/' },
            { text: 'User Guide', link: '/guide' },
            {
                text: 'Keybindings',
                items: [
                    { text: 'Overview', link: '/bindings' },
                    ...bindingItems,
                ],
            },
            {
                text: 'Commands',
                items: [
                    { text: 'Overview', link: '/commands' },
                    {
                        text: 'User Commands',
                        items: userCommandItems.sort((a, b) => {
                            if (a.text < b.text) {
                                return -1;
                            } else if (a.text == b.text) {
                                return 0;
                            } else {
                                return 1;
                            }
                        }),
                    },
                    {
                        text: 'Keybinding Commands',
                        items: commandItems.sort((a, b) => {
                            if (a.text < b.text) {
                                return -1;
                            } else if (a.text == b.text) {
                                return 0;
                            } else {
                                return 1;
                            }
                        }),
                    },
                ],
            },
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/haberdashPI/vscode-master-key' },
        ],
    },
});
