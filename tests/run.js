// --- TESTS/RUN.JS ---
// Browser tests against the mocked Firebase (no live data is touched).
//   node tests/run.js                 run every scenario
//   node tests/run.js reset history   run scenarios whose name contains a word
//   node tests/run.js --shots         also save screenshots to tests/shots/
// Exit code 1 if any scenario fails.

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { startServer, openApp } = require('./harness');

const SHOTS = process.argv.includes('--shots');
const filters = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SHOT_DIR = path.join(__dirname, 'shots');
const DL_DIR = path.join(__dirname, 'downloads');

let base = '';
let browser = null;
const open = (opts) => openApp(browser, base, opts);
const shot = async (page, name, full = false) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), fullPage: full });
};
const toast = (page) => page.textContent('#toast-message');
const isAdminOn = (page) => page.evaluate(() => !document.getElementById('admin-logout-btn').classList.contains('hidden'));
const noWrites = async (page) => {
    const w = await page.evaluate(() => ({ tx: window.__tx.length, batch: window.__writes.length, audit: window.__audit.length }));
    assert.deepEqual(w, { tx: 0, batch: 0, audit: 0 }, 'expected no writes');
};

const scenarios = {
    // Status judged against the year-to-date pace (Q1 on 29/10/2026 = 25%)
    async 'dashboard pace and table'() {
        let { ctx, page } = await open({});
        assert.equal(await page.textContent('#stat-good'), '4');
        assert.equal(await page.textContent('#stat-ok'), '2');
        assert.equal(await page.textContent('#stat-bad'), '0');
        assert.match(await page.textContent('#pace-note-text'), /25% daripada sasaran tahunan/);
        await page.click('#view-toggle-btn'); await page.waitForTimeout(500);
        assert.equal(await page.$$eval('#kpi-table-body tr', r => r.length), 6);
        await shot(page, 'dashboard-table');
        await ctx.close();
        ({ ctx, page } = await open({ mobile: true }));
        await page.click('#actions-menu-btn'); await page.waitForTimeout(300);
        await page.click('#sheet-view-toggle-btn'); await page.waitForTimeout(500);
        const [vw, tw] = await page.evaluate(() => [innerWidth, document.querySelector('#kpi-table-container table').scrollWidth]);
        assert.ok(tw <= vw, `table ${tw}px wider than viewport ${vw}px`);
        await shot(page, 'mobile-table', true);
        await ctx.close();
    },

    // Reset / copy write only to the selected year, from the year before it
    async 'reset safety'() {
        let { ctx, page } = await open({ admin: true, with2025: true });
        await page.click('#re-clone-btn'); await page.waitForTimeout(300);
        assert.equal(await page.isDisabled('#confirm-modal-ok-btn'), true);
        await page.fill('#confirm-modal-input', '2025');
        assert.equal(await page.isDisabled('#confirm-modal-ok-btn'), true, 'wrong year must not unlock reset');
        await page.fill('#confirm-modal-input', '2026');
        assert.equal(await page.isDisabled('#confirm-modal-ok-btn'), false);
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#confirm-modal-ok-btn')]);
        assert.match(dl.suggestedFilename(), /^Sandaran_KPI_2026_/);
        await page.waitForTimeout(600);
        assert.deepEqual(await page.evaluate(() => window.__writes), ['kpi-2026/q1', 'kpi-2026/q2', 'kpi-2026/q3', 'kpi-2026/q4']);
        await ctx.close();

        // Viewing 2025: its source 2024 is empty, so nothing may be written
        ({ ctx, page } = await open({ admin: true, with2025: true }));
        await page.selectOption('#year-selector', '2025'); await page.waitForTimeout(1500);
        await page.click('#re-clone-btn'); await page.fill('#confirm-modal-input', '2025');
        await page.click('#confirm-modal-ok-btn'); await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__writes), []);
        assert.match(await toast(page), /Tiada data KPI 2024/);
        await ctx.close();

        // Empty 2027: "Salin Struktur" copies from 2026 into 2027 only
        ({ ctx, page } = await open({ admin: true }));
        await page.selectOption('#year-selector', '2027'); await page.waitForTimeout(1500);
        assert.equal(await page.textContent('#clone-btn-label'), 'Salin Struktur 2026');
        await page.click('#clone-prev-year-btn'); await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__writes), ['kpi-2027/q1', 'kpi-2027/q2', 'kpi-2027/q3', 'kpi-2027/q4']);
        await ctx.close();
    },

    // An empty year clears the table and footer and shows guest wording
    async 'year switch'() {
        const { ctx, page } = await open({ mobile: true });
        await page.click('#actions-menu-btn'); await page.waitForTimeout(300);
        await page.click('#sheet-view-toggle-btn'); await page.waitForTimeout(500);
        await page.selectOption('#year-selector', '2027'); await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => document.getElementById('kpi-table-container').classList.contains('hidden')), true);
        assert.equal((await page.textContent('#footer-note')).trim(), '');
        assert.equal(await page.textContent('#empty-state-title'), 'Data KPI 2027 Belum Tersedia');
        await page.selectOption('#year-selector', '2026'); await page.waitForTimeout(1800);
        assert.equal(await page.$$eval('#kpi-table-body tr', r => r.length), 6);
        await ctx.close();
    },

    // Breakdown is a horizontal bar chart; quarters not begun stay empty
    async 'charts'() {
        let { ctx, page } = await open({});
        await page.click('#show-overall-chart-btn'); await page.waitForTimeout(800);
        assert.equal(await page.textContent('#chart-modal-title'), 'Pecahan Pencapaian Suku Pertama');
        const cfg = await page.evaluate(() => { const c = Chart.getChart(document.getElementById('kpi-history-chart')); return { type: c.config.type, axis: c.options.indexAxis }; });
        assert.deepEqual(cfg, { type: 'bar', axis: 'y' });
        await shot(page, 'pecahan');
        await ctx.close();
        ({ ctx, page } = await open({ time: '2026-03-15T10:00:00' }));
        const future = await page.$$eval('.quarter-btn', bs => bs.map(b => b.classList.contains('quarter-future')));
        assert.deepEqual(future, [false, true, true, true]);
        await page.locator('.show-chart-btn').first().click(); await page.waitForTimeout(1200);
        const bars = await page.evaluate(() => Chart.getChart(document.getElementById('kpi-history-chart')).data.datasets.find(d => d.label === 'Pencapaian').data);
        assert.deepEqual(bars, [1450, null, null, null]);
        await ctx.close();
    },

    // Legacy events keep their look; editing one moves its status to the new field
    async 'takwim status'() {
        const { ctx, page } = await open({ admin: true });
        await page.click('#main-nav [data-view=takwim]'); await page.waitForTimeout(1200);
        await page.click('.takwim-edit-btn[data-id="e3"]'); await page.waitForTimeout(400);
        assert.equal(await page.inputValue('#takwim-status'), 'Ditangguhkan');
        assert.equal(await page.inputValue('#takwim-notes'), '');
        await page.fill('#takwim-notes', 'Ke Januari 2027');
        await page.click('#takwim-form button[type=submit]'); await page.waitForTimeout(800);
        const events = await page.evaluate(() => window.__tx[window.__tx.length - 1].d.events);
        const e3 = events.find(e => e.id === 'e3');
        assert.equal(e3.status, 'Ditangguhkan');
        assert.equal(e3.notes, 'Ke Januari 2027');
        const e4 = events.find(e => e.id === 'e4');
        assert.equal(e4.status, undefined, 'untouched legacy events must stay as they were');
        assert.equal(e4.notes, 'Selesai, minit diedarkan');
        await ctx.close();
    },

    // "Telah Berlangsung" shows the latest 3 until expanded
    async 'takwim collapse'() {
        const { ctx, page } = await open({ mobile: true });
        await page.click('#bottom-nav [data-view=takwim]'); await page.waitForTimeout(1200);
        const count = () => page.$$eval('#view-takwim .takwim-card', c => c.length);
        assert.equal(await count(), 7);
        assert.match(await page.textContent('#takwim-past-toggle'), /Tunjuk semua \(5\)/);
        await shot(page, 'takwim', true);
        await page.click('#takwim-past-toggle'); await page.waitForTimeout(300);
        assert.equal(await count(), 9);
        await ctx.close();
    },

    // Backup only reads; deletes and edits leave a copy in the audit log
    async 'backup and audit'() {
        const { ctx, page } = await open({ admin: true });
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#backup-download-btn')]);
        fs.mkdirSync(DL_DIR, { recursive: true });
        const file = path.join(DL_DIR, dl.suggestedFilename());
        await dl.saveAs(file);
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(Object.keys(json.years), ['2026']);
        assert.deepEqual(Object.keys(json.years['2026'].kpi), ['q1', 'q2', 'q3', 'q4']);
        await noWrites(page);

        await page.locator('.show-details-btn:visible').first().click(); await page.waitForTimeout(500);
        await page.locator('.delete-breakdown-item-btn').first().click(); await page.waitForTimeout(300);
        await page.click('#confirm-modal-ok-btn'); await page.waitForTimeout(800);
        let last = await page.evaluate(() => window.__audit[window.__audit.length - 1]);
        assert.equal(last.details.deleted.name, 'Sumbangan Majlis Makan Malam Alumni');
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);

        await page.locator('.edit-kpi-btn').first().click(); await page.waitForTimeout(400);
        await page.fill('#input-modal-field', '1500'); await page.click('#input-modal-ok-btn'); await page.waitForTimeout(800);
        last = await page.evaluate(() => window.__audit[window.__audit.length - 1]);
        assert.equal(last.details.oldValue, 1450);
        assert.equal(last.details.newValue, 1500);

        await page.locator('.settings-btn').nth(1).click(); await page.waitForTimeout(400);
        await page.click('#delete-kpi-btn'); await page.waitForTimeout(300);
        await page.click('#confirm-modal-ok-btn'); await page.waitForTimeout(800);
        last = await page.evaluate(() => window.__audit[window.__audit.length - 1]);
        assert.equal(last.action, 'DELETE_KPI');
        assert.deepEqual(Object.keys(last.details.deleted), ['q1', 'q2', 'q3', 'q4']);
        await ctx.close();
    },

    // SESSION persistence on login, idle logout after 30 minutes
    async 'admin session'() {
        let { ctx, page } = await open({});
        await page.click('#admin-login-btn');
        await page.fill('#email-input', 'a@upsi.edu.my'); await page.fill('#password-input', 'x');
        await page.press('#password-input', 'Enter'); await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__persist), ['session']);
        await ctx.close();

        ({ ctx, page } = await open({ admin: true, clock: 'install' }));
        assert.deepEqual(await page.evaluate(() => window.__persist), ['session']);
        await page.clock.runFor(27 * 60 * 1000);
        await page.mouse.click(700, 600);                       // activity resets the timer
        await page.clock.runFor(10 * 60 * 1000);
        assert.equal(await isAdminOn(page), true);
        await page.clock.runFor(18 * 60 * 1000 + 5000);
        assert.match(await toast(page), /dilog keluar dalam 2 minit/);
        const nav = page.waitForEvent('framenavigated', { timeout: 15000 }).catch(() => null);
        await page.clock.runFor(2 * 60 * 1000 + 5000);
        await nav; await page.clock.runFor(5000); await page.waitForTimeout(500);
        assert.equal(await isAdminOn(page), false);
        assert.match(await toast(page), /dilog keluar secara automatik/);
        await ctx.close();
    },

    // Wrong password message, then lockout after three tries
    async 'login form'() {
        const { ctx, page } = await open({ mobile: true });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.click('#admin-login-btn'); await page.waitForTimeout(500);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'email-input');
        await page.press('#email-input', 'Enter'); await page.waitForTimeout(200);
        assert.equal(await page.textContent('#login-feedback'), 'Sila isi emel dan kata laluan.');
        await page.fill('#email-input', 'a@upsi.edu.my');
        for (let i = 0; i < 3; i++) {
            await page.fill('#password-input', 'x');
            await page.press('#password-input', 'Enter'); await page.waitForTimeout(700);
        }
        assert.match(await page.textContent('#login-feedback'), /Terlalu banyak cubaan gagal/);
        assert.equal(await page.isDisabled('#password-input'), true);
        await ctx.close();
    },

    // Audit log viewer pages and never writes
    async 'history viewer'() {
        const { ctx, page } = await open({ admin: true });
        await page.click('#history-open-btn'); await page.waitForTimeout(800);
        assert.equal(await page.$$eval('#history-list li', l => l.length), 30);
        const first = await page.$eval('#history-list li', l => l.innerText);
        assert.match(first, /Kemaskini nilai/);
        assert.match(first, /4,600 → 4,900/);
        const second = await page.$$eval('#history-list li', l => l[1].innerText);
        assert.match(second, /RM 5,000/);
        await shot(page, 'history');
        await page.click('#history-more-btn'); await page.waitForTimeout(600);
        assert.equal(await page.$$eval('#history-list li', l => l.length), 36);
        await noWrites(page);
        await ctx.close();
    },

    // Firebase SDK unreachable: explain and offer a reload
    async 'boot error'() {
        const { ctx, page } = await open({ blockFirebase: true, mobile: true });
        assert.equal(await page.isVisible('#boot-error'), true);
        assert.equal(await page.isVisible('#admin-login-btn'), false);
        await ctx.close();
    },

    // PDF report is produced
    async 'pdf report'() {
        const { ctx, page } = await open({});
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#export-pdf-btn')]);
        fs.mkdirSync(DL_DIR, { recursive: true });
        const file = path.join(DL_DIR, dl.suggestedFilename());
        await dl.saveAs(file);
        assert.equal(fs.readFileSync(file).subarray(0, 4).toString(), '%PDF');
        await ctx.close();
    },
};

(async () => {
    const server = await startServer();
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    const names = Object.keys(scenarios).filter(n => !filters.length || filters.some(f => n.includes(f)));
    let failed = 0;
    for (const name of names) {
        const t0 = Date.now();
        try {
            await scenarios[name]();
            console.log(`PASS  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        } catch (e) {
            failed++;
            console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
        }
    }
    await browser.close();
    server.close();
    console.log(`\n${names.length - failed}/${names.length} passed`);
    process.exit(failed ? 1 : 0);
})();
