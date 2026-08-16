interface KindInfo {
    index: number | string;
    description: string;
    colorBlind?: boolean;
}

interface ConfigInfo {
    colorBlind?: boolean;
}

interface KeyBindingInfo {
    label?: string;
    name?: string;
    kind?: string;
    description?: string;
    empty?: boolean;
}

interface VisualDocMessage {
    keymap: KeyBindingInfo[];
    kinds?: Record<string, KindInfo>;
    config?: ConfigInfo;
}

function findColor(kind?: KindInfo, config?: ConfigInfo): string {
    if (!kind) {
        return 'kind-color-none';
    }
    const idx = typeof kind.index === 'number' ? kind.index : 0;
    if (config?.colorBlind) {
        const i = idx % 5;
        return `kind-color-blind-${i}`;
    } else {
        const i = idx % 8;
        return `kind-color-${i}`;
    }
}

function setColor(element: HTMLElement, kind?: KindInfo, config?: ConfigInfo) {
    let oldcolor: string | undefined = undefined;
    for (const className of element.classList.values()) {
        if (className.match(/kind-color/)) {
            oldcolor = className;
            break;
        }
    }
    if (oldcolor) {
        element.classList.remove(oldcolor);
    }
    element.classList.add(findColor(kind, config));
}

function capitalizeFirstLetter(string: string): string {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

window.addEventListener('message', (event: MessageEvent<VisualDocMessage>) => {
    const message = event.data;
    const keymap = message.keymap;
    const kinds = message.kinds;
    const config = message.config;

    // update keys
    let i = 0;
    for (const key of keymap) {
        const name = document.getElementById('key-name-' + i);
        const label = document.getElementById('key-label-' + i);
        const detail = document.getElementById('key-detail-' + i);
        i++;

        if (name && key && !key.empty) {
            if (label) {
                label.innerHTML = key.label || '';
            }
            const args = {
                name: key.name || '',
                kind: key.kind || '',
                description: key.description || '',
            };
            name.innerHTML = args.name;
            const kind = (kinds && args.kind && kinds[args.kind]) || {
                index: 'none',
                description: '',
                colorBlind: false,
            };
            if (detail) {
                detail.innerHTML = `
                <div class="detail-text">
                    ${
                        args.kind ?
                            `${capitalizeFirstLetter(args.kind)} command (` +
                            `<div class="detail-kind-color ${findColor(kind, config)}-` +
                            `opaque"></div>): ` :
                            ''
                    }
                    ${args.description}
                </div>
                <div class="detail-kind">${kind.description}</div>
            `;
                detail.classList.remove('empty');
            }
            if (kinds && args.kind) {
                setColor(name, kinds[args.kind], config);
                if (label) {
                    setColor(label, kinds[args.kind], config);
                }
            }
        } else {
            if (detail) {
                detail.innerHTML = '';
                detail.classList.add('empty');
            }
            if (name) {
                name.innerHTML = '';
                setColor(name);
            }
            if (label) {
                label.innerHTML = '';
                setColor(label);
            }
        }
    }
});
