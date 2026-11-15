// --- JS/TUGASAN.JS ---
// Tugasan dokumen (phase 1): each Kembara programme gets a short list of
// document tasks (kertas kerja, laporan, maklum balas, ...), each with a
// staff member in charge (PIC), a due date, a Google Drive link and a
// "selesai" tick. Admin only: the admin assigns and pastes the links staff
// send in. Files stay in Google Drive; the app only stores links.
//
// Data lives in its own admin-only collection (api.js, "TUGASAN DOKUMEN"),
// never inside the public KPI documents. A programme is matched to its
// Kembara record by programKey(): the record's stable id when it has one,
// else its name + start date (older records were saved without an id).
//
// Built so phase 2 (staff sign in with their UPSI Google account and fill in
// their own tasks) only adds a login and a rule: tasks already point at a
// staff id, and each staff entry carries an email.

import {
    getTugasanYear, getStafList, saveProgramTugasan, saveStafList,
    checkTugasanRules, selectedYear
} from './api.js';
import {
    escapeHtml, formSheetHtml, closeFormSheet, openModal, showToastNotification
} from './ui.js';

export const TUGASAN_KPI_IDS = new Set(['kembara']);

// Task kinds, with the suggested due date relative to the programme:
// `before` days before it starts, or `after` days after it ends
export const JENIS_TUGASAN = [
    { jenis: 'Kertas kerja',      before: 14, lalai: true },
    { jenis: 'Laporan',           after: 14,  lalai: true },
    { jenis: 'Maklum balas',      after: 7,   lalai: true },
    { jenis: 'Gambar',            after: 3 },
    { jenis: 'Senarai kehadiran', after: 3 },
    { jenis: 'Lain-lain',         after: 14 },
];

const pad = (n) => String(n).padStart(2, '0');
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoToDmy = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
function addDays(iso, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    return d.toISOString().slice(0, 10);
}
const genId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Only http(s) links become clickable (a stored "javascript:" must never run)
export const safeLink = (url) => (/^https?:\/\/\S+$/i.test(String(url || '').trim()) ? String(url).trim() : '');

export function programKey(item) {
    if (!item) return '';
    if (item.id != null && item.id !== '') return `id:${item.id}`;
    return `n:${item.name || ''}|${item.tarikh || ''}`;
}

export function findProgram(programs, item) {
    if (!Array.isArray(programs) || !item) return null;
    const key = programKey(item);
    return programs.find(p => p && p.key === key) || null;
}

// 'selesai' | 'lewat' | 'belum'
export function taskState(task, today = todayKey()) {
    if (task && task.selesai) return 'selesai';
    if (task && task.tarikhAkhir && task.tarikhAkhir < today) return 'lewat';
    return 'belum';
}

export function summarizeTasks(tasks, today = todayKey()) {
    const list = Array.isArray(tasks) ? tasks : [];
    const s = { total: list.length, selesai: 0, lewat: 0, belum: 0 };
    list.forEach(t => { s[taskState(t, today)]++; });
    return s;
}

export function suggestedDue(jenis, item) {
    const rule = JENIS_TUGASAN.find(j => j.jenis === jenis) || JENIS_TUGASAN[JENIS_TUGASAN.length - 1];
    const start = item && item.tarikh;
    const end = (item && (item.tarikhTamat || item.tarikh)) || '';
    if (rule.before) return addDays(start, -rule.before);
    return addDays(end, rule.after || 14);
}

// ---- Cache (one read per year per opening of Butiran) ------------------
const cache = { year: null, programs: null, staf: null };

async function loadTugasan(force = false) {
    const year = String(selectedYear);
    if (!force && cache.year === year && cache.programs && cache.staf) return cache;
    const [programs, staf] = await Promise.all([getTugasanYear(year), getStafList()]);
    cache.year = year;
    cache.programs = programs;
    cache.staf = staf;
    return cache;
}

const stafName = (staf, id) => {
    const s = (staf || []).find(x => x.id === id);
    return s ? s.nama : '';
};

