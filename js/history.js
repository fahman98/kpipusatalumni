// --- JS/HISTORY.JS ---
// "Sejarah Perubahan": the admin's view of the audit log. Read-only. Each
// entry says what was done, to which KPI or activity, and the old → new value
// where the log has it. Entries that carry a copy of deleted or replaced data
// (logged since the audit log started keeping them) can be expanded and the
// JSON copied, so a mistaken delete can be put back by hand.

import { openModal, closeModal, showToastNotification, escapeHtml } from './ui.js';
import { fetchAuditLogs, kpiDataCache } from './api.js';

const PAGE_SIZE = 30;
const QUARTER_LABEL = { q1: 'Suku 1', q2: 'Suku 2', q3: 'Suku 3', q4: 'Suku 4' };

let lastDoc = null;
let loading = false;
const entriesById = new Map();

// Plain-language name and icon for each logged action
const ACTIONS = {
    ADD_KPI:              { label: 'Tambah KPI',                 icon: 'fa-plus-circle',  tone: 'add' },
    EDIT_KPI_STRUCTURE:   { label: 'Ubah tetapan KPI',           icon: 'fa-cog',          tone: 'edit' },
    DELETE_KPI:           { label: 'Padam KPI',                  icon: 'fa-trash-alt',    tone: 'delete' },
    CLONE_YEAR:           { label: 'Salin struktur tahun',       icon: 'fa-copy',         tone: 'delete' },
    BULK_UPDATE_VALUES:   { label: 'Kemaskini nilai semua suku', icon: 'fa-layer-group',  tone: 'edit' },
    UPDATE_VALUE:         { label: 'Kemaskini nilai',            icon: 'fa-pencil-alt',   tone: 'edit' },
    EDIT_KPI_DESCRIPTION: { label: 'Ubah deskripsi KPI',         icon: 'fa-align-left',   tone: 'edit' },
    TOGGLE_CHECKLIST_ITEM:{ label: 'Tanda senarai semak',        icon: 'fa-check-square', tone: 'edit' },
    UPDATE_TARGET_LIST:   { label: 'Ubah senarai sasaran',       icon: 'fa-list',         tone: 'edit' },
    UPDATE_PROGRESS_ITEM: { label: 'Kemaskini kemajuan',         icon: 'fa-tasks',        tone: 'edit' },
    MOVE_BREAKDOWN_ITEM:  { label: 'Pindah rekod ke suku lain',  icon: 'fa-exchange-alt', tone: 'edit' },
    ADD_TAKWIM:           { label: 'Tambah aktiviti Takwim',     icon: 'fa-calendar-plus',tone: 'add' },
    EDIT_TAKWIM:          { label: 'Ubah aktiviti Takwim',       icon: 'fa-calendar-alt', tone: 'edit' },
    DELETE_TAKWIM:        { label: 'Padam aktiviti Takwim',      icon: 'fa-calendar-times', tone: 'delete' },
};
const BREAKDOWN_ACTIONS = {
    add:    { label: 'Tambah butiran', icon: 'fa-plus',      tone: 'add' },
    edit:   { label: 'Ubah butiran',   icon: 'fa-pencil-alt',tone: 'edit' },
    delete: { label: 'Padam butiran',  icon: 'fa-trash-alt', tone: 'delete' },
};

function actionInfo(entry) {
    if (entry.action === 'UPDATE_BREAKDOWN_ITEM') {
        const a = entry.details && entry.details.action;
        return BREAKDOWN_ACTIONS[a] || { label: 'Ubah butiran', icon: 'fa-pencil-alt', tone: 'edit' };
    }
    return ACTIONS[entry.action] || { label: entry.action || 'Tindakan', icon: 'fa-circle', tone: 'edit' };
}

const fmtNum = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : (v == null || v === '' ? '—' : String(v)));

function findKpi(kpiId) {
    for (const q of ['q1', 'q2', 'q3', 'q4']) {
        const kpis = kpiDataCache[q] && kpiDataCache[q].kpis;
        const k = kpis && kpis.find(x => x.id === kpiId);
        if (k) return k;
    }
    return null;
}

// Money KPIs read "RM 5,000", as on the card
function fmtVal(d, v) {
    const k = d && findKpi(d.kpiId);
    return k && k.isCurrency && typeof v === 'number' ? `RM ${fmtNum(v)}` : fmtNum(v);
}

