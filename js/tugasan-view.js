// --- JS/TUGASAN-VIEW.JS ---
// The admin-only "Tugasan" tab (canvas "Redesign KPI Pusat Alumni",
// artboards Tugasan-Desktop / -Tablet / -Phone-* and Tugasan-*-PIC):
// four summary cards that filter, the robot's last run, and two views:
//   Ikut program  every dated programme of Kembara / Bicara / Ziarah; on
//                 desktop (>= 1024px) the chosen one is edited in a panel
//                 beside the list, below that a row opens the full-page
//                 "Agih tugasan" sheet (tugasan.js, the same editor)
//   Ikut PIC      one card per staff member with their open tasks
// Reads only (q4 + the tugasan collection); every save goes through the
// editor and the staff sheet in tugasan.js. Agreed with the owner: no
// "Emel peringatan" button (the robot already reminds), app font instead of
// Manrope, native date pickers, Butiran's "Dokumen" button stays.

import { getQuarterOnce, getTugasanYear } from './api.js';
import { escapeHtml, showConfirmModal } from './ui.js';
import {
    cache, loadTugasan, TUGASAN_KPI_IDS, findProgram, programKey, summarizeTasks,
    taskState, dueLabel, isoToDmy, programDates, inAssignWindow, daysBetween, todayKey,
    safeLink, robotStatusText, setTugasanBadge, mountEditor, openTugasanSheet, openStafSheet
} from './tugasan.js';

const desktopQuery = window.matchMedia('(min-width: 1024px)');
const STATUS_ORDER = { lewat: 0, belum: 1, agih: 2, selesai: 3, tiada: 4 };

const state = {
    container: null, year: null, q4: null, entries: [],
    mode: 'program', filter: 'semua', picFilter: 'semua',
    selectedKey: null, expanded: new Set(), pending: null, token: 0, prevLate: 0
};

// "Perlu tindakan" buttons: open the tab with a filter
export function showTugasan(opts = {}) {
    state.pending = opts;
    if (typeof window.switchView === 'function') window.switchView('tugasan');
}

// Nav tabs exist for everyone in the markup; only the admin sees them
export function syncTugasanNav(isAdmin) {
    document.querySelectorAll('.tugasan-nav').forEach(el => el.classList.toggle('hidden', !isAdmin));
}

export async function initTugasan(container, isAdmin, year) {
    if (!container) return;
    state.container = container;
    if (!isAdmin) { container.innerHTML = ''; return; }
    if (state.pending) {
        state.mode = 'program';
        state.filter = state.pending.filter || 'semua';
        state.pending = null;
    }
    if (String(year) !== state.year) { state.selectedKey = null; state.expanded.clear(); }
    state.year = String(year);
    container.innerHTML = `<div class="tgv-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Memuatkan tugasan...</div>`;
    await reload();
}

async function reload() {
    const token = ++state.token;
    // In the current year, last year's late tasks still matter (a December
    // programme's report is due in January): count them for a note
    const thisYear = String(new Date().getFullYear());
    const [data, q4, prev] = await Promise.all([loadTugasan(true), getQuarterOnce('q4'),
        state.year === thisYear ? getTugasanYear(String(Number(thisYear) - 1)) : Promise.resolve(null)]);
    if (token !== state.token || !state.container) return;
    const today = todayKey();
    state.prevLate = Array.isArray(prev)
        ? prev.reduce((n, p) => n + ((p && p.tasks) || []).filter(t => taskState(t, today) === 'lewat').length, 0) : 0;
    if (data.programs === null || data.staf === null) {
        state.container.innerHTML = `<div class="tgv-loading">Tugasan tidak dapat dibaca. Semak sambungan internet dan cuba lagi.</div>`;
        return;
    }
    state.q4 = q4;
    rebuild();
}

function rebuild() {
    state.entries = buildEntries(state.q4);
    render();
}

