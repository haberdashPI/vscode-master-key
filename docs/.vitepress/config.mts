import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: "Master Key",
    description: "Powerful VSCode Keybinding Customization",
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            { text: 'User Guide', link: '/guide' },
            { text: 'Bindings', link: '/bindings' },
            { text: 'Commands', link: '/commands' }
        ],

        sidebar: [
            { text: 'Home', link: '/' },
            { text: 'User Guide', link: '/guide' },
            {
                text: 'Keybindings',
                items: [
                    { text: 'Overview', link: '/bindings' },
                    { text: 'Header`', link: '/bindings/header' },
                    { text: 'Bind', link: '/bindings/bind' },
                    { text: 'Mode', link: '/bindings/mode' },
                    { text: 'Default', link: '/bindings/default' },
                    { text: 'Kind', link: '/bindings/kind' },
                ]
            },
            { text: 'Commands', link: '/commands' }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
        ]
    }
})
