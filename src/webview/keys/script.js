/* globals window, document */

function findColor(kind, config) {
    if (!kind) {
        return 'kind-color-none';
    }
    if (config.colorBlind) {
        const i = kind.index % 5;
        return `kind-color-blind-${i}`;
    } else {
        const i = kind.index % 8;
        return `kind-color-${i}`;
    }
}

function setColor(element, kind, config) {
    let oldcolor = undefined;
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
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

window.addEventListener('message', (event) => {
    const message = event.data;
    const keymap = message.keymap;
    const kinds = message.kinds;
    const config = message.config;
    // const keyRows = message.keyRows;

    // update keys
    let i = 0;
    for (const key of keymap) {
        const name = document.getElementById('key-name-' + i);
        const label = document.getElementById('key-label-' + i);
        const detail = document.getElementById('key-detail-' + i);
        i++;

        if (name && key && !key.empty) {
            label.innerHTML = key.label || '';
            const args = key.args || { name: '', kind: '', description: '' };
            name.innerHTML = args.name;
            const kind = (kinds && kinds[args.kind]) || {
                index: 'none',
                description: '',
                colorBlind: false,
            };
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
            if (kinds) {
                setColor(name, kinds[args.kind], config);
                setColor(label, kinds[args.kind], config);
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
