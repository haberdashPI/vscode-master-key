import fs from 'fs';
import path from 'path';

import { replaceMatchesWith, prettifyPrefix } from '../extension/key-utils';

const input = process.argv[2];
const output = process.argv[3];
const content = fs.readFileSync(path.resolve(input), 'utf8');
const regex = /<key>(.*?)<\/key>/gs;
const prettyKey = replaceMatchesWith(content, regex, (str) => {
    return prettifyPrefix(str);
});

console.log(`Cleaning up key appearance ${output}`);
fs.writeFileSync(output, prettyKey);
