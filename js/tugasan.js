// --- JS/TUGASAN.JS ---
// Tugasan dokumen: each programme of a dated programme KPI (Kembara, Bicara,
// Ziarah) gets a short list of document tasks (kertas kerja, laporan,
// maklum balas, ...), each with a staff member in charge (PIC), a due date,
// a Google Drive link and a "selesai" tick. Admin only. Files stay in
// Google Drive; the app only stores links. The Apps Script robot
// (apps-script/Robot.gs) creates the folders, emails the PIC and ticks a task
// when a file lands in its folder.
//
// Data lives in its own admin-only collection (api.js, "TUGASAN DOKUMEN"),
// never inside the public KPI documents. A programme is matched to its KPI
// record by programKey(): the record's stable id when it has one, else its
// name + start date (older records were saved without an id).
//
// This module holds the data helpers, the task EDITOR (one component, used
// full page on phones in the "Agih tugasan" sheet and inline in the desktop
// panel of the Tugasan tab, js/tugasan-view.js), the "Senarai staf" sheet,
// and the "Dokumen" buttons in Butiran. Design: canvas "Redesign KPI Pusat
// Alumni", artboards Tugasan-*.

import {
    getTugasanYear, getStafList, getRobotStatus, saveProgramTugasan, saveStafList,
    checkTugasanRules, selectedYear, AWAM_JENIS, getDokumenAwam
} from './api.js';
import {
    escapeHtml, formSheetHtml, closeFormSheet, openModal, showToastNotification
} from './ui.js';

// KPIs whose programmes carry dates (same set as ui.js COUNT_KPI_IDS)
export const TUGASAN_KPI_IDS = new Set(['kembara', 'bicara', 'ziarah']);

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
export function addDays(iso, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    return d.toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from || ''), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to || '');
    if (!a || !b) return null;
    return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}
const genId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Only http(s) links become clickable (a stored "javascript:" must never run)
export const safeLink = (url) => (/^https?:\/\/\S+$/i.test(String(url || '').trim()) ? String(url).trim() : '');

export function programKey(item) {
    if (!item) return '';
    if (item.id != null && item.id !== '') return `id:${item.id}`;
    return `n:${item.name || ''}|${item.tarikh || ''}`;
}