// ---- Butiran rows ------------------------------------------------------
// Adds a "Dokumen" button to each programme row in the open Butiran list
// (admin only; ui.js calls this after rendering). The rows carry data-index
// into kpi.details.items.
export async function decorateProgramRows(kpi, listEl) {
    if (!kpi || !TUGASAN_KPI_IDS.has(kpi.id) || !listEl) return;
    const year = String(selectedYear);
    const data = await loadTugasan();
    if (String(selectedYear) !== year || !listEl.isConnected) return;
    const items = (kpi.details && kpi.details.items) || [];
    const today = todayKey();
    listEl.querySelectorAll('li.breakdown-item[data-index]').forEach(li => {
        const item = items[parseInt(li.dataset.index, 10)];
        if (!item) return;
        li.querySelector('.tugasan-chip')?.remove();
        const host = li.querySelector('.min-w-0');
        if (!host) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tugasan-chip';
        if (data.programs === null) {
            btn.disabled = true;
            btn.innerHTML = '<i class="ph-duotone ph-clipboard-text" aria-hidden="true"></i><span>Tugasan tidak dapat dibaca</span>';
        } else {
            const prog = findProgram(data.programs, item);
            const s = summarizeTasks(prog && prog.tasks, today);
            let label, tone;
            if (!s.total) { label = 'Agih tugasan'; tone = 'none'; }
            else {
                label = `Dokumen ${s.selesai}/${s.total}`;
                if (s.lewat) label += ` · ${s.lewat} lewat`;
                tone = s.lewat ? 'late' : (s.selesai === s.total ? 'done' : 'open');
            }
            btn.dataset.tone = tone;
            btn.setAttribute('aria-label', `Tugasan dokumen ${item.name}: ${label}`);
            btn.innerHTML = `<i class="ph-duotone ph-clipboard-text" aria-hidden="true"></i><span>${escapeHtml(label)}</span>`;
            btn.addEventListener('click', () => openTugasanSheet(kpi, item, () => decorateProgramRows(kpi, listEl)));
        }
        host.appendChild(btn);
    });
}

// ---- Tugasan sheet -----------------------------------------------------
let sheetCtx = null;   // { kpi, item, onSaved }

function ensureSheet() {
    let modal = document.getElementById('tugasan-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'tugasan-modal';
    modal.className = 'modal form-sheet fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = formSheetHtml({
        prefix: 'tugasan-modal', formId: 'tugasan-form', title: 'Tugasan dokumen',
        body: `
            <div id="tugasan-rules-warn" class="tg-warn hidden" role="alert"></div>
            <div class="fs-summary"><p id="tugasan-info"></p></div>
            <div id="tugasan-rows" class="tg-rows"></div>
            <p id="tugasan-empty" class="fs-hint hidden">Tiada tugasan. Tekan "Tambah tugasan" untuk mula.</p>
            <button type="button" id="tugasan-add" class="tg-add"><i class="fas fa-plus" aria-hidden="true"></i> Tambah tugasan</button>
            <p class="fs-hint">Simpan fail dalam Google Drive dan tampal pautannya di sini. Pastikan fail dikongsi dengan staf UPSI sahaja, bukan "sesiapa yang ada pautan".</p>
            <details id="tugasan-staf" class="tg-staf">
                <summary>Senarai staf <span id="tugasan-staf-count"></span></summary>
                <div class="tg-staf-body">
                    <p class="fs-hint">Staf yang boleh diberi tugasan. Emel UPSI akan digunakan apabila staf boleh log masuk sendiri (fasa 2).</p>
                    <div id="tugasan-staf-rows" class="tg-staf-rows"></div>
                    <div class="tg-staf-actions">
                        <button type="button" id="tugasan-staf-add" class="tg-add tg-add-sm"><i class="fas fa-plus" aria-hidden="true"></i> Tambah staf</button>
                        <button type="button" id="tugasan-staf-save" class="tg-staf-save">Simpan senarai staf</button>
                    </div>
                </div>
            </details>`
    });
    document.body.appendChild(modal);

    const close = () => closeFormSheet(modal);
    modal.querySelector('#tugasan-modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#tugasan-add').addEventListener('click', () => {
        const rows = modal.querySelector('#tugasan-rows');
        const used = new Set(readRows(modal).map(t => t.jenis));
        const next = (JENIS_TUGASAN.find(j => !used.has(j.jenis)) || JENIS_TUGASAN[JENIS_TUGASAN.length - 1]).jenis;
        rows.insertAdjacentHTML('beforeend', taskRowHtml({ id: genId('tg'), jenis: next, tarikhAkhir: suggestedDue(next, sheetCtx.item) }, cache.staf));
        syncEmpty(modal);
        rows.lastElementChild.querySelector('.tg-jenis').focus();
    });
    const rows = modal.querySelector('#tugasan-rows');
    rows.addEventListener('click', (e) => {
        const rm = e.target.closest('.tg-remove');
        if (rm) { rm.closest('.tg-row').remove(); syncEmpty(modal); }
    });
    rows.addEventListener('input', (e) => {
        const row = e.target.closest('.tg-row');
        if (!row) return;
        // Pasting the first link ticks "Selesai" (can be unticked)
        if (e.target.classList.contains('tg-link')) {
            const done = row.querySelector('.tg-done');
            const had = row.dataset.hadLink === '1';
            if (!had && e.target.value.trim() && !done.dataset.touched) done.checked = true;
            row.dataset.hadLink = e.target.value.trim() ? '1' : '0';
            const open = row.querySelector('.tg-open');
            const href = safeLink(e.target.value);
            open.classList.toggle('hidden', !href);
            if (href) open.href = href;
        }
        if (e.target.classList.contains('tg-done')) e.target.dataset.touched = '1';
        refreshRowState(row);
    });
    rows.addEventListener('change', (e) => {
        const row = e.target.closest('.tg-row');
        if (!row) return;
        if (e.target.classList.contains('tg-done')) e.target.dataset.touched = '1';
        // Changing the kind moves an untouched due date to that kind's suggestion
        if (e.target.classList.contains('tg-jenis')) {
            const due = row.querySelector('.tg-due');
            if (!due.dataset.touched) due.value = suggestedDue(e.target.value, sheetCtx.item);
        }
        if (e.target.classList.contains('tg-due')) e.target.dataset.touched = '1';
        refreshRowState(row);
    });

    modal.querySelector('#tugasan-staf-add').addEventListener('click', () => {
        const box = modal.querySelector('#tugasan-staf-rows');
        box.insertAdjacentHTML('beforeend', stafRowHtml({ id: genId('st'), nama: '', emel: '' }));
        box.lastElementChild.querySelector('.tg-staf-nama').focus();
    });
    modal.querySelector('#tugasan-staf-rows').addEventListener('click', (e) => {
        const rm = e.target.closest('.tg-staf-remove');
        if (rm) rm.closest('.tg-staf-row').remove();
    });
    modal.querySelector('#tugasan-staf-save').addEventListener('click', () => saveStaf(modal));
    modal.querySelector('#tugasan-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveTasks(modal);
    });
    return modal;
}

