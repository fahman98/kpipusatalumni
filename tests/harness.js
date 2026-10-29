// --- TESTS/HARNESS.JS ---
// Shared setup for the browser tests: serves the repo from a local HTTP
// server, swaps the Firebase SDK for tests/mock-firebase.js, serves the CDN
// libraries from tests/node_modules (the sandbox proxy blocks CDNs), and
// pins the clock so date-dependent behaviour is repeatable.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(__dirname, 'node_modules');
// Every expectation in run.js assumes this date
const DEFAULT_TIME = '2026-10-29T10:00:00';

const TYPES = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};

function startServer() {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); return res.end();
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// opts:
//   admin, with2025      mock flags (see mock-firebase.js)
//   mobile               390x844 touch viewport instead of 1366x900
//   time                 ISO string; null leaves the real clock alone
//   clock                'fixed' (Date pinned, timers run) | 'install' (fully
//                        fake, advance with page.clock.runFor)
//   blockFirebase        abort the SDK requests (boot-error path)
//   dark                 prefers-color-scheme: dark
async function openApp(browser, base, opts = {}) {
    const {
        admin = false, with2025 = false, mobile = false, time = DEFAULT_TIME,
        clock = 'fixed', blockFirebase = false, dark = false
    } = opts;
    const ctx = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
        isMobile: mobile, hasTouch: mobile, acceptDownloads: true,
        colorScheme: dark ? 'dark' : 'light'
    });
    await ctx.addInitScript(([a, w]) => { window.__ADMIN = a; window.__WITH2025 = w; }, [admin, with2025]);
    await ctx.route('**/*', async (route) => {
        const u = route.request().url();
        if (u === base + '/' || u.startsWith(base + '/index.html')) {
            // SRI hashes would reject the mock and the locally served libraries
            const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\s+integrity="[^"]+"/g, '');
            return route.fulfill({ body: html, contentType: 'text/html' });
        }
        if (u.startsWith(base)) return route.continue();
        if (u.includes('firebasejs')) {
            if (blockFirebase) return route.abort();
            if (u.includes('firebase-app.js')) return route.fulfill({ path: path.join(__dirname, 'mock-firebase.js'), contentType: 'application/javascript' });
            return route.fulfill({ body: '', contentType: 'application/javascript' });
        }
        if (u.includes('chart.umd')) return route.fulfill({ path: path.join(NM, 'chart.js/dist/chart.umd.js'), contentType: 'application/javascript' });
        if (u.includes('jspdf.umd')) return route.fulfill({ path: path.join(NM, 'jspdf/dist/jspdf.umd.min.js'), contentType: 'application/javascript' });
        if (u.includes('autotable')) return route.fulfill({ path: path.join(NM, 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js'), contentType: 'application/javascript' });
        let m;
        if ((m = u.match(/font-awesome\/6\.5\.2\/(.*)$/))) return route.fulfill({ path: path.join(NM, '@fortawesome/fontawesome-free', m[1]) });
        if ((m = u.match(/@phosphor-icons\/web@2\.1\.1\/(.*)$/))) return route.fulfill({ path: path.join(NM, '@phosphor-icons/web', m[1]) });
        return route.abort();   // fonts and anything else external
    });
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    if (time) {
        if (clock === 'install') await page.clock.install({ time: new Date(time) });
        else await page.clock.setFixedTime(new Date(time));
    }
    await page.goto(base + '/');
    if (time && clock === 'install') await page.clock.runFor(4000);
    else await page.waitForTimeout(3000);
    return { ctx, page };
}

module.exports = { startServer, openApp, DEFAULT_TIME };