// kpiId narrows the match when given (a legacy name|date key could repeat
// across two KPIs)
export function findProgram(programs, item, kpiId) {
    if (!Array.isArray(programs) || !item) return null;
    const key = programKey(item);
    return programs.find(p => p && p.key === key && (!kpiId || !p.kpiId || p.kpiId === kpiId)) || null;
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

// "Lewat 2 hari" / "Hari ini" / "20 hari lagi" / "Selesai"
export function dueLabel(task, today = todayKey()) {
    const state = taskState(task, today);
    if (state === 'selesai') return 'Selesai';
    if (!task.tarikhAkhir) return 'Tiada tarikh akhir';
    const d = daysBetween(today, task.tarikhAkhir);
    if (d < 0) return `Lewat ${-d} hari`;
    if (d === 0) return 'Hari ini';
    return `${d} hari lagi`;
}

export function suggestedDue(jenis, item) {
    const rule = JENIS_TUGASAN.find(j => j.jenis === jenis) || JENIS_TUGASAN[JENIS_TUGASAN.length - 1];
    const start = item && item.tarikh;
    const end = (item && (item.tarikhTamat || item.tarikh)) || '';
    if (rule.before) return addDays(start, -rule.before);
    return addDays(end, rule.after || 14);
}

// A programme with no tasks is "belum diagih" (worth a reminder) when it
// starts within 30 days or ended in the last 30; older ones are left alone
export function inAssignWindow(item, today = todayKey()) {
    if (!item || !item.tarikh) return false;
    const end = item.tarikhTamat || item.tarikh;
    return item.tarikh <= addDays(today, 30) && end >= addDays(today, -30);
}

export const programDates = (item) => (item.tarikhTamat && item.tarikhTamat !== item.tarikh
    ? `${isoToDmy(item.tarikh)} hingga ${isoToDmy(item.tarikhTamat)}` : isoToDmy(item.tarikh));

// ---- Cache (one read per year; the Tugasan tab forces a fresh one) -----
export const cache = { year: null, programs: null, staf: null, robot: null };

export async function loadTugasan(force = false) {
    const year = String(selectedYear);
    if (!force && cache.year === year && cache.programs && cache.staf) return cache;
    const [programs, staf, robot] = await Promise.all([getTugasanYear(year), getStafList(), getRobotStatus()]);
    cache.year = year;
    cache.programs = programs;
    cache.staf = staf;
    cache.robot = robot;
    return cache;
}

export const stafName = (staf, id) => {
    const s = (staf || []).find(x => x.id === id);
    return s ? s.nama : '';
};

// The robot writes tugasan/robot { lastRun, ok, mesej } after every run
export function robotStatusText(r, long = true) {
    if (!r || !r.lastRun) return '';
    const d = new Date(r.lastRun);
    if (isNaN(d)) return '';
    const when = `${d.toLocaleDateString('en-GB')}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    if (r.ok === false) return `Bot gagal pada ${when}: ${r.mesej || 'ralat tidak diketahui'}.`;
    return `Bot terakhir berjalan pada ${when}.`
        + (long ? ' Ia mencipta folder, mengemel PIC dan menanda tugasan selesai apabila fail dimuat naik.' : '');
}

// Red count on the Tugasan nav tabs (header and bottom bar)
export function setTugasanBadge(n) {
    document.querySelectorAll('.tugasan-nav-badge').forEach(b => {
        b.textContent = String(n);
        b.classList.toggle('hidden', !n);
        b.setAttribute('aria-label', `${n} tugasan lewat`);
    });
}

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
            const prog = findProgram(data.programs, item, kpi.id);
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
            btn.addEventListener('click', () => openTugasanSheet(kpi, item, () => {
                decorateProgramRows(kpi, listEl);
                decoratePublicDocs(kpi, listEl);
            }));
        }
        host.appendChild(btn);
    });
}

// ---- Public documents in Butiran (everyone) -----------------------------
// Each programme row lists the documents the admin chose to publish, read
// from the public dokumen-awam/{year} copy (never from tugasan).
const pubCache = { year: null, programs: null };
document.addEventListener('tugasan-saved', () => { pubCache.year = null; });

export async function decoratePublicDocs(kpi, listEl) {
    if (!kpi || !TUGASAN_KPI_IDS.has(kpi.id) || !listEl) return;
    const year = String(selectedYear);
    if (pubCache.year !== year) {
        pubCache.programs = await getDokumenAwam(year);
        pubCache.year = year;
    }
    if (String(selectedYear) !== year || !listEl.isConnected || !Array.isArray(pubCache.programs)) return;
    const items = (kpi.details && kpi.details.items) || [];
    listEl.querySelectorAll('li.breakdown-item[data-index]').forEach(li => {
        const item = items[parseInt(li.dataset.index, 10)];
        li.querySelector('.dok-awam-row')?.remove();
        if (!item) return;
        const prog = findProgram(pubCache.programs, item, kpi.id);
        const docs = (prog && Array.isArray(prog.docs) ? prog.docs : []).filter(d => safeLink(d.link));
        if (!docs.length) return;
        const host = li.querySelector('.min-w-0');
        if (!host) return;
        const row = document.createElement('div');
        row.className = 'dok-awam-row';
        row.innerHTML = docs.map(d => `<a class="dok-awam" href="${escapeHtml(safeLink(d.link))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${d.jenis} ${item.name || ''} (dibuka dalam tab baharu)`)}">`
            + `<i class="ph-duotone ${d.jenis === 'Gambar' ? 'ph-images' : d.jenis === 'Maklum balas' ? 'ph-chat-circle-text' : 'ph-file-text'}" aria-hidden="true"></i>${escapeHtml(d.jenis)}</a>`).join('');
        const chip = host.querySelector('.tugasan-chip');
        if (chip) host.insertBefore(row, chip); else host.appendChild(row);
    });
}

// ---- Editor ------------------------------------------------------------
// One component for both places. mountEditor(root, ctx) renders into `root`
// and keeps ctx on it; ctx = { kpi, item, wide, onSaved }. `wide` (desktop
// panel) lays the tasks out as a table and adds its own "Simpan perubahan";
// the sheet saves from its header instead.
let editorSeq = 0;
const mountedEditors = new Set();

function jenisOptions(selected) {
    const known = JENIS_TUGASAN.map(j => j.jenis);
    const list = known.includes(selected) || !selected ? known : [selected, ...known];
    return list.map(j => `<option value="${escapeHtml(j)}"${j === selected ? ' selected' : ''}>${escapeHtml(j)}</option>`).join('');
}

function picOptions(staf, selected) {
    let html = '<option value="">Belum ditetapkan</option>';
    (staf || []).forEach(s => {
        const note = s.emel ? '' : ' (tiada emel)';
        html += `<option value="${escapeHtml(s.id)}"${s.id === selected ? ' selected' : ''}>${escapeHtml(s.nama + note)}</option>`;
    });
    // A staff member removed from the list keeps their tasks
    if (selected && !(staf || []).some(s => s.id === selected)) {
        html += `<option value="${escapeHtml(selected)}" selected>(Staf telah dibuang)</option>`;
    }
    return html;
}

const STATE_LABEL = { selesai: 'Selesai', lewat: 'Lewat', belum: 'Belum siap' };

function stateText(t) {
    const state = taskState(t);
    return state === 'belum' && t.tarikhAkhir ? dueLabel(t) : (state === 'lewat' ? dueLabel(t) : STATE_LABEL[state]);
}

// What the robot did for this task: the PIC's Drive folder, and whether it
// ticked Selesai itself
function robotHint(t) {
    const r = t && t.robot;
    const folder = r && safeLink(r.folderUrl);
    if (!folder) return '';
    const auto = t.selesai && r.selesaiAuto ? ' Ditanda selesai oleh bot apabila fail dijumpai.' : '';
    return `<p class="tg-robot"><i class="ph-duotone ph-folder-simple" aria-hidden="true"></i><span>`
        + `<a href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer">Folder PIC</a> dalam Google Drive.${auto}</span></p>`;
}

function taskRowHtml(t, staf, inst) {
    const href = safeLink(t.link);
    const state = taskState(t);
    const uid = `${inst}-${escapeHtml(t.id)}`;
    return `
        <div class="tg-row" data-id="${escapeHtml(t.id)}" data-had-link="${t.link ? '1' : '0'}">
            <div class="tg-row-head">
                <label class="sr-only" for="tg-jenis-${uid}">Jenis dokumen</label>
                <select id="tg-jenis-${uid}" class="fs-input fs-select tg-jenis">${jenisOptions(t.jenis)}</select>
                <button type="button" class="tg-remove" aria-label="Buang tugasan ${escapeHtml(t.jenis || '')}"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>
            </div>
            <div class="fs-two tg-row-mid">
                <div class="fs-field tg-f-pic">
                    <label class="fs-label" for="tg-pic-${uid}">PIC</label>
                    <select id="tg-pic-${uid}" class="fs-input fs-select tg-pic">${picOptions(staf, t.pic)}</select>
                    <button type="button" class="tg-staf-link">Urus senarai staf <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
                </div>
                <div class="fs-field tg-f-due">
                    <label class="fs-label" for="tg-due-${uid}">Tarikh akhir</label>
                    <input type="date" id="tg-due-${uid}" class="fs-input tg-due" value="${escapeHtml(t.tarikhAkhir || '')}"${t.tarikhAkhir ? ' data-touched="1"' : ''}>
                </div>
            </div>
            <div class="fs-field tg-f-link">
                <label class="fs-label" for="tg-link-${uid}">Pautan Google Drive <span class="fs-optional">(apabila siap)</span></label>
                <div class="tg-link-wrap">
                    <input type="url" id="tg-link-${uid}" class="fs-input tg-link" inputmode="url" placeholder="https://drive.google.com/..." value="${escapeHtml(t.link || '')}">
                    <a class="tg-open${href ? '' : ' hidden'}" href="${escapeHtml(href || '#')}" target="_blank" rel="noopener noreferrer">Buka</a>
                </div>
                ${robotHint(t)}
                <p class="tg-awam-note${t.awam ? '' : ' hidden'}" data-tone="${awamTone(t)}" data-link="${escapeHtml(t.link || '')}">${escapeHtml(awamNote(t))}</p>
            </div>
            <div class="tg-row-foot">
                <label class="tg-done-label"><input type="checkbox" class="tg-done"${t.selesai ? ' checked data-touched="1"' : ''}> Selesai</label>
                <span class="tg-state" data-state="${state}">${escapeHtml(stateText(t))}</span>
                <label class="tg-awam-label${AWAM_JENIS.includes(t.jenis) ? '' : ' hidden'}" title="Hanya dokumen yang selesai dan ada pautan boleh dipaparkan">
                    <input type="checkbox" class="tg-awam"${t.awam && canPublish(t) ? ' checked' : ''}${canPublish(t) ? '' : ' disabled'}>
                    <span class="tg-awam-long">Paparkan kepada umum</span><span class="tg-awam-short">Umum</span>
                </label>
            </div>
        </div>`;
}

// "Paparkan kepada umum": only finished Laporan / Maklum balas / Gambar
// with a link. Attendance lists and kertas kerja never (personal data,
// budgets); api.js enforces the same rule when it writes the public copy.
function canPublish(t) {
    return !!(t && AWAM_JENIS.includes(t.jenis) && t.selesai && safeLink(t.link));
}

// What has happened to the file's sharing (the robot opens it the next morning)
function awamNote(t) {
    const r = t && t.robot && t.robot.awam;
    if (r && r.link === t.link && r.status === 'dibuka') return 'Dipaparkan kepada umum. Fail boleh dibuka oleh sesiapa yang ada pautan.';
    if (r && r.link === t.link && r.status === 'gagal') return `Dipaparkan kepada umum, tetapi fail belum boleh dibuka oleh umum: ${r.mesej || 'perkongsian gagal'}.`;
    return 'Dipaparkan kepada umum. Bot akan membuka perkongsian fail ini pada larian pagi esok.';
}
function awamTone(t) {
    const r = t && t.robot && t.robot.awam;
    return r && r.link === t.link ? (r.status === 'dibuka' ? 'ok' : 'bad') : 'wait';
}

function refreshRowState(row) {
    const t = {
        selesai: row.querySelector('.tg-done').checked, tarikhAkhir: row.querySelector('.tg-due').value,
        jenis: row.querySelector('.tg-jenis').value, link: row.querySelector('.tg-link').value.trim()
    };
    const pill = row.querySelector('.tg-state');
    pill.dataset.state = taskState(t);
    pill.textContent = stateText(t);
    // The public tick only for kinds that may be published, once finished with a link
    const awam = row.querySelector('.tg-awam');
    row.querySelector('.tg-awam-label').classList.toggle('hidden', !AWAM_JENIS.includes(t.jenis));
    awam.disabled = !canPublish(t);
    if (awam.disabled) awam.checked = false;
    const note = row.querySelector('.tg-awam-note');
    const was = note.dataset.link;
    note.classList.toggle('hidden', !awam.checked);
    if (awam.checked && was !== t.link) {
        note.dataset.tone = 'wait';
        note.textContent = awamNote({ link: t.link });
    }
}

function readRows(root) {
    return Array.from(root.querySelectorAll('.tg-rows .tg-row')).map(row => ({
        id: row.dataset.id,
        jenis: row.querySelector('.tg-jenis').value,
        pic: row.querySelector('.tg-pic').value,
        tarikhAkhir: row.querySelector('.tg-due').value,
        link: row.querySelector('.tg-link').value.trim(),
        selesai: row.querySelector('.tg-done').checked,
        awam: row.querySelector('.tg-awam').checked && !row.querySelector('.tg-awam').disabled
    }));
}

function syncEmpty(root) {
    const none = !root.querySelector('.tg-rows .tg-row');
    root.querySelector('.tg-empty').classList.toggle('hidden', !none);
    const head = root.querySelector('.tg-thead');
    if (head) head.classList.toggle('hidden', none);
}

const RULES_MSG = 'Peraturan keselamatan untuk tugasan belum dikemas kini dalam Firebase Console. Tugasan tidak boleh disimpan sehingga peraturan baharu diterbitkan, supaya maklumat staf dan pautan tidak boleh dibaca oleh orang awam.';

function showSaveError(code) {
    if (code === 'offline') showToastNotification('Tiada sambungan internet. Perubahan tidak disimpan.', 'danger');
    else if (code === 'rules') showToastNotification('Belum boleh simpan: peraturan keselamatan tugasan belum diterbitkan.', 'danger');
    else if (code === 'unknown') showToastNotification('Tidak dapat menyemak peraturan keselamatan. Cuba lagi.', 'danger');
    else showToastNotification('Ralat simpan. Cuba lagi.', 'danger');
}

async function checkRulesBanner(root) {
    const warn = root.querySelector('.tg-rules-warn');
    warn.classList.add('hidden');
    const r = await checkTugasanRules();
    if (r === 'open') {
        warn.textContent = RULES_MSG;
        warn.classList.remove('hidden');
    }
}

function syncStafNote(root) {
    root.querySelector('.tg-staf-empty').classList.toggle('hidden', (cache.staf || []).length > 0);
}

function bindEditor(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('click', (e) => {
        const ctx = root._tg;
        if (!ctx) return;
        if (e.target.closest('.tg-staf-link')) { openStafSheet(); return; }
        if (e.target.closest('.tg-staf-go')) { openStafSheet({ addRow: true }); return; }
        if (e.target.closest('.tg-save')) { saveEditor(root); return; }
        const rm = e.target.closest('.tg-remove');
        if (rm) { rm.closest('.tg-row').remove(); syncEmpty(root); root.dataset.dirty = '1'; return; }
        if (e.target.closest('.tg-add')) {
            const rows = root.querySelector('.tg-rows');
            const used = new Set(readRows(root).map(t => t.jenis));
            const next = (JENIS_TUGASAN.find(j => !used.has(j.jenis)) || JENIS_TUGASAN[JENIS_TUGASAN.length - 1]).jenis;
            rows.insertAdjacentHTML('beforeend', taskRowHtml({ id: genId('tg'), jenis: next, tarikhAkhir: suggestedDue(next, ctx.item) }, cache.staf, ctx.inst));
            rows.lastElementChild.querySelector('.tg-due').removeAttribute('data-touched');
            syncEmpty(root);
            root.dataset.dirty = '1';
            rows.lastElementChild.querySelector('.tg-jenis').focus();
        }
    });
    root.addEventListener('input', (e) => {
        const row = e.target.closest('.tg-row');
        if (!row) return;
        root.dataset.dirty = '1';
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
    root.addEventListener('change', (e) => {
        const row = e.target.closest('.tg-row');
        if (!row) return;
        root.dataset.dirty = '1';
        if (e.target.classList.contains('tg-done')) e.target.dataset.touched = '1';
        // Changing the kind moves an untouched due date to that kind's suggestion
        if (e.target.classList.contains('tg-jenis')) {
            const due = row.querySelector('.tg-due');
            if (!due.dataset.touched) due.value = suggestedDue(e.target.value, root._tg.item);
            row.querySelector('.tg-remove').setAttribute('aria-label', `Buang tugasan ${e.target.value}`);
        }
        if (e.target.classList.contains('tg-due')) e.target.dataset.touched = '1';
        refreshRowState(row);
    });
}

export function mountEditor(root, ctx) {
    const inst = `e${++editorSeq}`;
    root._tg = Object.assign({ inst }, ctx);
    root.classList.add('tg-editor');
    root.classList.toggle('is-wide', !!ctx.wide);
    delete root.dataset.dirty;
    const { item, kpi } = ctx;
    const prog = findProgram(cache.programs, item, kpi.id);
    const tasks = prog && Array.isArray(prog.tasks) ? prog.tasks : null;
    // A programme without tasks starts with the usual three, due dates
    // suggested from its dates (nothing is saved until Simpan)
    const list = tasks || JENIS_TUGASAN.filter(j => j.lalai).map(j => ({
        id: genId('tg'), jenis: j.jenis, pic: '', tarikhAkhir: suggestedDue(j.jenis, item), link: '', selesai: false
    }));
    const folder = prog && prog.robot && safeLink(prog.robot.folderUrl);
    const info = ctx.wide ? '' : `
        <div class="fs-summary">
            <p class="tg-info">${escapeHtml(item.name || '')}${item.tarikh ? `, <strong>${escapeHtml(programDates(item))}</strong>` : ''}.`
            + (tasks ? '' : ' Tiga tugasan biasa dicadangkan di bawah. Tetapkan PIC dan tekan Simpan.')
            + (folder ? ` <a class="tg-folder" href="${escapeHtml(folder)}" target="_blank" rel="noopener noreferrer">Buka folder program</a>` : '')
            + `</p>${robotStatusText(cache.robot) ? `<p class="tg-robot-status">${escapeHtml(robotStatusText(cache.robot))}</p>` : ''}
        </div>`;
    root.innerHTML = `
        <div class="tg-warn tg-rules-warn hidden" role="alert"></div>
        <div class="tg-note tg-staf-empty hidden">
            <p><i class="ph-duotone ph-users-three" aria-hidden="true"></i><span>Senarai staf masih kosong. Tambah staf dahulu supaya PIC boleh dipilih.</span></p>
            <button type="button" class="tg-note-btn tg-staf-go"><i class="fas fa-plus" aria-hidden="true"></i> Tambah staf</button>
        </div>
        ${info}
        ${!tasks && ctx.wide ? '<p class="fs-hint">Tiga tugasan biasa dicadangkan di bawah. Tetapkan PIC dan tekan Simpan perubahan.</p>' : ''}
        <div class="tg-table">
            ${ctx.wide ? '<div class="tg-thead" aria-hidden="true"><span>Dokumen</span><span>PIC</span><span>Tarikh akhir</span><span>Pautan Google Drive</span><span>Status</span><span></span></div>' : ''}
            <div class="tg-rows">${list.map(t => taskRowHtml(t, cache.staf, inst)).join('')}</div>
        </div>
        <p class="fs-hint tg-empty hidden">Tiada tugasan. Tekan "Tambah tugasan" untuk mula.</p>
        <button type="button" class="tg-add"><i class="fas fa-plus" aria-hidden="true"></i> Tambah tugasan</button>
        <p class="fs-hint">Bot mencipta folder Google Drive bagi setiap PIC. Jika fail disimpan di tempat lain, tampal pautannya di sini dan pastikan fail dikongsi dengan staf UPSI sahaja.</p>
        ${ctx.wide ? '<div class="tg-panel-actions"><button type="button" class="tg-save">Simpan perubahan</button></div>' : ''}`;
    // Suggested dates of an unsaved programme follow a kind change
    if (!tasks) root.querySelectorAll('.tg-due').forEach(el => { delete el.dataset.touched; });
    bindEditor(root);
    syncEmpty(root);
    syncStafNote(root);
    mountedEditors.add(root);
    checkRulesBanner(root);
}

export async function saveEditor(root) {
    const ctx = root._tg;
    if (!ctx) return false;
    const { kpi, item } = ctx;
    const tasks = readRows(root);
    for (const t of tasks) {
        if (t.link && !safeLink(t.link)) {
            showToastNotification(`Pautan ${t.jenis} mesti bermula dengan https://`, 'danger');
            return false;
        }
    }
    const program = {
        key: programKey(item), kpiId: kpi.id, name: item.name || '',
        tarikh: item.tarikh || '', tasks
    };
    if (item.tarikhTamat) program.tarikhTamat = item.tarikhTamat;
    const res = await saveProgramTugasan(selectedYear, program);
    if (typeof res === 'string') { showSaveError(res); return false; }
    const list = cache.programs || [];
    const i = list.findIndex(p => p.key === program.key);
    if (i === -1) list.push(res); else list[i] = res;
    cache.programs = list;
    delete root.dataset.dirty;
    pubCache.year = null;   // the public copy may have changed with this save
    showToastNotification('Tugasan disimpan.', 'success');
    if (ctx.onSaved) ctx.onSaved(res);
    document.dispatchEvent(new CustomEvent('tugasan-saved'));
    return true;
}

// ---- "Agih tugasan" sheet (Butiran, and the Tugasan tab below desktop) --
function ensureSheet() {
    let modal = document.getElementById('tugasan-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'tugasan-modal';
    modal.className = 'modal form-sheet fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = formSheetHtml({
        prefix: 'tugasan-modal', formId: 'tugasan-form', title: 'Agih tugasan',
        body: '<div id="tugasan-editor"></div>'
    });
    document.body.appendChild(modal);
    const close = () => closeFormSheet(modal);
    modal.querySelector('#tugasan-modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#tugasan-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await saveEditor(modal.querySelector('#tugasan-editor'))) closeFormSheet(modal);
    });
    return modal;
}

export async function openTugasanSheet(kpi, item, onSaved) {
    const data = await loadTugasan();
    if (data.programs === null || data.staf === null) {
        showToastNotification('Tugasan tidak dapat dibaca. Cuba lagi.', 'danger');
        return;
    }
    const modal = ensureSheet();
    modal.querySelector('#tugasan-modal-subtitle').textContent = item.name || '';
    mountEditor(modal.querySelector('#tugasan-editor'), { kpi, item, wide: false, onSaved });
    openModal(modal);
}

// ---- "Senarai staf" sheet -----------------------------------------------
// Each staff card shows how many open / late tasks they hold this year, and
// warns when the email is missing (the robot cannot share or remind then).
function stafLoad(staf) {
    const out = {};
    (staf || []).forEach(s => { out[s.id] = { aktif: 0, lewat: 0 }; });
    (cache.programs || []).forEach(p => (p.tasks || []).forEach(t => {
        if (!t.pic || !out[t.pic]) return;
        const st = taskState(t);
        if (st !== 'selesai') out[t.pic].aktif++;
        if (st === 'lewat') out[t.pic].lewat++;
    }));
    return out;
}

function stafRowHtml(s, load) {
    const uid = escapeHtml(s.id);
    const l = load && load[s.id];
    const badge = !l || (!l.aktif && !l.lewat) ? '<span class="tg-staf-badge">Tiada tugasan aktif</span>'
        : `<span class="tg-staf-badge${l.lewat ? ' is-late' : ''}">${l.aktif} aktif${l.lewat ? ` · ${l.lewat} lewat` : ''}</span>`;
    const noEmail = !s.emel;
    return `
        <div class="tg-staf-row${noEmail ? ' no-email' : ''}" data-id="${uid}">
            <div class="tg-staf-top"><label class="tg-staf-lbl" for="st-nama-${uid}">Nama</label>${s.nama ? badge : ''}</div>
            <input type="text" id="st-nama-${uid}" class="fs-input tg-staf-nama" placeholder="Nama penuh" value="${escapeHtml(s.nama || '')}">
            <label class="tg-staf-lbl" for="st-emel-${uid}">Emel UPSI</label>
            <div class="tg-staf-line">
                <input type="email" id="st-emel-${uid}" class="fs-input tg-staf-emel" inputmode="email" placeholder="nama@upsi.edu.my" value="${escapeHtml(s.emel || '')}"${noEmail ? ` aria-describedby="st-nota-${uid}"` : ''}>
                <button type="button" class="tg-staf-remove" aria-label="Buang ${escapeHtml(s.nama || 'staf ini')}"><i class="fas fa-times" aria-hidden="true"></i></button>
            </div>
            <p id="st-nota-${uid}" class="tg-staf-nota${noEmail ? '' : ' hidden'}">Tiada emel: bot tidak dapat berkongsi folder atau menghantar peringatan.</p>
        </div>`;
}

function ensureStafSheet() {
    let modal = document.getElementById('staf-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'staf-modal';
    modal.className = 'modal form-sheet fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = formSheetHtml({
        prefix: 'staf-modal', formId: 'staf-form', title: 'Senarai staf',
        body: `
            <p class="tg-info-box">Bot menggunakan emel UPSI untuk berkongsi folder Google Drive dan menghantar peringatan kepada PIC.</p>
            <div id="staf-rows" class="tg-staf-rows"></div>
            <button type="button" id="staf-add" class="tg-add"><i class="fas fa-plus" aria-hidden="true"></i> Tambah staf</button>
            <p class="fs-hint">Staf yang dibuang kekal pada tugasan lama mereka sebagai "Staf telah dibuang".</p>`
    });
    document.body.appendChild(modal);
    const close = () => closeFormSheet(modal);
    modal.querySelector('#staf-modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#staf-add').addEventListener('click', () => addStafRow(modal));
    const rows = modal.querySelector('#staf-rows');
    rows.addEventListener('click', (e) => {
        const rm = e.target.closest('.tg-staf-remove');
        if (rm) rm.closest('.tg-staf-row').remove();
    });
    rows.addEventListener('input', (e) => {
        if (!e.target.classList.contains('tg-staf-emel')) return;
        const row = e.target.closest('.tg-staf-row');
        const none = !e.target.value.trim();
        row.classList.toggle('no-email', none);
        row.querySelector('.tg-staf-nota').classList.toggle('hidden', !none);
    });
    modal.querySelector('#staf-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await saveStaf(modal)) closeFormSheet(modal);
    });
    return modal;
}

