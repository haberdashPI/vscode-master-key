
function findColor(kind, config){
    if(!kind){
        return 'kind-color-none';
    }
    if(config.colorBlind){
        let i = (kind.index) % 5;
        return `kind-color-blind-${i}`;
    }else{
        let i = (kind.index) % 8;
        return `kind-color-${i}`;
    }
}

function setColor(element, kind, config){
    let oldcolor = undefined;
    for(let className of element.classList.values()){
        if(className.match(/kind-color/)){
            oldcolor = className;
            break;
        }
    }
    if(oldcolor){ element.classList.remove(oldcolor); }
    element.classList.add(findColor(kind, config));
}
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

window.addEventListener('message', event => {
    const message = event.data;
    let keymap = message.keymap;
    let kinds = message.kinds;
    let config = message.config;

    // update keys
    let i = 0;
    for(let key of keymap){
        let name = document.getElementById('key-name-'+i);
        let label = document.getElementById('key-label-'+i);
        let detail = document.getElementById('key-detail-'+i);
        i++;

        if(name && key && !key.empty){
            name.innerHTML = key.args.name;
            let kind = (kinds && kinds[key.args.kind]) || {index: 'none', description: '', colorBlind: false};
            detail.innerHTML = `
                <div class="detail-text">
                    ${key.args.kind ?
                        `${capitalizeFirstLetter(key.args.kind)} command (<div class="detail-kind-color ${findColor(kind, config)}-opaque"></div>): `
                    : ''}
                    ${key.args.description}
                </div>
                <div class="detail-kind">${kind.description}</div>
            `;
            detail.classList.remove('empty');
            if(kinds){
                setColor(name, kinds[key.args.kind], config);
                setColor(label, kinds[key.args.kind], config);
            }
        }else{
            if(detail){
                detail.innerHTML = "";
                detail.classList.add('empty');
            }
            if(name){
                name.innerHTML = "";
                setColor(name);
            }
            if(label){ setColor(label); }
        }
    }
});