// KPI name from the log itself, else from the year currently loaded, else its id
function kpiName(d) {
    if (!d) return '';
    if (d.name) return d.name;
    const deleted = d.deleted && (d.deleted.q1 || d.deleted.q2 || d.deleted.q3 || d.deleted.q4);
    if (deleted && deleted.name) return deleted.name;
    const k = findKpi(d.kpiId);
    return k ? k.name : (d.kpiId || '');
}

function formatWhen(ts) {
    const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d)) return '—';
    const date = d.toLocaleDateString('en-GB');
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
}

// One or two plain lines describing the change
function describe(entry) {
    const d = entry.details || {};
    const where = [kpiName(d), QUARTER_LABEL[d.quarterKey]].filter(Boolean).join(' · ');
    switch (entry.action) {
        case 'UPDATE_VALUE':
            return [where, `${d.oldValue !== undefined ? fmtVal(d, d.oldValue) : '?'} → ${fmtVal(d, d.newValue)}`];
        case 'BULK_UPDATE_VALUES': {
            const v = d.values || {};
            return [where, Object.keys(v).sort().map(q => `${QUARTER_LABEL[q] || q}: ${fmtVal(d, v[q])}`).join(', ')];
        }
        case 'EDIT_KPI_STRUCTURE':
            return [d.newName || where, `Sasaran: ${fmtNum(d.newTarget)}`];
        case 'UPDATE_BREAKDOWN_ITEM':
            if (d.action === 'delete' && d.deleted) return [where, `"${d.deleted.name}" (${fmtVal(d, d.deleted.value)})`];
            if (d.action === 'edit' && d.before) {
                const after = d.after || {};
                const name = after.name && after.name !== d.before.name ? `"${d.before.name}" → "${after.name}"` : `"${d.before.name}"`;
                const val = after.value !== undefined && after.value !== d.before.value ? `, ${fmtVal(d, d.before.value)} → ${fmtVal(d, after.value)}` : '';
                return [where, name + val];
            }
            if (d.action === 'add' && d.added) return [where, `"${d.added.name}" (${fmtVal(d, d.added.value)})`];
            return [where];
        case 'MOVE_BREAKDOWN_ITEM':
            return [kpiName(d), `"${d.name}" ${QUARTER_LABEL[d.from] || d.from} → ${QUARTER_LABEL[d.to] || d.to}`];
        case 'UPDATE_TARGET_LIST':
        case 'TOGGLE_CHECKLIST_ITEM':
            return [where, d.itemName || (typeof d.payload === 'string' ? d.payload : '')];
        case 'UPDATE_PROGRESS_ITEM':
            return [where, `${d.itemName || ''}${d.subItemName ? ' › ' + d.subItemName : ''}: ${fmtNum(d.newValue)}`];
        case 'DELETE_KPI':
            return [kpiName(d)];
        case 'ADD_KPI':
            return [d.name || kpiName(d)];
        case 'CLONE_YEAR':
            return [`${d.sourceYear} → ${d.targetYear || entry.year}${d.backup ? ' (sandaran dimuat turun)' : ''}`];
        case 'ADD_TAKWIM':
            return [d.title || ''];
        case 'EDIT_TAKWIM': {
            const before = d.before || {}, after = d.after || {};
            return [after.title || before.title || d.eventId || ''];
        }
        case 'DELETE_TAKWIM':
            return [(d.deleted && d.deleted.title) || d.eventId || ''];
        default:
            return [where];
    }
}

// The copy of removed / replaced data, if this entry has one
function snapshotOf(entry) {
    const d = entry.details || {};
    if (d.deleted) return { label: 'Data yang dipadam', data: d.deleted };
    if (d.before) return { label: 'Data sebelum perubahan', data: { sebelum: d.before, selepas: d.after } };
    return null;
}