function jenisOptions(selected) {
    const known = JENIS_TUGASAN.map(j => j.jenis);
    const list = known.includes(selected) || !selected ? known : [selected, ...known];
    return list.map(j => `<option value="${escapeHtml(j)}"${j === selected ? ' selected' : ''}>${escapeHtml(j)}</option>`).join('');
}

function picOptions(staf, selected) {
    let html = '<option value="">Belum ditetapkan</option>';
    (staf || []).forEach(s => {
        html += `<option value="${escapeHtml(s.id)}"${s.id === selected ? ' selected' : ''}>${escapeHtml(s.nama)}</option>`;
    });
    // A staff member removed from the list keeps their tasks
    if (selected && !(staf || []).some(s => s.id === selected)) {
        html += `<option value="${escapeHtml(selected)}" selected>(Staf telah dibuang)</option>`;
    }
    return html;
}

const STATE_LABEL = { selesai: 'Selesai', lewat: 'Lewat', belum: 'Belum' };

function taskRowHtml(t, staf) {
    const href = safeLink(t.link);
    const state = taskState(t);
    const uid = escapeHtml(t.id);
    return `
        <div class="tg-row" data-id="${uid}" data-had-link="${t.link ? '1' : '0'}">
            <div class="tg-row-head">
                <select class="fs-input fs-select tg-jenis" aria-label="Jenis dokumen">${jenisOptions(t.jenis)}</select>
                <button type="button" class="tg-remove" aria-label="Buang tugasan ini"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>
            </div>
            <div class="fs-two">
                <div class="fs-field">
                    <label class="fs-label" for="tg-pic-${uid}">PIC</label>
                    <select id="tg-pic-${uid}" class="fs-input fs-select tg-pic">${picOptions(staf, t.pic)}</select>
                </div>
                <div class="fs-field">
                    <label class="fs-label" for="tg-due-${uid}">Tarikh akhir</label>
                    <input type="date" id="tg-due-${uid}" class="fs-input tg-due" value="${escapeHtml(t.tarikhAkhir || '')}"${t.tarikhAkhir ? ' data-touched="1"' : ''}>
                </div>
            </div>
            <div class="fs-field">
                <label class="fs-label" for="tg-link-${uid}">Pautan Google Drive <span class="fs-optional">(apabila siap)</span></label>
                <div class="tg-link-wrap">
                    <input type="url" id="tg-link-${uid}" class="fs-input tg-link" inputmode="url" placeholder="https://drive.google.com/..." value="${escapeHtml(t.link || '')}">
                    <a class="tg-open${href ? '' : ' hidden'}" href="${escapeHtml(href || '#')}" target="_blank" rel="noopener noreferrer">Buka</a>
                </div>
            </div>
            <div class="tg-row-foot">
                <label class="tg-done-label"><input type="checkbox" class="tg-done"${t.selesai ? ' checked data-touched="1"' : ''}> Selesai</label>
                <span class="tg-state" data-state="${state}">${STATE_LABEL[state]}</span>
            </div>
        </div>`;
}

