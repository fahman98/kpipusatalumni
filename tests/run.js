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

    // Phone: compact rows instead of cards, hero counts filter, row opens the KPI sheet
    async 'phone dashboard'() {
        let { ctx, page } = await open({ mobile: true });
        const visibleRows = () => page.$$eval('.kpi-row', r => r.filter(x => x.offsetParent !== null).length);
        assert.equal(await visibleRows(), 6);
        assert.equal(await page.$$eval('#kpi-grid-container > .kpi-card', c => c.filter(x => x.offsetParent !== null).length), 0);
        assert.deepEqual(await page.$$eval('.hero-count-num', n => n.map(x => x.textContent)), ['4', '2', '0']);
        assert.equal(await page.textContent('#hero-expected'), '25%');
        await shot(page, 'phone-dashboard', true);
        await page.click('.hero-count[data-filter="ok"]'); await page.waitForTimeout(200);
        assert.equal(await visibleRows(), 2);
        assert.equal(await page.textContent('#kpi-list-heading'), '2 daripada 6 petunjuk prestasi');
        assert.equal(await page.getAttribute('.hero-count[data-filter="ok"]', 'aria-pressed'), 'true');
        await page.click('.hero-count[data-filter="ok"]'); await page.waitForTimeout(200);
        assert.equal(await visibleRows(), 6);
        await page.locator('.kpi-row').nth(2).click(); await page.waitForTimeout(500);
        const actions = await page.$$eval('#focus-actions .focus-action', b => b.map(x => x.textContent.trim()));
        assert.deepEqual(actions, ['Butiran (1)', 'Sejarah prestasi']);
        await shot(page, 'phone-kpi-sheet');
        await page.click('#focus-actions .focus-action'); await page.waitForTimeout(600);
        assert.equal(await page.isVisible('#details-modal'), true, 'Butiran action opens the details modal');
        await ctx.close();

        ({ ctx, page } = await open({ mobile: true, admin: true }));
        await page.locator('.kpi-row').first().click(); await page.waitForTimeout(500);
        const adminActions = await page.$$eval('#focus-actions .focus-action', b => b.map(x => x.textContent.trim()));
        assert.ok(adminActions.includes('Kemaskini nilai') && adminActions.includes('Tetapan KPI'), adminActions.join(', '));
        await page.locator('#focus-actions .focus-action', { hasText: 'Kemaskini nilai' }).click(); await page.waitForTimeout(500);
        assert.equal(await page.isVisible('#input-modal'), true, 'Kemaskini nilai opens the value editor');
        await ctx.close();

        ({ ctx, page } = await open({}));
        assert.equal(await visibleRows(), 0, 'desktop keeps the cards');
        await ctx.close();
    },

    // Takwim filter chips and the "Hari ini" section
    async 'takwim filters'() {
        const { ctx, page } = await open({ mobile: true });
        await page.click('#bottom-nav [data-view=takwim]'); await page.waitForTimeout(1200);
        const chips = await page.$$eval('.takwim-chip', c => c.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
        assert.deepEqual(chips, ['Semua 9', 'Akan datang 2', 'Selesai 5', 'Ditangguhkan 1', 'Dibatalkan 1']);
        const headings = await page.$$eval('#view-takwim h3', h => h.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
        assert.match(headings[0], /^Hari Ini 1/);
        await shot(page, 'takwim-chips');
        const cards = () => page.$$eval('#view-takwim .takwim-card', c => c.length);
        await page.click('.takwim-chip[data-filter="berlangsung"]'); await page.waitForTimeout(200);
        assert.equal(await cards(), 5, 'the chip shows every past event, no collapse');
        assert.equal(await page.$('#takwim-past-toggle'), null);
        await page.click('.takwim-chip[data-filter="dibatalkan"]'); await page.waitForTimeout(200);
        assert.equal(await cards(), 1);
        await ctx.close();
    },

    // Penjanaan: balance to target and collection per quarter
    async 'penjanaan summary'() {
        const { ctx, page } = await open({ mobile: true });
        await page.click('#bottom-nav [data-view=penjanaan]'); await page.waitForTimeout(1500);
        const text = await page.textContent('#view-penjanaan');
        assert.match(text, /Baki untuk capai sasaran\s*RM 71,700\.00/);
        assert.match(text, /4 rekod bagi 2026/);
        const rows = await page.$$eval('.penjanaan-quarters .flex.justify-between', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
        assert.deepEqual(rows, ['Suku 1 · Jan - Mac RM 42,000.00', 'Suku 2 · Apr - Jun RM 15,000.00', 'Suku 3 · Jul - Sep RM 12,500.00', 'Suku 4 · Okt - Dis RM 8,800.00']);
        await shot(page, 'penjanaan-summary', true);
        await ctx.close();
    },

    // Admin redesign stage 1: "Perlu tindakan", value editor, delete preview.
    // Only dialogs are opened and cancelled: nothing may be written.
    async 'admin tools'() {
        let { ctx, page } = await open({ admin: true });
        assert.equal(await page.isVisible('#admin-todo'), false, 'nothing due with the default data');
        await ctx.close();

        ({ ctx, page } = await open({ admin: true, todos: true }));
        const rows = await page.$$eval('.admin-todo-row', r => r.map(x => [x.querySelector('.admin-todo-title').textContent, x.querySelector('.admin-todo-detail').textContent]));
        assert.deepEqual(rows, [
            ['Kehadiran belum direkod', 'Kembara Alumni Perak, 10/10/2026'],
            ['Tiada rekod penjanaan Suku 4', 'Rekod terakhir pada Julai 2026.'],
            ['Tiada aktiviti akan datang', 'Aktiviti terakhir dalam takwim bertarikh 12/09/2026.']
        ]);
        assert.equal(await page.textContent('#admin-todo-count'), '3');
        await shot(page, 'admin-todo');
        // Opens Butiran Kembara on a quarter that holds the programme
        await page.click('.admin-todo-row[data-todo=kehadiran] .admin-todo-action'); await page.waitForTimeout(2000);
        assert.equal(await page.isVisible('#details-modal'), true);
        assert.equal(await page.$eval('#pagination .active', e => e.dataset.quarter), '4');
        await page.click('#details-list .delete-breakdown-item-btn');
        assert.equal(await page.textContent('#confirm-modal-preview-title'), 'Kembara Alumni Sabah');
        assert.equal(await page.textContent('#confirm-modal-preview-meta'), '14/03/2026 · 120 hadir');
        assert.equal(await page.textContent('#confirm-modal-impact'), 'Jumlah terkumpul Suku 4 akan berubah daripada 3 kepada 2.');
        await page.click('#confirm-modal-cancel-btn');
        await noWrites(page);
        await ctx.close();

        ({ ctx, page } = await open({ admin: true, todos: true, mobile: true }));
        await page.click('.admin-todo-row[data-todo=takwim] .admin-todo-action'); await page.waitForTimeout(2000);
        assert.equal(await page.isVisible('#takwim-modal'), true, 'Tambah aktiviti opens the Takwim form');
        await ctx.close();

        // Value editor: running-total note, live preview, stepper
        ({ ctx, page } = await open({ admin: true }));
        await page.click('.kpi-card[data-kpi-id=pendaftaran] .edit-kpi-btn'); await page.waitForTimeout(300);
        assert.equal(await page.textContent('#input-modal-title'), 'Pendaftaran Alumni Baharu');
        assert.equal(await page.textContent('#input-modal-eyebrow'), 'Kemas kini nilai · Suku 1 2026');
        assert.match(await page.textContent('#input-modal-note-text'), /jumlah terkumpul sejak Januari/);
        assert.equal(await page.inputValue('#input-modal-field'), '1450');
        await page.click('#input-modal-plus');
        assert.equal(await page.inputValue('#input-modal-field'), '1451');
        await page.fill('#input-modal-field', '2500');
        assert.equal(await page.textContent('#input-modal-preview'), 'Sasaran tahunan 5,000 · pencapaian selepas simpan 50.0%');
        await shot(page, 'value-editor');
        await page.click('#input-modal-close');
        assert.equal(await page.isVisible('#input-modal'), false);

        // Penjanaan delete shows the record and the new year total
        await page.click('#main-nav [data-view=penjanaan]'); await page.waitForTimeout(1500);
        await page.locator('.penjanaan-delete-btn').first().click();
        assert.equal(await page.textContent('#confirm-modal-preview-title'), 'Sumbangan Majlis Makan Malam Alumni');
        assert.equal(await page.textContent('#confirm-modal-preview-meta'), 'RM 42,000.00 · Februari 2026 · Suku 1');
        assert.equal(await page.textContent('#confirm-modal-impact'), 'Jumlah terkumpul akan berubah daripada RM 78,300.00 kepada RM 36,300.00.');
        assert.equal(await page.textContent('#confirm-modal-ok-btn'), 'Padam rekod');
        await shot(page, 'delete-preview');
        await page.click('#confirm-modal-cancel-btn');

        // Takwim delete names the activity, date and place
        await page.click('#main-nav [data-view=takwim]'); await page.waitForTimeout(1200);
        await page.locator('.takwim-delete-btn').first().click();
        assert.match(await page.textContent('#confirm-modal-preview-meta'), /\d{1,2} \w+ 2026.* · /);
        await page.click('#confirm-modal-cancel-btn');
        await noWrites(page);
        assert.deepEqual(page.__errors, []);
        await ctx.close();
    },

    // Admin redesign stage 2: full-screen add forms. Saves go to the mock only.
    async 'admin forms'() {
        const { ctx, page } = await open({ admin: true, mobile: true });
        const lastItems = (kpiId) => page.evaluate((id) => {
            const t = window.__tx[window.__tx.length - 1];
            return t.d.kpis.find(k => k.id === id).details.items;
        }, kpiId);

        // Penjanaan: frequent-source chip, quarter hint, total after saving
        await page.click('#bottom-nav [data-view=penjanaan]'); await page.waitForTimeout(1500);
        await page.click('#penjanaan-add-btn'); await page.waitForTimeout(400);
        assert.equal(await page.textContent('#penjanaan-modal-subtitle'), 'Penjanaan dana 2026');
        assert.equal(await page.inputValue('#penjanaan-bulan'), '10', 'a new record starts on this month');
        assert.equal(await page.textContent('#penjanaan-quarter-hint'), 'Rekod ini masuk ke Suku 4.');
        const chips = await page.$$eval('#penjanaan-source-chips .fs-chip', c => c.map(x => x.textContent));
        assert.equal(chips.length, 4);
        await page.click('#penjanaan-source-chips .fs-chip >> nth=1');
        assert.equal(await page.inputValue('#penjanaan-sumber'), chips[1]);
        await page.fill('#penjanaan-jumlah', '1500');
        assert.match(await page.textContent('#penjanaan-summary'), /Selepas disimpan: RM 79,800\.00 \(53\.2%\)\. Baki RM 70,200\.00/);
        await page.selectOption('#penjanaan-bulan', '8');
        assert.equal(await page.textContent('#penjanaan-quarter-hint'), 'Rekod ini masuk ke Suku 3.');
        await shot(page, 'form-penjanaan');
        // Back closes the full-page form without saving
        await page.goBack(); await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => document.getElementById('penjanaan-modal').classList.contains('is-open')), false);
        assert.equal(await page.evaluate(() => window.__tx.length), 0);
        await page.click('#penjanaan-add-btn'); await page.waitForTimeout(400);
        await page.fill('#penjanaan-sumber', 'Tabung Alumni Care');
        await page.fill('#penjanaan-jumlah', '250');
        await page.click('#penjanaan-modal .form-sheet-save'); await page.waitForTimeout(1200);
        const pItems = await lastItems('pendanaan');
        const added = pItems.find(i => i.name === 'Tabung Alumni Care');
        assert.equal(added.value, 250);
        assert.equal(added.bulan, 10);

        // Takwim: status chosen from cards
        await page.click('#bottom-nav [data-view=takwim]'); await page.waitForTimeout(1200);
        await page.click('#takwim-add-btn'); await page.waitForTimeout(400);
        assert.equal(await page.$eval('input[name="takwim-status"]:checked', r => r.value), '', 'default follows the date');
        await page.fill('#takwim-title', 'Bengkel Kerjaya Alumni');
        await page.fill('#takwim-date', '2026-12-12');
        await page.click('.fs-radio:has(input[value="Ditangguhkan"])');
        await shot(page, 'form-takwim');
        await page.click('#takwim-modal .form-sheet-save'); await page.waitForTimeout(1200);
        const ev = await page.evaluate(() => window.__tx[window.__tx.length - 1].d.events.find(e => e.title === 'Bengkel Kerjaya Alumni'));
        assert.equal(ev.status, 'Ditangguhkan');
        assert.equal(ev.date, '2026-12-12');

        // Kembara: "Tambah program" opens the full form over Butiran
        await page.click('#bottom-nav [data-view=dashboard]'); await page.waitForTimeout(800);
        await page.locator('.kpi-row', { hasText: 'Kembara' }).click(); await page.waitForTimeout(500);
        await page.locator('#focus-actions .focus-action').first().click(); await page.waitForTimeout(800);
        await page.click('#add-program-btn'); await page.waitForTimeout(400);
        await page.fill('#program-name', 'Kembara Alumni Kuantan');
        await page.fill('#program-tarikh', '2026-08-15');
        await page.dispatchEvent('#program-tarikh', 'change');
        assert.match(await page.textContent('#program-info'), /masuk ke Suku 3 dan dikira sebanyak 1 program\. Sasaran tahunan: 8 program\./);
        await page.fill('#program-hadir', '64');
        await shot(page, 'form-program');
        await page.click('#program-modal .form-sheet-save'); await page.waitForTimeout(1200);
        const kItem = (await lastItems('kembara')).find(i => i.name === 'Kembara Alumni Kuantan');
        assert.deepEqual({ ...kItem, id: undefined }, { name: 'Kembara Alumni Kuantan', value: 1, bulan: 8, tarikh: '2026-08-15', hadir: 64, id: undefined });
        assert.equal(await page.evaluate(() => document.getElementById('details-modal').classList.contains('is-open')), true, 'Butiran stays open after saving');
        assert.deepEqual(page.__errors, []);
        await ctx.close();
    },

    // Butiran: full page on phones, overview on top, Back closes it
    async 'butiran page'() {
        const { ctx, page } = await open({ mobile: true });
        const openKembara = async () => {
            await page.locator('.kpi-row[data-kpi-id="kembara"]').click(); await page.waitForTimeout(400);
            await page.locator('#focus-actions .focus-action').first().click(); await page.waitForTimeout(600);
        };
        await openKembara();
        assert.equal(await page.isVisible('#details-modal'), true);
        const h = await page.$eval('#details-modal .modal-content', el => el.getBoundingClientRect().height);
        assert.ok(h >= 840, `full page expected, got ${h}px`);
        assert.equal(await page.textContent('#details-topbar-title'), 'Butiran KPI · Suku 1');
        const overview = await page.textContent('#details-overview');
        assert.match(overview, /Jumlah kehadiran\s*120 alumni/);
        assert.match(overview, /Rekod ikut suku/);
        await shot(page, 'butiran-page');
        await page.click('#details-back-btn'); await page.waitForTimeout(500);
        assert.equal(await page.evaluate(() => document.getElementById('details-modal').classList.contains('is-open')), false);
        await openKembara();
        await page.goBack(); await page.waitForTimeout(500);   // Android back gesture
        assert.equal(await page.evaluate(() => document.getElementById('details-modal').classList.contains('is-open')), false);
        assert.equal(await page.isVisible('#view-dashboard'), true, 'Back must stay in the app');
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
        assert.equal(await page.$eval('input[name="takwim-status"]:checked', r => r.value), 'Ditangguhkan');
        assert.equal(await page.inputValue('#takwim-notes'), '');
        await page.fill('#takwim-notes', 'Ke Januari 2027');
        await page.click('#takwim-modal .form-sheet-save'); await page.waitForTimeout(800);
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

    // Offline: the notice says when the data on screen was last fetched
    async 'offline notice'() {
        const { ctx, page } = await open({ mobile: true });
        assert.equal(await page.isVisible('#offline-banner'), false);
        await ctx.setOffline(true); await page.waitForTimeout(300);
        assert.equal(await page.isVisible('#offline-banner'), true);
        assert.match(await page.textContent('#offline-sync-text'), /29\/10\/2026, 10:00 PG/);
        await shot(page, 'offline');
        await ctx.setOffline(false); await page.waitForTimeout(300);
        assert.equal(await page.isVisible('#offline-banner'), false);
        await ctx.close();
    },

    // Install sheet on beforeinstallprompt; "Bukan sekarang" holds for the session
    async 'install sheet'() {
        const { ctx, page } = await open({ mobile: true });
        const fire = () => page.evaluate(() => {
            const e = new Event('beforeinstallprompt');
            e.prompt = () => { window.__prompted = true; };
            e.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(e);
        });
        await fire(); await page.waitForTimeout(400);
        assert.equal(await page.isVisible('#install-prompt'), true);
        await shot(page, 'install-sheet');
        await page.click('#install-app-btn'); await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => window.__prompted), true);
        assert.equal(await page.isVisible('#install-prompt'), false);
        await fire(); await page.waitForTimeout(300);
        await page.click('#install-close-btn'); await page.waitForTimeout(200);
        await fire(); await page.waitForTimeout(300);
        assert.equal(await page.isVisible('#install-prompt'), false, 'dismissed sheet must not come back this session');
        await ctx.close();
    },

    // iPhone Safari gets the three-step guide, arrow pointing at Share
    async 'ios install guide'() {
        const { ctx, page } = await open({
            mobile: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        });
        await page.waitForTimeout(800);
        assert.equal(await page.isVisible('#ios-install-modal'), true);
        assert.equal(await page.isVisible('.ios-guide-arrow'), true);
        await shot(page, 'ios-guide');
        await page.click('#ios-guide-ok'); await page.waitForTimeout(200);
        assert.equal(await page.isVisible('#ios-install-modal'), false);
        await ctx.close();
    },

    // Manifest shortcut ?tab=takwim opens straight on Takwim
    async 'shortcut deep link'() {
        const { ctx, page } = await open({ mobile: true, path: '/index.html?tab=takwim' });
        assert.equal(await page.isVisible('#view-takwim'), true);
        assert.equal(await page.isVisible('#view-dashboard'), false);
        assert.equal(await page.getAttribute('#bottom-nav [data-view=takwim]', 'aria-selected'), 'true');
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
