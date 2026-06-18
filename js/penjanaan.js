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
                value: parseFloat(modal.querySelector('#penjanaan-orig-value').value)
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
    // updateKpiBreakdownList dedups by exact `name` within a quarter, so a record
    // sharing a source name with an existing one in the same starting quarter would
    // be silently dropped. Detect and warn instead of losing data quietly.
    const existing = await getPendanaanItemsForQuarter(currentYear, quarterKey);
    if (existing.some(it => it.name === name)) {
        showToastNotification(
            `Sumber "${name}" sudah wujud dalam suku ini. Sila bezakan nama (cth: tambah bulan).`,
            'danger'
        );
        return;
    }
    await updateKpiBreakdownList(quarterKey, PENDANAAN_KPI_ID, { name, value, bulan }, 'add');
    afterWrite();
}

// Find the index of an item within a given quarter's items array.
function matchIndex(items, target) {
    // Prefer exact bulan match; fall back to name+value if bulan missing on old records.
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

    if (oldQuarter === newQuarter) {
        // Same starting quarter — edit in place.
        await updateKpiBreakdownList(oldQuarter, PENDANAAN_KPI_ID,
            { index: idx, data: { name: updated.name, value: updated.value, bulan: updated.bulan } }, 'edit');
    } else {
        // Quarter changed — must delete from old, add to new. Guard against the
        // add being silently dropped due to a same-name item in the new quarter.
        const newQItems = await getPendanaanItemsForQuarter(currentYear, newQuarter);
        if (newQItems.some(it => it.name === updated.name)) {
            showToastNotification(
                `Sumber "${updated.name}" sudah wujud dalam suku sasaran. Sila bezakan nama.`,
                'danger'
            );
            return;
        }
        await updateKpiBreakdownList(oldQuarter, PENDANAAN_KPI_ID, idx, 'delete');
        await updateKpiBreakdownList(newQuarter, PENDANAAN_KPI_ID,
            { name: updated.name, value: updated.value, bulan: updated.bulan }, 'add');
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
    <div class="flex items-center gap-2 py-2 px-1 border-b border-gray-50 last:border-0">
        ${bulanBadge}
        <span class="flex-1 min-w-0 text-sm text-gray-700 truncate" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <span class="text-sm font-bold text-brand-primary flex-shrink-0">${escapeHtml(formatRM(item.value))}</span>
        ${adminHtml}
    </div>`;
}

function sukuGroupHtml(suku, items) {
    const subtotal = items.reduce((sum, it) => sum + (Number(it.value) || 0), 0);
    const rows = items.length
        ? items.map(it => recordRowHtml(it, it._index)).join('')
        : `<p class="text-xs text-gray-400 italic py-2 px-1">Tiada rekod untuk suku ini.</p>`;

    return `
    <div class="penjanaan-suku bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
        <div class="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <div>
                <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(suku.label)}</h4>
                <p class="text-xs text-gray-400">${escapeHtml(suku.range)}</p>
            </div>
            <span class="text-sm font-extrabold text-brand-primary">${escapeHtml(formatRM(subtotal))}</span>
        </div>
        ${rows}
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
    const barColor = pctRaw >= 75 ? 'bg-status-good' : pctRaw >= 30 ? 'bg-status-ok' : 'bg-status-bad';

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