function refreshRowState(row) {
    const t = {
        selesai: row.querySelector('.tg-done').checked,
        tarikhAkhir: row.querySelector('.tg-due').value
    };
    const state = taskState(t);
    const pill = row.querySelector('.tg-state');
    pill.dataset.state = state;
    pill.textContent = STATE_LABEL[state];
}

function stafRowHtml(s) {
    const uid = escapeHtml(s.id);
    return `
        <div class="tg-staf-row" data-id="${uid}">
            <input type="text" class="fs-input tg-staf-nama" aria-label="Nama staf" placeholder="Nama" value="${escapeHtml(s.nama || '')}">
            <input type="email" class="fs-input tg-staf-emel" aria-label="Emel UPSI" placeholder="nama@upsi.edu.my" value="${escapeHtml(s.emel || '')}">
            <button type="button" class="tg-staf-remove" aria-label="Buang staf ini"><i class="fas fa-times" aria-hidden="true"></i></button>
        </div>`;
}

function readRows(modal) {
    return Array.from(modal.querySelectorAll('#tugasan-rows .tg-row')).map(row => ({
        id: row.dataset.id,
        jenis: row.querySelector('.tg-jenis').value,
        pic: row.querySelector('.tg-pic').value,
        tarikhAkhir: row.querySelector('.tg-due').value,
        link: row.querySelector('.tg-link').value.trim(),
        selesai: row.querySelector('.tg-done').checked
    }));
}

function syncEmpty(modal) {
    const none = !modal.querySelector('#tugasan-rows .tg-row');
    modal.querySelector('#tugasan-empty').classList.toggle('hidden', !none);
}

function renderStaf(modal) {
    const staf = cache.staf || [];
    modal.querySelector('#tugasan-staf-rows').innerHTML = staf.map(stafRowHtml).join('');
    modal.querySelector('#tugasan-staf-count').textContent = `(${staf.length})`;
    // No staff yet: open the list so the admin sees where to add them
    modal.querySelector('#tugasan-staf').open = !staf.length;
}

const RULES_MSG = {
    rules: 'Peraturan keselamatan untuk tugasan belum dikemas kini dalam Firebase Console. Tugasan tidak boleh disimpan sehingga peraturan baharu diterbitkan, supaya maklumat staf dan pautan tidak boleh dibaca oleh orang awam.',
    unknown: 'Tidak dapat menyemak peraturan keselamatan sekarang. Semak sambungan internet dan cuba lagi.'
};

function showSaveError(code) {
    if (code === 'offline') showToastNotification('Tiada sambungan internet. Perubahan tidak disimpan.', 'danger');
    else if (code === 'rules') showToastNotification('Belum boleh simpan: peraturan keselamatan tugasan belum diterbitkan.', 'danger');
    else if (code === 'unknown') showToastNotification('Tidak dapat menyemak peraturan keselamatan. Cuba lagi.', 'danger');
    else showToastNotification('Ralat simpan. Cuba lagi.', 'danger');
}

async function checkRulesBanner(modal) {
    const warn = modal.querySelector('#tugasan-rules-warn');
    warn.classList.add('hidden');
    const r = await checkTugasanRules();
    if (r === 'rules' || r === 'open') {
        warn.textContent = RULES_MSG.rules;
        warn.classList.remove('hidden');
    }
}