function addStafRow(modal) {
    const box = modal.querySelector('#staf-rows');
    const blank = Array.from(box.querySelectorAll('.tg-staf-nama')).find(i => !i.value.trim());
    if (blank) { blank.focus(); return; }
    box.insertAdjacentHTML('beforeend', stafRowHtml({ id: genId('st'), nama: '', emel: '' }));
    const nama = box.lastElementChild.querySelector('.tg-staf-nama');
    nama.focus();
    nama.scrollIntoView({ block: 'nearest' });
}

function stafSubtitle(n) {
    return n ? `${n} staf boleh diberi tugasan` : 'Belum ada staf';
}

// opts: { addRow } opens with an empty row ready; { focusId } jumps to one
// staff member's email (the "Tambah emel" button in Ikut PIC)
export async function openStafSheet(opts = {}) {
    const data = await loadTugasan();
    if (data.staf === null) {
        showToastNotification('Senarai staf tidak dapat dibaca. Cuba lagi.', 'danger');
        return;
    }
    const modal = ensureStafSheet();
    const staf = data.staf || [];
    const load = stafLoad(staf);
    modal.querySelector('#staf-modal-subtitle').textContent = stafSubtitle(staf.length);
    modal.querySelector('#staf-rows').innerHTML = staf.map(s => stafRowHtml(s, load)).join('');
    openModal(modal);
    if (opts.addRow || !staf.length) addStafRow(modal);
    else if (opts.focusId) {
        const row = modal.querySelector(`.tg-staf-row[data-id="${CSS.escape(opts.focusId)}"]`);
        const input = row && row.querySelector('.tg-staf-emel');
        if (input) { input.focus(); input.scrollIntoView({ block: 'center' }); }
    }
}