function entryHtml(entry) {
    const info = actionInfo(entry);
    const lines = describe(entry).filter(Boolean);
    const snap = snapshotOf(entry);
    const toneCls = { add: 'history-tone-add', edit: 'history-tone-edit', delete: 'history-tone-delete' }[info.tone];
    return `
    <li class="history-entry flex gap-3 py-3">
        <div class="history-icon ${toneCls} flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center">
            <i class="fas ${info.icon} text-xs" aria-hidden="true"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-baseline justify-between gap-x-3">
                <p class="text-sm font-bold text-gray-800">${escapeHtml(info.label)}</p>
                <p class="text-xs text-gray-400 whitespace-nowrap">${escapeHtml(formatWhen(entry.timestamp))}${entry.year ? ` · ${escapeHtml(entry.year)}` : ''}</p>
            </div>
            ${lines.map(l => `<p class="text-xs text-gray-600 mt-0.5 break-words">${escapeHtml(l)}</p>`).join('')}
            ${snap ? `
            <details class="history-snapshot mt-1.5">
                <summary class="text-xs font-semibold text-brand-primary cursor-pointer select-none">${escapeHtml(snap.label)}</summary>
                <div class="mt-1.5">
                    <pre class="text-[11px] leading-snug bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-48">${escapeHtml(JSON.stringify(snap.data, null, 2))}</pre>
                    <button type="button" class="history-copy-btn mt-1 text-xs font-semibold text-gray-600 hover:text-brand-primary" data-entry-id="${escapeHtml(entry.id)}">
                        <i class="fas fa-copy mr-1" aria-hidden="true"></i>Salin data
                    </button>
                </div>
            </details>` : ''}
        </div>
    </li>`;
}

function ensureModal() {
    let modal = document.getElementById('history-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'history-modal';
    modal.className = 'modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 flex flex-col max-h-[85vh]" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
            <div class="flex justify-between items-start mb-1 flex-shrink-0">
                <h3 id="history-modal-title" class="text-lg font-bold text-brand-primary flex items-center gap-2">
                    <i class="fas fa-history" aria-hidden="true"></i><span>Sejarah Perubahan</span>
                </h3>
                <button type="button" id="history-modal-close" class="text-gray-500 hover:text-red-600 text-2xl font-bold leading-none" aria-label="Tutup">&times;</button>
            </div>
            <p class="text-xs text-gray-500 mb-3 flex-shrink-0">Perubahan terkini dahulu. Rekod sebelum 29/10/2026 hanya menyimpan ID, bukan salinan data.</p>
            <div class="overflow-y-auto -mx-1 px-1">
                <ul id="history-list" class="divide-y divide-gray-100"></ul>
                <p id="history-status" class="text-sm text-gray-400 text-center py-4 hidden"></p>
                <button type="button" id="history-more-btn" class="hidden w-full mt-2 text-sm font-semibold text-brand-primary bg-blue-50 hover:bg-blue-100 rounded-lg py-2">Muat lagi</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => closeModal(modal);
    modal.querySelector('#history-modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#history-more-btn').addEventListener('click', () => loadPage(false));
    modal.querySelector('#history-list').addEventListener('click', async (e) => {
        const btn = e.target.closest('.history-copy-btn');
        if (!btn) return;
        const entry = entriesById.get(btn.dataset.entryId);
        const snap = entry && snapshotOf(entry);
        if (!snap) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(snap.data, null, 2));
            showToastNotification('Data disalin ke papan klip.', 'success');
        } catch (_) {
            showToastNotification('Gagal menyalin. Pilih teks dan salin secara manual.', 'danger');
        }
    });
    return modal;
}

function setStatus(modal, text) {
    const el = modal.querySelector('#history-status');
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
}

async function loadPage(reset) {
    if (loading) return;
    const modal = ensureModal();
    const list = modal.querySelector('#history-list');
    const moreBtn = modal.querySelector('#history-more-btn');
    if (reset) {
        lastDoc = null;
        entriesById.clear();
        list.innerHTML = '';
    }
    loading = true;
    moreBtn.disabled = true;
    setStatus(modal, 'Memuatkan...');
    try {
        const { entries, last, done } = await fetchAuditLogs({ after: lastDoc, limit: PAGE_SIZE });
        entries.forEach(en => entriesById.set(en.id, en));
        list.insertAdjacentHTML('beforeend', entries.map(entryHtml).join(''));
        lastDoc = last || lastDoc;
        moreBtn.classList.toggle('hidden', done);
        setStatus(modal, !entriesById.size ? 'Tiada rekod perubahan.' : (done ? 'Tiada lagi rekod.' : ''));
    } catch (e) {
        console.error('fetchAuditLogs error:', e);
        setStatus(modal, e && e.code === 'permission-denied'
            ? 'Tiada kebenaran membaca sejarah perubahan.'
            : 'Gagal memuatkan sejarah. Semak sambungan internet.');
    } finally {
        loading = false;
        moreBtn.disabled = false;
    }
}

export function openHistory(triggerEl) {
    const modal = ensureModal();
    openModal(modal, triggerEl);
    loadPage(true);
}