function buildEntries(q4) {
    const today = todayKey();
    const out = [];
    ((q4 && q4.kpis) || []).filter(k => TUGASAN_KPI_IDS.has(k.id)).forEach(kpi => {
        const items = (kpi.details && Array.isArray(kpi.details.items)) ? kpi.details.items : [];
        items.forEach(item => {
            if (!item || !item.tarikh) return;
            const prog = findProgram(cache.programs, item, kpi.id);
            const tasks = prog && Array.isArray(prog.tasks) ? prog.tasks : [];
            const s = summarizeTasks(tasks, today);
            let status;
            if (s.lewat) status = 'lewat';
            else if (!s.total) status = inAssignWindow(item, today) ? 'agih' : 'tiada';
            else if (s.selesai === s.total) status = 'selesai';
            else status = 'belum';
            out.push({ key: `${kpi.id}|${programKey(item)}`, kpi, item, prog, tasks, s, status });
        });
    });
    return out.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
        || String(b.item.tarikh).localeCompare(String(a.item.tarikh)));
}

function totals() {
    const t = { lewat: 0, belum: 0, selesai: 0, agih: 0 };
    state.entries.forEach(e => {
        t.lewat += e.s.lewat; t.belum += e.s.belum; t.selesai += e.s.selesai;
        if (e.status === 'agih') t.agih++;
    });
    return t;
}

const PROG_FILTERS = {
    semua: () => true,
    lewat: e => e.status === 'lewat',
    belum: e => e.s.belum > 0,
    agih: e => e.status === 'agih',
    selesai: e => e.status === 'selesai'
};

const editorEl = () => state.container && state.container.querySelector('.tgv-editor');
const isDirty = () => { const el = editorEl(); return !!(el && el.dataset.dirty); };

// Leaving an edited panel asks first (nothing is saved until "Simpan perubahan")
function guard(next) {
    if (!isDirty()) { next(); return; }
    showConfirmModal('Buang perubahan?', 'Perubahan pada tugasan program ini belum disimpan.', next,
        { okLabel: 'Buang perubahan' });
}

