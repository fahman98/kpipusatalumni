import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
let failed = false;

function check(ref, source) {
    if (typeof ref !== 'string' || !ref.startsWith('./')) return;
    const clean = ref.split('?')[0].split('#')[0];
    if (clean === './' || clean.endsWith('/')) return;
    if (!existsSync(resolve(root, clean))) {
        console.error(`MISSING ${clean} (referenced in ${source})`);
        failed = true;
    }
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) check(m[1], 'index.html');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
for (const icon of manifest.icons || []) check(icon.src, 'manifest.json');

const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listStart = sw.indexOf('PRECACHE_ASSETS');
const listEnd = sw.indexOf('];', listStart);
if (listStart === -1 || listEnd === -1) {
    console.error('Could not locate PRECACHE_ASSETS in sw.js');
    process.exit(1);
}
for (const m of sw.slice(listStart, listEnd).matchAll(/'([^']+)'/g)) check(m[1], 'sw.js');

if (failed) process.exit(1);
console.log('All local references exist.');