async function saveStaf(modal) {
    const rows = Array.from(modal.querySelectorAll('#staf-rows .tg-staf-row')).map(r => ({
        id: r.dataset.id,
        nama: r.querySelector('.tg-staf-nama').value.trim(),
        emel: r.querySelector('.tg-staf-emel').value.trim().toLowerCase()
    })).filter(s => s.nama || s.emel);
    for (const s of rows) {
        if (!s.nama) { showToastNotification('Setiap staf perlu ada nama.', 'danger'); return false; }
        if (s.emel && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.emel)) {
            showToastNotification(`Emel ${s.nama} tidak sah.`, 'danger'); return false;
        }
    }
    const res = await saveStafList(rows);
    if (res !== 'ok') { showSaveError(res); return false; }
    cache.staf = rows;
    // Open editors keep what the admin picked, with the new names
    mountedEditors.forEach(root => {
        if (!root.isConnected) { mountedEditors.delete(root); return; }
        root.querySelectorAll('.tg-pic').forEach(sel => { sel.innerHTML = picOptions(rows, sel.value); });
        syncStafNote(root);
    });
    showToastNotification('Senarai staf disimpan.', 'success');
    document.dispatchEvent(new CustomEvent('tugasan-staf-saved'));
    return true;
}

// Used by todo.js: overdue tasks and programmes with no tasks, for the
// programmes still in the year's programme KPIs
export async function tugasanOverview(q4, year, today = todayKey()) {
    const [programs, staf] = await Promise.all([getTugasanYear(year), getStafList()]);
    if (programs === null) return null;
    const late = [];
    const unassigned = [];
    (q4 && q4.kpis || []).filter(k => TUGASAN_KPI_IDS.has(k.id)).forEach(kpi => {
        const items = (kpi.details && Array.isArray(kpi.details.items)) ? kpi.details.items : [];
        items.forEach(item => {
            if (!item.tarikh) return;
            const prog = findProgram(programs, item, kpi.id);
            const tasks = prog && Array.isArray(prog.tasks) ? prog.tasks : [];
            if (!tasks.length) {
                if (inAssignWindow(item, today)) unassigned.push(item);
                return;
            }
            tasks.forEach(t => {
                if (taskState(t, today) === 'lewat') late.push({ item, task: t, pic: stafName(staf, t.pic), kpi });
            });
        });
    });
    return { late, unassigned };
}