// ---- Rendering ---------------------------------------------------------
function initials(nama) {
    return String(nama || '?').trim().split(/\s+/).filter(w => !/^(bin|binti|bt|b\.)$/i.test(w))
        .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function robotLine() {
    const r = cache.robot;
    if (!r || !r.lastRun) return `<p class="tgv-robot" data-tone="off" role="status"><span class="tgv-dot" aria-hidden="true"></span><span><strong>Robot belum berjalan.</strong> Folder, emel dan tanda selesai automatik bermula selepas robot dipasang.</span></p>`;
    const text = robotStatusText(r);
    if (r.ok === false) return `<p class="tgv-robot" data-tone="bad" role="status"><span class="tgv-dot" aria-hidden="true"></span><span><strong>Robot gagal.</strong> ${escapeHtml(text.replace(/^Robot gagal /, 'Larian '))}</span></p>`;
    const hours = (Date.now() - new Date(r.lastRun).getTime()) / 3600000;
    if (hours > 36) return `<p class="tgv-robot" data-tone="warn" role="status"><span class="tgv-dot" aria-hidden="true"></span><span><strong>Robot tidak berjalan pagi ini.</strong> ${escapeHtml(robotStatusText(r, false))} Semak pencetus dalam Apps Script.</span></p>`;
    return `<p class="tgv-robot" data-tone="ok" role="status"><span class="tgv-dot" aria-hidden="true"></span><span><strong>Robot aktif.</strong> ${escapeHtml(text.replace(/^Robot terakhir berjalan pada/, 'Terakhir berjalan'))}</span></p>`;
}

function cardsHtml(t) {
    const card = (key, tone, label, n, note) => `
        <button type="button" class="tgv-card" data-card="${key}" data-tone="${tone}" aria-pressed="${state.mode === 'program' && state.filter === key}">
            <span class="tgv-card-label">${label}</span>
            <span class="tgv-card-num">${n}</span>
            <span class="tgv-card-note">${note}</span>
        </button>`;
    return `<section class="tgv-cards" aria-label="Ringkasan tugasan">
        ${card('lewat', 'late', 'Lewat', t.lewat, 'Melepasi tarikh akhir dan belum selesai')}
        ${card('belum', 'open', 'Belum siap', t.belum, 'Masih dalam tempoh')}
        ${card('selesai', 'done', 'Selesai', t.selesai, 'Dokumen telah diterima')}
        ${card('agih', 'none', 'Belum diagih', t.agih, 'Program tanpa sebarang tugasan')}
    </section>`;
}

function chip(tone, text) {
    return `<span class="tgv-chip" data-tone="${tone}">${escapeHtml(text)}</span>`;
}

function whenText(item) {
    const today = todayKey();
    const d = daysBetween(today, item.tarikh);
    const end = item.tarikhTamat || item.tarikh;
    if (d > 0) return `${d} hari lagi`;
    if (end >= today) return 'Sedang berlangsung';
    return 'Sudah berlangsung';
}

function progMeta(e) {
    const parts = [e.kpi.name, programDates(e.item)];
    if (e.s.total) parts.push(`Dokumen ${e.s.selesai}/${e.s.total}`);
    else if (daysBetween(todayKey(), e.item.tarikh) > 0) parts.push(whenText(e.item));
    return parts.join(' · ');
}

function progChip(e) {
    switch (e.status) {
        case 'lewat': return chip('late', `${e.s.lewat} lewat`);
        case 'belum': return chip('open', 'Dalam tempoh');
        case 'agih': return chip('none', 'Belum diagih');
        case 'selesai': return chip('done', 'Selesai');
        default: return chip('muted', 'Tiada tugasan');
    }
}

function programListHtml(list, selectedKey) {
    if (!state.entries.length) {
        return `<p class="tgv-empty">Tiada program bertarikh dalam KPI Kembara, Bicara atau Ziarah bagi tahun ${escapeHtml(state.year)}.</p>`;
    }
    if (!list.length) return `<p class="tgv-empty">Tiada program dalam tapisan ini.</p>`;
    return `<ul class="tgv-list">${list.map(e => {
        const pct = e.s.total ? Math.round((e.s.selesai / e.s.total) * 100) : 0;
        const bar = e.s.total ? `<span class="tgv-bar" aria-hidden="true"><span style="width:${Math.max(pct, 2)}%" data-full="${pct === 100}"></span></span>` : '';
        return `<li><button type="button" class="tgv-prog" data-key="${escapeHtml(e.key)}"${e.key === selectedKey ? ' aria-current="true"' : ''}>
            <span class="tgv-prog-top"><span class="tgv-prog-name">${escapeHtml(e.item.name || '')}</span>${progChip(e)}</span>
            <span class="tgv-prog-meta">${escapeHtml(progMeta(e))}</span>${bar}
        </button></li>`;
    }).join('')}</ul>`;
}

function panelHtml(e) {
    if (!e) return `<section class="tgv-panel" aria-label="Program dipilih"><p class="tgv-empty">Pilih satu program untuk mengagih tugasan.</p></section>`;
    const folder = e.prog && e.prog.robot && safeLink(e.prog.robot.folderUrl);
    return `<section class="tgv-panel" aria-labelledby="tgv-panel-title">
        <div class="tgv-panel-head">
            <div class="tgv-panel-titles">
                <p class="tgv-panel-kicker">${escapeHtml(e.kpi.name)}</p>
                <h3 id="tgv-panel-title">${escapeHtml(e.item.name || '')}</h3>
                <p class="tgv-panel-meta">${escapeHtml(programDates(e.item))} · ${escapeHtml(whenText(e.item))}</p>
            </div>
            ${folder ? `<a class="tgv-folder-btn" href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer"><i class="ph-duotone ph-folder-simple" aria-hidden="true"></i> Folder program</a>` : ''}
        </div>
        <div class="tgv-editor"></div>
    </section>`;
}

function programModeHtml() {
    const list = state.entries.filter(PROG_FILTERS[state.filter] || PROG_FILTERS.semua);
    const desk = desktopQuery.matches;
    let selected = null;
    if (desk) {
        selected = list.find(e => e.key === state.selectedKey) || list[0] || null;
        state.selectedKey = selected ? selected.key : null;
    }
    const n = (f) => state.entries.filter(PROG_FILTERS[f]).length;
    const chips = [['semua', 'Semua'], ['lewat', 'Lewat'], ['belum', 'Belum siap'], ['agih', 'Belum diagih'], ['selesai', 'Selesai']]
        .map(([k, label]) => `<button type="button" class="tgv-filter" data-filter="${k}" aria-pressed="${state.filter === k}">${label} <span>${n(k)}</span></button>`).join('');
    return `<div class="tgv-split">
        <section class="tgv-list-col" aria-labelledby="tgv-list-title">
            <h3 id="tgv-list-title" class="tgv-h">${state.entries.length} program</h3>
            <div class="tgv-filters" role="group" aria-label="Tapis program">${chips}</div>
            ${programListHtml(list, desk ? state.selectedKey : null)}
        </section>
        ${desk ? panelHtml(selected) : ''}
    </div>`;
}

// One card per staff member, plus "Belum ada PIC" and removed staff
function picGroups() {
    const today = todayKey();
    const groups = new Map();
    (cache.staf || []).forEach(s => groups.set(s.id, { id: s.id, nama: s.nama, emel: s.emel || '', known: true, tasks: [] }));
    state.entries.forEach(e => e.tasks.forEach(t => {
        const id = t.pic || '';
        if (!groups.has(id)) {
            groups.set(id, id
                ? { id, nama: 'Staf telah dibuang', emel: '', known: false, removed: true, tasks: [] }
                : { id: '', nama: 'Belum ada PIC', emel: '', known: false, nopic: true, tasks: [] });
        }
        groups.get(id).tasks.push({ e, t, st: taskState(t, today) });
    }));
    const list = Array.from(groups.values()).filter(g => g.known || g.tasks.some(x => x.st !== 'selesai'));
    list.forEach(g => {
        g.lewat = g.tasks.filter(x => x.st === 'lewat').length;
        g.belum = g.tasks.filter(x => x.st === 'belum').length;
        g.selesai = g.tasks.filter(x => x.st === 'selesai').length;
        g.tasks.sort((a, b) => (a.st === 'lewat' ? 0 : a.st === 'belum' ? 1 : 2) - (b.st === 'lewat' ? 0 : b.st === 'belum' ? 1 : 2)
            || String(a.t.tarikhAkhir || '9').localeCompare(String(b.t.tarikhAkhir || '9')));
    });
    return list.sort((a, b) => (b.lewat - a.lewat) || ((b.lewat + b.belum) - (a.lewat + a.belum)) || String(a.nama).localeCompare(String(b.nama)));
}

const PIC_FILTERS = {
    semua: () => true,
    lewat: g => g.lewat > 0,
    kosong: g => g.known && !g.tasks.length
};

function taskItemHtml(x) {
    const tone = x.st === 'lewat' ? 'late' : x.st === 'selesai' ? 'done' : 'open';
    return `<li><button type="button" class="tgv-task" data-key="${escapeHtml(x.e.key)}">
        <span class="tgv-task-main"><span class="tgv-task-jenis">${escapeHtml(x.t.jenis || '')}</span><span class="tgv-task-prog">${escapeHtml(x.e.item.name || '')}</span></span>
        <span class="tgv-task-due">${chip(tone, dueLabel(x.t))}${x.t.tarikhAkhir ? `<span class="tgv-task-date">${escapeHtml(isoToDmy(x.t.tarikhAkhir))}</span>` : ''}</span>
    </button></li>`;
}

function picCardHtml(g) {
    const open = g.tasks.filter(x => x.st !== 'selesai');
    const done = g.tasks.filter(x => x.st === 'selesai');
    const expanded = state.expanded.has(g.id);
    let status;
    if (g.lewat) status = chip('late', `${g.lewat} lewat`);
    else if (g.belum) status = chip('open', 'Dalam tempoh');
    else if (g.selesai) status = chip('done', 'Semua selesai');
    else status = chip('none', 'Tanpa tugasan');
    const sub = g.nopic ? 'Tetapkan PIC dalam program masing-masing'
        : g.removed ? 'Tidak lagi dalam senarai staf'
        : g.emel ? escapeHtml(g.emel) : '';
    const noEmail = g.known && !g.emel;
    const shown = expanded ? g.tasks : open;
    let body;
    if (!g.tasks.length) {
        body = `<div class="tgv-pic-empty"><p>Belum memegang sebarang tugasan.${noEmail ? ' Tambah emel UPSI dahulu supaya robot boleh berkongsi folder dan menghantar peringatan.' : ''}</p>
            ${noEmail ? `<button type="button" class="tgv-outline-btn" data-emel="${escapeHtml(g.id)}">Tambah emel</button>` : ''}</div>`;
    } else {
        body = `${shown.length ? `<ul class="tgv-tasks">${shown.map(taskItemHtml).join('')}</ul>` : '<p class="tgv-pic-none">Tiada tugasan terbuka.</p>'}
            ${done.length || noEmail ? `<div class="tgv-pic-foot">
                ${done.length ? `<button type="button" class="tgv-link-btn" data-toggle="${escapeHtml(g.id)}" aria-expanded="${expanded}">${expanded ? 'Sembunyikan tugasan selesai' : `Lihat ${done.length} tugasan selesai`}</button>` : '<span></span>'}
                ${noEmail ? `<button type="button" class="tgv-link-btn" data-emel="${escapeHtml(g.id)}">Tambah emel</button>` : ''}
            </div>` : ''}`;
    }
    return `<article class="tgv-pic${g.lewat ? ' is-late' : ''}${noEmail ? ' no-email' : ''}">
        <div class="tgv-pic-head">
            <span class="tgv-avatar${g.known ? '' : ' is-muted'}" aria-hidden="true">${g.nopic ? '?' : escapeHtml(initials(g.nama))}</span>
            <div class="tgv-pic-who"><h3>${escapeHtml(g.nama)}</h3>${noEmail ? '<p class="tgv-noemail">Tiada emel UPSI</p>' : (sub ? `<p>${sub}</p>` : '')}</div>
            ${status}
        </div>
        ${g.tasks.length ? `<p class="tgv-pic-counts"><span><strong data-tone="late">${g.lewat}</strong> lewat</span><span><strong data-tone="open">${g.belum}</strong> belum siap</span><span><strong data-tone="done">${g.selesai}</strong> selesai</span></p>` : ''}
        ${body}
    </article>`;
}

function picModeHtml() {
    const groups = picGroups();
    const list = groups.filter(PIC_FILTERS[state.picFilter] || PIC_FILTERS.semua);
    const staffN = groups.filter(g => g.known).length;
    const chips = [['semua', 'Semua staf', staffN], ['lewat', 'Lewat', groups.filter(PIC_FILTERS.lewat).length], ['kosong', 'Tanpa tugasan', groups.filter(PIC_FILTERS.kosong).length]]
        .map(([k, label, n]) => `<button type="button" class="tgv-filter" data-pic-filter="${k}" aria-pressed="${state.picFilter === k}">${label} <span>${n}</span></button>`).join('');
    const empty = !(cache.staf || []).length
        ? `<div class="tgv-empty tgv-empty-box"><p>Senarai staf masih kosong. Tambah staf dahulu supaya tugasan boleh diagih.</p><button type="button" class="tgv-outline-btn" data-staf-add="1">Tambah staf</button></div>`
        : (!list.length ? '<p class="tgv-empty">Tiada staf dalam tapisan ini.</p>' : '');
    return `<div class="tgv-filters" role="group" aria-label="Tapis staf">${chips}</div>
        ${empty || `<section class="tgv-pics" aria-label="Tugasan ikut staf">${list.map(picCardHtml).join('')}</section>`}`;
}

function render() {
    const c = state.container;
    if (!c) return;
    const t = totals();
    if (String(state.year) === String(new Date().getFullYear())) setTugasanBadge(t.lewat);
    const stafN = (cache.staf || []).length;
    c.innerHTML = `<div class="tgv">
        <div class="tgv-top">
            <div>
                <p class="page-eyebrow">Admin · Program ${escapeHtml(state.year)}</p>
                <h2 class="page-title">Tugasan dokumen</h2>
                <p class="tgv-lead">Agih kertas kerja, laporan dan maklum balas setiap program kepada staf.</p>
            </div>
            <button type="button" class="tgv-staf-btn" data-staf="1"><i class="ph-duotone ph-users-three" aria-hidden="true"></i> Senarai staf (${stafN})</button>
        </div>
        ${cardsHtml(t)}
        ${robotLine()}
        ${state.prevLate ? `<p class="tgv-prev-note" role="status"><span>Tahun ${Number(state.year) - 1} masih ada <strong>${state.prevLate} tugasan lewat</strong>. Robot terus mengingatkan PIC sehingga selesai.</span>
            <button type="button" class="tgv-link-btn" data-goto-year="${Number(state.year) - 1}">Lihat ${Number(state.year) - 1}</button></p>` : ''}
        <div class="tgv-seg" role="group" aria-label="Susun mengikut">
            <button type="button" data-mode="program" aria-pressed="${state.mode === 'program'}">Ikut program</button>
            <button type="button" data-mode="pic" aria-pressed="${state.mode === 'pic'}">Ikut PIC</button>
        </div>
        <div class="tgv-body">${state.mode === 'pic' ? picModeHtml() : programModeHtml()}</div>
    </div>`;
    const ed = editorEl();
    if (ed) {
        const sel = state.entries.find(e => e.key === state.selectedKey);
        if (sel) mountEditor(ed, { kpi: sel.kpi, item: sel.item, wide: true, onSaved: () => rebuild() });
    }
}

function openEntry(key) {
    const e = state.entries.find(x => x.key === key);
    if (!e) return;
    if (desktopQuery.matches) {
        guard(() => {
            state.mode = 'program';
            if (!(PROG_FILTERS[state.filter] || PROG_FILTERS.semua)(e)) state.filter = 'semua';
            state.selectedKey = key;
            render();
            const panel = state.container.querySelector('.tgv-panel');
            if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
    } else {
        openTugasanSheet(e.kpi, e.item, () => rebuild());
    }
}

function onClick(ev) {
    const t = ev.target;
    const card = t.closest('.tgv-card');
    if (card) {
        const k = card.dataset.card;
        guard(() => { state.mode = 'program'; state.filter = state.filter === k ? 'semua' : k; render(); });
        return;
    }
    const f = t.closest('[data-filter]');
    if (f) { guard(() => { state.filter = f.dataset.filter; render(); }); return; }
    const pf = t.closest('[data-pic-filter]');
    if (pf) { state.picFilter = pf.dataset.picFilter; render(); return; }
    const m = t.closest('[data-mode]');
    if (m) { guard(() => { state.mode = m.dataset.mode; render(); }); return; }
    const p = t.closest('.tgv-prog, .tgv-task');
    if (p) { if (p.dataset.key !== state.selectedKey || !desktopQuery.matches || state.mode !== 'program') openEntry(p.dataset.key); return; }
    const tg = t.closest('[data-toggle]');
    if (tg) {
        const id = tg.dataset.toggle;
        if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
        render();
        return;
    }
    const em = t.closest('[data-emel]');
    if (em) { openStafSheet({ focusId: em.dataset.emel }); return; }
    if (t.closest('[data-staf-add]')) { openStafSheet({ addRow: true }); return; }
    const gy = t.closest('[data-goto-year]');
    if (gy) {
        const sel = document.getElementById('year-selector');
        if (sel) { sel.value = gy.dataset.gotoYear; sel.dispatchEvent(new Event('change')); }
        return;
    }
    if (t.closest('[data-staf]')) { openStafSheet(); }
}

document.addEventListener('click', (ev) => {
    if (state.container && state.container.contains(ev.target) && ev.target.closest('.tgv')) onClick(ev);
});

const visible = () => state.container && !state.container.classList.contains('hidden') && state.container.querySelector('.tgv');

// Saves made elsewhere (Butiran's sheet, the staff list) refresh the tab
document.addEventListener('tugasan-saved', () => { if (visible() && !isDirty()) rebuild(); });
document.addEventListener('tugasan-staf-saved', () => { if (visible() && !isDirty()) rebuild(); });
desktopQuery.addEventListener('change', () => { if (visible() && !isDirty()) render(); });
