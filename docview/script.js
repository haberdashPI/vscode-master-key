const names = [
    "⇧`", "`",
    "⇧1", "1",
    "⇧2", "2",
    "⇧3", "3",
    "⇧4", "4",
    "⇧5", "5",
    "⇧6", "6",
    "⇧7", "7",
    "⇧8", "8",
    "⇧9", "9",
    "⇧0", "0",
    "⇧-", "-",
    "⇧=", "=",
    "delete",
    "tab",
    "⇧Q", "Q",
    "⇧W", "W",
    "⇧E", "E",
    "⇧R", "R",
    "⇧T", "T",
    "⇧Y", "Y",
    "⇧U", "U",
    "⇧I", "I",
    "⇧O", "O",
    "⇧P", "P",
    "⇧[", "[",
    "⇧]", "]",
    "⇧\\", "\\",
    "caps lock",
    "⇧A", "A",
    "⇧S", "S",
    "⇧D", "D",
    "⇧F", "F",
    "⇧G", "G",
    "⇧H", "H",
    "⇧J", "J",
    "⇧K", "K",
    "⇧L", "L",
    "⇧;", ";",
    "⇧'", "'",
    "\n",
    "⇧",
    "⇧Z", "Z",
    "⇧X", "X",
    "⇧C", "C",
    "⇧V", "V",
    "⇧B", "B",
    "⇧N", "N",
    "⇧M", "M",
    "⇧,", ",",
    "⇧.", ".",
    "⇧/", "/",
    "⇧",
    " "
];
const allKeys = [
    "tilde", "tick",
    "bang", "1",
    "at", "2",
    "hash", "3",
    "dollar", "4",
    "percent", "5",
    "karat", "6",
    "amper", "7",
    "star", "8",
    "paren-left", "9",
    "paren-right", "0",
    "underscore", "-",
    "plus", "equals",
    "delete",
    'tab',
    "Q", "q",
    "W", "w",
    "E", "e",
    "R", "r",
    "T", "t",
    "Y", "y",
    "U", "u",
    "I", "i",
    "O", "o",
    "P", "p",
    "bracket-left", "brace-left",
    "bracket-right", "brace-right",
    "pipe", "back_slash",
    "caps-lock",
    "A", "a",
    "S", "s",
    "D", "d",
    "F", "f",
    "G", "g",
    "H", "h",
    "J", "j",
    "K", "k",
    "L", "l",
    "colon", "semicolon",
    'quote', "'",
    "return",
    "⇧left",
    "Z", "z",
    "X", "x",
    "C", "c",
    "V", "v",
    "B", "b",
    "N", "n",
    "M", "m",
    "karet-left", "comma",
    "karet-right", "period",
    "question", "slash",
    "⇧right",
    "space"
];

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
    for(i in allKeys){
        let name = document.getElementById('key-name-'+allKeys[i]);
        let label = document.getElementById('key-label-'+allKeys[i]);
        let detail = document.getElementById('key-detail-'+allKeys[i]);
        if(keymap && keymap[names[i]]){
            let binding = keymap[names[i]];
            name.innerHTML = binding.args.name;
            let kind = (kinds && kinds[binding.args.kind]) || {index: 'none', description: '', colorBlind: false}
            detail.innerHTML = `
                <div class="detail-text">
                    ${binding.args.kind ?
                        `${capitalizeFirstLetter(binding.args.kind)} command (<div class="detail-kind-color ${findColor(kind, config)}-opaque"></div>): `
                    : ''}
                    ${binding.args.description}
                </div>
                <div class="detail-kind">${kind.description}</div>
            `;
            detail.classList.remove('empty');
            if(kinds){
                setColor(name, kinds[binding.kind], config);
                setColor(label, kinds[binding.kind], config);
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
})
