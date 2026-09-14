import { readFileSync } from 'node:fs';

const src = readFileSync('firestore.rules', 'utf8');
const stripped = src.replace(/\/\/.*$/gm, '');

let depth = 0;
for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') {
        depth--;
        if (depth < 0) {
            console.error('Unbalanced braces: closing brace with no opener');
            process.exit(1);
        }
    }
}
if (depth !== 0) {
    console.error(`Unbalanced braces: ${depth} unclosed block(s)`);
    process.exit(1);
}
if (!/rules_version\s*=\s*'2'/.test(stripped)) {
    console.error("Missing rules_version = '2'");
    process.exit(1);
}
if (!/service\s+cloud\.firestore/.test(stripped)) {
    console.error('Missing service cloud.firestore');
    process.exit(1);
}
console.log('firestore.rules basic structure OK.');
