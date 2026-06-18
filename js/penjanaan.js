// --- JS/PENJANAAN.JS ---
// Penjanaan Dana (Fundraising) feature module — available from year 2026.
// Reads/writes the "pendanaan" KPI's details.items via updateKpiBreakdownList.
// Items optionally carry a `bulan` (1-12) used to group records by Suku (quarter).

import {
    showToastNotification,
    openModal,
    closeModal,
    showConfirmModal
} from './ui.js';

import {
    updateKpiBreakdownList,
    getAllPendanaanItems,
    getPendanaanItemsForQuarter,
    getPendanaanKpiTarget
} from './api.js';

import { statusBarClass } from './status.js';

const PENDANAAN_KPI_ID = 'pendanaan';

const BULAN_MY = ['', 'Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogos', 'Sep', 'Okt', 'Nov', 'Dis'];
const BULAN_FULL = ['', 'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

// Suku (quarter) metadata
const SUKU = [
    { key: 'q1', label: 'Suku 1', range: 'Jan - Mac', months: [1, 2, 3] },
    { key: 'q2', label: 'Suku 2', range: 'Apr - Jun', months: [4, 5, 6] },
    { key: 'q3', label: 'Suku 3', range: 'Jul - Sep', months: [7, 8, 9] },
    { key: 'q4', label: 'Suku 4', range: 'Okt - Dis', months: [10, 11, 12] }
];

// Module state
let currentContainer = null;
let currentYear = null;
let isAdminMode = false;
let cachedItems = [];
let cachedTarget = 0;

// ---- Helpers ----------------------------------------------------------

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatRM(value) {
    const n = Number(value) || 0;
    return 'RM ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Map a bulan (1-12) to its starting quarter key.
function bulanToQuarterKey(bulan) {
    const b = parseInt(bulan, 10);
    if (isNaN(b) || b < 1 || b > 12) return null;
    return SUKU[Math.floor((b - 1) / 3)].key;
}

// Stable unique id for a record, so edit/delete never confuse look-alike rows.
function genId() {
    return 'pnj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ---- Modal (dynamically created, reuses .modal / .is-open CSS) ---------

function ensureModal() {
    let modal = document.getElementById('penjanaan-modal');
    if (modal) return modal;

    const monthOptions = BULAN_FULL
        .map((name, i) => i === 0 ? '' : `<option value="${i}">${name}</option>`)
        .join('');

    modal = document.createElement('div');
    modal.id = 'penjanaan-modal';
    modal.className = 'modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-lg shadow-2xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="penjanaan-modal-title">
            <div class="flex justify-between items-center mb-4">
                <h3 id="penjanaan-modal-title" class="text-xl font-bold text-brand-primary">Tambah Rekod</h3>
                <button type="button" id="penjanaan-modal-close" class="text-gray-500 hover:text-red-600 text-2xl font-bold" aria-label="Tutup modal">&times;</button>
            </div>
            <form id="penjanaan-form" class="space-y-4">
                <input type="hidden" id="penjanaan-orig-index">
                <input type="hidden" id="penjanaan-orig-bulan">
                <input type="hidden" id="penjanaan-orig-name">
                <input type="hidden" id="penjanaan-orig-value">
                <input type="hidden" id="penjanaan-orig-id">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Sumber <span class="text-red-500">*</span></label>
                    <input type="text" id="penjanaan-sumber" required placeholder="Contoh: Sumbangan Korporat"
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Jumlah (RM) <span class="text-red-500">*</span></label>
                    <input type="number" id="penjanaan-jumlah" required min="0" step="0.01" placeholder="0.00"
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Bulan <span class="text-red-500">*</span></label>
                    <select id="penjanaan-bulan" required
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary bg-white">
                        <option value="">— Pilih Bulan —</option>
                        ${monthOptions}
                    </select>
                </div>
                <div class="flex gap-2 pt-2">
                    <button type="button" id="penjanaan-cancel-btn"
                        class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-semibold">Batal</button>
                    <button type="submit"
                        class="flex-1 bg-brand-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-800 transition-all">Simpan</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);

    const close = () => closeModal(modal);
    modal.querySelector('#penjanaan-modal-close').addEventListener('click', close);
    modal.querySelector('#penjanaan-cancel-btn').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelector('#penjanaan-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const sumber = modal.querySelector('#penjanaan-sumber').value.trim();
        const jumlah = parseFloat(modal.querySelector('#penjanaan-jumlah').value);
        const bulan = parseInt(modal.querySelector('#penjanaan-bulan').value, 10);

        if (!sumber || isNaN(jumlah) || isNaN(bulan)) {
            showToastNotification('Sila isi Sumber, Jumlah dan Bulan.', 'danger');
            return;
        }

        const origIndexRaw = modal.querySelector('#penjanaan-orig-index').value;
        const isEdit = origIndexRaw !== '';
        close();

        if (isEdit) {
            const orig = {
                index: parseInt(origIndexRaw, 10),
                bulan: parseInt(modal.querySelector('#penjanaan-orig-bulan').value, 10),
                name: modal.querySelector('#penjanaan-orig-name').value,
                value: parseFloat(modal.querySelector('#penjanaan-orig-value').value),
                id: modal.querySelector('#penjanaan-orig-id').value || null
            };
            await editRecord(orig, { name: sumber, value: jumlah, bulan });
        } else {
            await addRecord({ name: sumber, value: jumlah, bulan });
        }
    });

    return modal;
}

function openRecordModal(record) {
    const modal = ensureModal();
    const isEdit = !!record;
    modal.querySelector('#penjanaan-modal-title').textContent = isEdit ? 'Edit Rekod' : 'Tambah Rekod';
    modal.querySelector('#penjanaan-sumber').value = isEdit ? (record.name || '') : '';
    modal.querySelector('#penjanaan-jumlah').value = isEdit ? (record.value != null ? record.value : '') : '';
    modal.querySelector('#penjanaan-bulan').value = isEdit && record.bulan ? String(record.bulan) : '';
    modal.querySelector('#penjanaan-orig-index').value = isEdit ? String(record._index) : '';
    modal.querySelector('#penjanaan-orig-bulan').value = isEdit && record.bulan ? String(record.bulan) : '';
    modal.querySelector('#penjanaan-orig-name').value = isEdit ? (record.name || '') : '';
    modal.querySelector('#penjanaan-orig-value').value = isEdit ? String(record.value != null ? record.value : '') : '';
    modal.querySelector('#penjanaan-orig-id').value = isEdit && record.id ? String(record.id) : '';
    openModal(modal);
}

// ---- Detail popup (tap a record to see full info) ---------------------
// On small screens the source name is truncated; tapping a row opens this
// read-only popup with the complete details (and admin actions).

function ensureDetailModal() {
    let modal = document.getElementById('penjanaan-detail-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'penjanaan-detail-modal';
    modal.className = 'modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="penjanaan-detail-title">
            <div class="flex justify-between items-start mb-4">
                <h3 id="penjanaan-detail-title" class="text-lg font-bold text-brand-primary flex items-center gap-2">
                    <i class="ph-duotone ph-receipt"></i><span>Butiran Rekod</span>
                </h3>
                <button type="button" id="penjanaan-detail-close" class="text-gray-500 hover:text-red-600 text-2xl font-bold leading-none" aria-label="Tutup">&times;</button>
            </div>
            <div id="penjanaan-detail-body" class="space-y-3"></div>
            <div id="penjanaan-detail-actions" class="flex gap-2 pt-5"></div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => closeModal(modal);
    modal.querySelector('#penjanaan-detail-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    return modal;
}

function openDetailModal(record) {
    const modal = ensureDetailModal();
    const qk = bulanToQuarterKey(record.bulan);
    const suku = SUKU.find(s => s.key === qk);
    const bulanName = record.bulan ? (BULAN_FULL[parseInt(record.bulan, 10)] || '—') : 'Tidak Dinyatakan';
    const sukuLabel = suku ? `${suku.label} · ${suku.range}` : 'Tidak Dinyatakan';

    modal.querySelector('#penjanaan-detail-body').innerHTML = `
        <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Sumber</p>
            <p class="text-base font-bold text-gray-800 break-words">${escapeHtml(record.name)}</p>
        </div>
        <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Jumlah</p>
            <p class="text-2xl font-extrabold text-brand-primary leading-none">${escapeHtml(formatRM(record.value))}</p>
        </div>
        <div class="grid grid-cols-2 gap-3 pt-1">
            <div>
                <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Bulan</p>
                <p class="text-sm font-semibold text-gray-700">${escapeHtml(bulanName)}</p>
            </div>
            <div>
                <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Suku</p>
                <p class="text-sm font-semibold text-gray-700">${escapeHtml(sukuLabel)}</p>
            </div>
        </div>`;

    const actions = modal.querySelector('#penjanaan-detail-actions');
    if (isAdminMode) {
        actions.innerHTML = `
            <button type="button" id="penjanaan-detail-edit" class="detail-btn-edit flex-1 px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg font-semibold hover:bg-blue-100 transition-all flex items-center justify-center gap-2"><i class="fas fa-pencil-alt text-xs"></i> Edit</button>
            <button type="button" id="penjanaan-detail-delete" class="detail-btn-delete flex-1 px-4 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg font-semibold hover:bg-red-100 transition-all flex items-center justify-center gap-2"><i class="fas fa-trash-alt text-xs"></i> Padam</button>`;
        actions.querySelector('#penjanaan-detail-edit').addEventListener('click', () => {
            closeModal(modal);
            openRecordModal(record);
        });
        actions.querySelector('#penjanaan-detail-delete').addEventListener('click', () => {
            closeModal(modal);
            showConfirmModal(
                'Padam Rekod?',
                `Adakah anda pasti mahu memadam rekod "${record.name}" (${formatRM(record.value)})? Tindakan ini tidak boleh diundur.`,
                async () => { await deleteRecord(record); }
            );
        });
    } else {
        actions.innerHTML = `
            <button type="button" id="penjanaan-detail-ok" class="flex-1 bg-brand-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-800 transition-all">Tutup</button>`;
        actions.querySelector('#penjanaan-detail-ok').addEventListener('click', () => closeModal(modal));
    }

    openModal(modal);
}

// ---- Write operations -------------------------------------------------

// Close the details-modal that updateKpiBreakdownList re-opens, then refresh.
function afterWrite() {
    const detailsModal = document.getElementById('details-modal');
    if (detailsModal) closeModal(detailsModal);
    refresh();
}

async function addRecord({ name, value, bulan }) {
    const quarterKey = bulanToQuarterKey(bulan);
    if (!quarterKey) {
        showToastNotification('Bulan tidak sah.', 'danger');
        return;
    }
    // Block true duplicates (same name AND same bulan). Same name in a different
    // month is intentional (e.g. "Tabung Alumni Care" Jan, Feb, Apr) and must be allowed.
    const existing = await getPendanaanItemsForQuarter(currentYear, quarterKey);
    if (existing.some(it => it.name === name && String(it.bulan ?? '') === String(bulan ?? ''))) {
        showToastNotification(
            `Rekod "${name}" untuk bulan ini sudah wujud dalam suku ini.`,
            'danger'
        );
        return;
    }
    await updateKpiBreakdownList(quarterKey, PENDANAAN_KPI_ID, { id: genId(), name, value, bulan }, 'add');
    afterWrite();
}

// Find the index of an item within a given quarter's items array.
function matchIndex(items, target) {
    // Prefer the stable id when present — unambiguous even for look-alike rows.
    if (target && target.id != null && target.id !== '') {
        const byId = items.findIndex(it => it.id != null && String(it.id) === String(target.id));
        if (byId !== -1) return byId;
    }
    // Fall back to bulan-aware match, then name+value (legacy records).
    let idx = items.findIndex(it =>
        it.name === target.name &&
        Number(it.value) === Number(target.value) &&
        Number(it.bulan) === Number(target.bulan)
    );
    if (idx === -1) {
        idx = items.findIndex(it =>
            it.name === target.name && Number(it.value) === Number(target.value)
        );
    }
    return idx;
}

// Locate an item's index within a specific starting quarter.
async function findItemIndexInQuarter(quarterKey, target) {
    const items = await getPendanaanItemsForQuarter(currentYear, quarterKey);
    return matchIndex(items, target);
}

// Resolve the starting quarter + index for a record. Uses bulan when present;
// otherwise scans q1->q4 to find the earliest quarter that contains the item
// (covers legacy records added via the dashboard breakdown modal without a bulan).
async function resolveRecordLocation(record) {
    const preferred = bulanToQuarterKey(record.bulan);
    if (preferred) {
        const idx = await findItemIndexInQuarter(preferred, record);
        if (idx !== -1) return { quarterKey: preferred, index: idx };
    }
    for (const s of SUKU) {
        const idx = await findItemIndexInQuarter(s.key, record);
        if (idx !== -1) return { quarterKey: s.key, index: idx };
    }
    return { quarterKey: null, index: -1 };
}

async function deleteRecord(record) {
    const loc = await resolveRecordLocation(record);
    if (loc.index === -1) {
        showToastNotification('Rekod tidak dijumpai untuk dipadam.', 'danger');
        return;
    }
    await updateKpiBreakdownList(loc.quarterKey, PENDANAAN_KPI_ID, loc.index, 'delete');
    afterWrite();
}

async function editRecord(orig, updated) {
    const newQuarter = bulanToQuarterKey(updated.bulan);
    if (!newQuarter) {
        showToastNotification('Bulan tidak sah.', 'danger');
        return;
    }

    const loc = await resolveRecordLocation(orig);
    if (loc.index === -1) {
        showToastNotification('Rekod asal tidak dijumpai.', 'danger');
        return;
    }
    const oldQuarter = loc.quarterKey;
    const idx = loc.index;

    // Keep the record's id stable; lazily assign one to legacy records so they
    // become unambiguous from this edit onward.
    const id = orig.id || genId();
    const data = { id, name: updated.name, value: updated.value, bulan: updated.bulan };

    if (oldQuarter === newQuarter) {
        // Same starting quarter — edit in place.
        await updateKpiBreakdownList(oldQuarter, PENDANAAN_KPI_ID, { index: idx, data }, 'edit');
    } else {
        // Quarter changed — must delete from old, add to new. Guard against the
        // add being silently dropped due to a same-name item in the new quarter.
        const newQItems = await getPendanaanItemsForQuarter(currentYear, newQuarter);
        if (newQItems.some(it => it.name === updated.name && String(it.bulan ?? '') === String(updated.bulan ?? ''))) {
            showToastNotification(
                `Rekod "${updated.name}" untuk bulan ini sudah wujud dalam suku sasaran.`,
                'danger'
            );
            return;
        }
        await updateKpiBreakdownList(oldQuarter, PENDANAAN_KPI_ID, idx, 'delete');
        await updateKpiBreakdownList(newQuarter, PENDANAAN_KPI_ID, data, 'add');
    }
    afterWrite();
}

// ---- Rendering --------------------------------------------------------

function recordRowHtml(item, globalIndex) {
    const bulanBadge = item.bulan
        ? `<span class="inline-flex items-center text-xs font-semibold bg-blue-50 text-brand-primary rounded-full px-2 py-0.5 flex-shrink-0">${escapeHtml(BULAN_MY[parseInt(item.bulan, 10)] || '?')}</span>`
        : `<span class="inline-flex items-center text-xs font-semibold bg-gray-100 text-gray-400 rounded-full px-2 py-0.5 flex-shrink-0">—</span>`;

    const adminHtml = isAdminMode
        ? `<div class="flex items-center gap-1 flex-shrink-0">
               <button class="penjanaan-edit-btn text-gray-400 hover:text-brand-primary p-1" data-idx="${globalIndex}" title="Edit"><i class="fas fa-pencil-alt text-xs"></i></button>
               <button class="penjanaan-delete-btn text-red-400 hover:text-red-600 p-1" data-idx="${globalIndex}" title="Padam"><i class="fas fa-trash-alt text-xs"></i></button>
           </div>` : '';

    return `
    <div class="penjanaan-record-row flex items-center gap-2 py-2 px-1.5 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors" data-idx="${globalIndex}" role="button" tabindex="0" title="Lihat butiran">
        ${bulanBadge}
        <span class="flex-1 min-w-0 text-sm text-gray-700 truncate">${escapeHtml(item.name)}</span>
        <span class="text-sm font-bold text-brand-primary flex-shrink-0">${escapeHtml(formatRM(item.value))}</span>
        ${adminHtml}
    </div>`;
}

function monthDividerHtml(monthNum, monthTotal) {
    return `
    <div class="penjanaan-month-divider flex items-center justify-between px-2.5 py-1.5 mt-2.5 mb-1 bg-gray-50 rounded-lg">
        <span class="text-xs font-bold text-gray-600 uppercase tracking-wider">${escapeHtml(BULAN_FULL[monthNum] || BULAN_MY[monthNum] || '')}</span>
        <span class="text-xs font-extrabold text-gray-500">${escapeHtml(formatRM(monthTotal))}</span>
    </div>`;
}

function sukuGroupHtml(suku, items) {
    const subtotal = items.reduce((sum, it) => sum + (Number(it.value) || 0), 0);

    let body;
    if (!items.length) {
        body = `<p class="text-xs text-gray-400 italic py-2 px-1">Tiada rekod untuk suku ini.</p>`;
    } else if (Array.isArray(suku.months) && suku.months.length) {
        // Group records by month (in calendar order), each with its own divider + subtotal.
        const parts = [];
        suku.months.forEach(m => {
            const monthItems = items.filter(it => Number(it.bulan) === m);
            if (!monthItems.length) return;
            const monthTotal = monthItems.reduce((sum, it) => sum + (Number(it.value) || 0), 0);
            parts.push(monthDividerHtml(m, monthTotal));
            parts.push(monthItems.map(it => recordRowHtml(it, it._index)).join(''));
        });
        // Defensive: any record whose bulan falls outside this suku (shouldn't happen).
        const leftover = items.filter(it => !suku.months.includes(Number(it.bulan)));
        if (leftover.length) parts.push(leftover.map(it => recordRowHtml(it, it._index)).join(''));
        body = parts.join('');
    } else {
        // "Tidak Dinyatakan" — no month sequence, list as-is.
        body = items.map(it => recordRowHtml(it, it._index)).join('');
    }

    return `
    <div class="penjanaan-suku bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
        <div class="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <div>
                <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(suku.label)}</h4>
                <p class="text-xs text-gray-400">${escapeHtml(suku.range)}</p>
            </div>
            <span class="text-sm font-extrabold text-brand-primary">${escapeHtml(formatRM(subtotal))}</span>
        </div>
        ${body}
    </div>`;
}

function render() {
    if (!currentContainer) return;

    // Pre-2026 gate
    if (parseInt(currentYear, 10) < 2026) {
        currentContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center text-center p-10 bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-200">
            <div class="bg-amber-50 p-4 rounded-full mb-4">
                <i class="ph-duotone ph-lock-simple text-amber-500 text-4xl"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-700 mb-1">Tidak Tersedia</h3>
            <p class="text-gray-500 text-sm">Rekod penjanaan tersedia dari tahun 2026.</p>
        </div>`;
        return;
    }

    // Attach a stable global index to each item so admin actions can map back.
    const itemsIndexed = cachedItems.map((it, i) => ({ ...it, _index: i }));
    const total = itemsIndexed.reduce((sum, it) => sum + (Number(it.value) || 0), 0);
    const pct = cachedTarget > 0 ? Math.min((total / cachedTarget) * 100, 100) : 0;
    const pctRaw = cachedTarget > 0 ? (total / cachedTarget) * 100 : 0;
    const barColor = statusBarClass(pctRaw);

    const addBtnHtml = isAdminMode
        ? `<button id="penjanaan-add-btn" class="bg-brand-primary text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-800 shadow-md transition-all text-sm flex items-center gap-2 flex-shrink-0">
               <i class="fas fa-plus-circle"></i><span>Tambah Rekod</span>
           </button>` : '';

    // Group items into Suku buckets; null/invalid bulan -> "Tidak Dinyatakan".
    const buckets = { q1: [], q2: [], q3: [], q4: [], none: [] };
    itemsIndexed.forEach(it => {
        const qk = bulanToQuarterKey(it.bulan);
        if (qk) buckets[qk].push(it);
        else buckets.none.push(it);
    });

    let groupsHtml;
    if (!itemsIndexed.length) {
        groupsHtml = `
        <div class="flex flex-col items-center justify-center text-center p-10 bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-200">
            <div class="bg-blue-50 p-4 rounded-full mb-4">
                <i class="ph-duotone ph-currency-circle-dollar text-brand-primary text-4xl"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-700 mb-1">Tiada Rekod</h3>
            <p class="text-gray-500 text-sm">${isAdminMode ? 'Tekan "Tambah Rekod" untuk mula merekod penjanaan dana.' : 'Belum ada rekod penjanaan untuk tahun ini.'}</p>
        </div>`;
    } else {
        groupsHtml = SUKU.map(s => sukuGroupHtml(s, buckets[s.key])).join('');
        if (buckets.none.length) {
            groupsHtml += sukuGroupHtml({ label: 'Tidak Dinyatakan', range: 'Bulan tidak direkodkan', months: [] }, buckets.none);
        }
    }

    currentContainer.innerHTML = `
    <div class="penjanaan-wrapper">
        <div class="flex items-center justify-between gap-3 mb-5">
            <h2 class="text-lg sm:text-xl font-bold text-brand-primary flex items-center gap-2 min-w-0">
                <i class="ph-duotone ph-currency-circle-dollar flex-shrink-0"></i>
                <span class="truncate">Penjanaan Dana ${escapeHtml(currentYear)}</span>
            </h2>
            ${addBtnHtml}
        </div>

        <div class="bg-brand-primary text-white rounded-2xl p-5 mb-5 shadow-lg shadow-blue-900/20">
            <div class="flex items-end justify-between gap-3 mb-3">
                <div class="min-w-0">
                    <p class="text-white/70 text-xs font-medium mb-1">Jumlah Terkumpul</p>
                    <p class="text-2xl sm:text-3xl font-extrabold leading-none">${escapeHtml(formatRM(total))}</p>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="text-white/70 text-xs font-medium mb-1">Sasaran</p>
                    <p class="text-base font-bold leading-none">${escapeHtml(formatRM(cachedTarget))}</p>
                </div>
            </div>
            <div class="w-full bg-white/20 rounded-full h-3 overflow-hidden">
                <div class="${barColor} h-3 rounded-full transition-all duration-700" style="width:${pct}%"></div>
            </div>
            <p class="text-right text-white/90 text-sm font-bold mt-1.5">${pctRaw.toFixed(2)}%</p>
        </div>

        ${groupsHtml}
    </div>`;

    // Wire listeners
    const addBtn = currentContainer.querySelector('#penjanaan-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => openRecordModal(null));

    // Tap any record row -> detail popup (full info, untruncated). Available to
    // everyone; clicks on the inline admin buttons are ignored here.
    currentContainer.querySelectorAll('.penjanaan-record-row').forEach(row => {
        const open = (e) => {
            if (e.target.closest('.penjanaan-edit-btn, .penjanaan-delete-btn')) return;
            const item = itemsIndexed[parseInt(row.dataset.idx, 10)];
            if (item) openDetailModal(item);
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); }
        });
    });

    if (isAdminMode) {
        currentContainer.querySelectorAll('.penjanaan-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = itemsIndexed[parseInt(btn.dataset.idx, 10)];
                if (item) openRecordModal(item);
            });
        });
        currentContainer.querySelectorAll('.penjanaan-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = itemsIndexed[parseInt(btn.dataset.idx, 10)];
                if (!item) return;
                showConfirmModal(
                    'Padam Rekod?',
                    `Adakah anda pasti mahu memadam rekod "${item.name}" (${formatRM(item.value)})? Tindakan ini tidak boleh diundur.`,
                    async () => { await deleteRecord(item); }
                );
            });
        });
    }
}

// Re-fetch cumulative items + KPI target and re-render.
async function refresh() {
    if (!currentContainer) return;
    if (parseInt(currentYear, 10) < 2026) { render(); return; }
    [cachedItems, cachedTarget] = await Promise.all([
        getAllPendanaanItems(currentYear),
        getPendanaanKpiTarget(currentYear)
    ]);
    render();
}

// ---- Public API -------------------------------------------------------

export function initPenjanaan(containerEl, isAdmin, year) {
    if (!containerEl) return;
    currentContainer = containerEl;
    isAdminMode = !!isAdmin;
    currentYear = String(year);

    if (parseInt(currentYear, 10) < 2026) {
        render();
        return;
    }

    containerEl.innerHTML = `
        <div class="flex items-center justify-center p-10 text-gray-400">
            <i class="fas fa-spinner fa-spin mr-2"></i> Memuatkan rekod penjanaan...
        </div>`;
    refresh();
}
