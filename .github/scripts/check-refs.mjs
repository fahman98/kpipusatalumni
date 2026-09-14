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

const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const cspHeader = (vercel.headers || [])
    .flatMap((h) => h.headers || [])
    .find((h) => h.key === 'Content-Security-Policy');
const connectSrc = cspHeader
    ? (cspHeader.value.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src')) || '')
    : '';
const connectTokens = connectSrc.split(/\s+/).slice(1).map((t) => t.replace(/^(https|wss):\/\//, ''));

function connectAllowed(host) {
    return connectTokens.some((tok) => (tok.startsWith('*.') ? host.endsWith(tok.slice(1)) : tok === host));
}

const externalHosts = new Set();
for (const m of html.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)) {
    try { externalHosts.add(new URL(m[1]).hostname); } catch {}
}
const vendorStart = sw.indexOf('PRECACHE_VENDOR');
const vendorEnd = sw.indexOf('];', vendorStart);
for (const m of sw.slice(vendorStart, vendorEnd).matchAll(/'(https:\/\/[^']+)'/g)) {
    try { externalHosts.add(new URL(m[1]).hostname); } catch {}
}

for (const host of externalHosts) {
    if (!connectAllowed(host)) {
        console.error(`CSP connect-src is missing ${host} — the service worker's fetch() is governed by it`);
        failed = true;
    }
}

if (failed) process.exit(1);
console.log('All local references exist and CSP connect-src covers every external host.');