export async function openTugasanSheet(kpi, item, onSaved) {
    const data = await loadTugasan();
    if (data.programs === null || data.staf === null) {
        showToastNotification('Tugasan tidak dapat dibaca. Cuba lagi.', 'danger');
        return;
    }
    sheetCtx = { kpi, item, onSaved };
    const modal = ensureSheet();
    modal.querySelector('#tugasan-modal-subtitle').textContent = item.name || '';
    const when = item.tarikhTamat && item.tarikhTamat !== item.tarikh
        ? `${isoToDmy(item.tarikh)} hingga ${isoToDmy(item.tarikhTamat)}` : isoToDmy(item.tarikh);
    const prog = findProgram(data.programs, item);
    const tasks = prog && Array.isArray(prog.tasks) ? prog.tasks : null;
    const info = modal.querySelector('#tugasan-info');
    info.innerHTML = `${escapeHtml(item.name || '')}${when ? `, <strong>${escapeHtml(when)}</strong>` : ''}.`
        + (tasks ? '' : ' Tiga tugasan biasa dicadangkan di bawah. Tetapkan PIC dan tekan Simpan.');

    // A programme without tasks starts with the usual three, due dates
    // suggested from its dates (nothing is saved until Simpan)
    const list = tasks || JENIS_TUGASAN.filter(j => j.lalai).map(j => ({
        id: genId('tg'), jenis: j.jenis, pic: '', tarikhAkhir: suggestedDue(j.jenis, item), link: '', selesai: false
    }));
    modal.querySelector('#tugasan-rows').innerHTML = list.map(t => taskRowHtml(t, data.staf)).join('');
    // Suggested dates of an unsaved programme follow a kind change
    if (!tasks) modal.querySelectorAll('.tg-due').forEach(el => { delete el.dataset.touched; });
    syncEmpty(modal);
    renderStaf(modal);
    openModal(modal);
    checkRulesBanner(modal);
}

async function saveTasks(modal) {
    if (!sheetCtx) return;
    const { kpi, item, onSaved } = sheetCtx;
    const tasks = readRows(modal);
    for (const t of tasks) {
        if (t.link && !safeLink(t.link)) {
            showToastNotification(`Pautan ${t.jenis} mesti bermula dengan https://`, 'danger');
            return;
        }
    }
    const program = {
        key: programKey(item), kpiId: kpi.id, name: item.name || '',
        tarikh: item.tarikh || '', tasks
    };
    if (item.tarikhTamat) program.tarikhTamat = item.tarikhTamat;
    const res = await saveProgramTugasan(selectedYear, program);
    if (res !== 'ok') { showSaveError(res); return; }
    const list = cache.programs || [];
    const i = list.findIndex(p => p.key === program.key);
    if (i === -1) list.push(program); else list[i] = program;
    cache.programs = list;
    closeFormSheet(modal);
    showToastNotification('Tugasan disimpan.', 'success');
    if (onSaved) onSaved();
    document.dispatchEvent(new CustomEvent('tugasan-saved'));
}

async function saveStaf(modal) {
    const rows = Array.from(modal.querySelectorAll('#tugasan-staf-rows .tg-staf-row')).map(r => ({
        id: r.dataset.id,
        nama: r.querySelector('.tg-staf-nama').value.trim(),
        emel: r.querySelector('.tg-staf-emel').value.trim().toLowerCase()
    })).filter(s => s.nama || s.emel);
    for (const s of rows) {
        if (!s.nama) { showToastNotification('Setiap staf perlu ada nama.', 'danger'); return; }
        if (s.emel && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.emel)) {
            showToastNotification(`Emel ${s.nama} tidak sah.`, 'danger'); return;
        }
    }
    const res = await saveStafList(rows);
    if (res !== 'ok') { showSaveError(res); return; }
    cache.staf = rows;
    // Keep what the admin picked in the task rows, with the new names
    modal.querySelectorAll('#tugasan-rows .tg-pic').forEach(sel => {
        const v = sel.value;
        sel.innerHTML = picOptions(rows, v);
    });
    renderStaf(modal);
    modal.querySelector('#tugasan-staf').open = true;
    showToastNotification('Senarai staf disimpan.', 'success');
}

// Used by todo.js: overdue tasks and programmes with no tasks, for the
// programmes still in the year's Kembara list
export async function tugasanOverview(q4, year, today = todayKey()) {
    const [programs, staf] = await Promise.all([getTugasanYear(year), getStafList()]);
    if (programs === null) return null;
    const kpi = (q4 && q4.kpis || []).find(k => TUGASAN_KPI_IDS.has(k.id));
    const items = (kpi && kpi.details && Array.isArray(kpi.details.items)) ? kpi.details.items : [];
    const late = [];
    const unassigned = [];
    items.forEach(item => {
        if (!item.tarikh) return;
        const prog = findProgram(programs, item);
        const tasks = prog && Array.isArray(prog.tasks) ? prog.tasks : [];
        if (!tasks.length) {
            // Starts within 30 days, or ended in the last 30: older
            // programmes are not nagged about
            const end = item.tarikhTamat || item.tarikh;
            if (item.tarikh <= addDays(today, 30) && end >= addDays(today, -30)) unassigned.push(item);
            return;
        }
        tasks.forEach(t => {
            if (taskState(t, today) === 'lewat') late.push({ item, task: t, pic: stafName(staf, t.pic) });
        });
    });
    return { late, unassigned, kpi };
}
