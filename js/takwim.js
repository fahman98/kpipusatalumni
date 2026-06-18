// --- JS/TAKWIM.JS ---
// Takwim Aktiviti (Activity Calendar) feature module.
// Renders a year's events into a container, with real-time Firestore sync,
// and admin add/edit/delete via a dynamically-created modal.

import {
    showToastNotification,
    openModal,
    closeModal,
    showConfirmModal
} from './ui.js';

import {
    subscribeTakwim,
    addTakwimEvent,
    updateTakwimEvent,
    deleteTakwimEvent
} from './api.js';

const BULAN_MY = ['', 'Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogos', 'Sep', 'Okt', 'Nov', 'Dis'];

// Module-level state
let unsubscribe = null;       // active Firestore listener cleanup
let currentYear = null;
let currentContainer = null;
let isAdminMode = false;
let cachedEvents = [];

// ---- Helpers ----------------------------------------------------------

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Format an ISO date string (YYYY-MM-DD) into "15 Jun 2026".
function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length !== 3) return escapeHtml(dateStr);
    const [y, m, d] = parts;
    const monthIdx = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (isNaN(monthIdx) || isNaN(day)) return escapeHtml(dateStr);
    return `${day} ${BULAN_MY[monthIdx] || m} ${y}`;
}

// Split date badge into day / mon / year. Supports optional dateTo for ranges.
function dateBadgeParts(dateStr, dateToStr) {
    const p = String(dateStr || '').split('-');
    if (p.length !== 3) return { day: '?', mon: '', year: '', range: '' };
    const startDay = parseInt(p[2], 10) || '?';
    const startMon = (BULAN_MY[parseInt(p[1], 10)] || '').toUpperCase();
    const startYear = p[0];

    if (dateToStr && dateToStr !== dateStr) {
        const q = String(dateToStr).split('-');
        if (q.length === 3) {
            const endDay = parseInt(q[2], 10) || '?';
            const endMon = (BULAN_MY[parseInt(q[1], 10)] || '').toUpperCase();
            const endYear = q[0];
            const sameMon = startMon === endMon && startYear === endYear;
            return {
                day: sameMon ? `${startDay}–${endDay}` : String(startDay),
                mon: startMon,
                year: startYear,
                range: sameMon ? '' : `– ${endDay} ${endMon} ${endYear}`
            };
        }
    }
    return { day: String(startDay), mon: startMon, year: startYear, range: '' };
}

// Today at local midnight (for past/future comparison by date only).
function todayKey() {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, '0');
    const dd = String(t.getDate()).padStart(2, '0');
    return `${t.getFullYear()}-${mm}-${dd}`;
}

// Known status values get a coloured pill; any other note is free text.
// Colours live in CSS (.status-pill-*) so they adapt to dark mode cleanly.
const STATUS_STYLES = {
    'Telah Berlangsung': { pill: 'status-pill status-pill-green', icon: 'ph-check-circle' },
    'Ditangguhkan':      { pill: 'status-pill status-pill-amber', icon: 'ph-pause-circle' },
    'Dibatalkan':        { pill: 'status-pill status-pill-red',   icon: 'ph-x-circle' }
};
function statusStyle(notes) {
    return STATUS_STYLES[notes] || null;
}

// ---- Modal (dynamically created, reuses .modal / .is-open CSS) ---------

function ensureModal() {
    let modal = document.getElementById('takwim-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'takwim-modal';
    modal.className = 'modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-lg shadow-2xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="takwim-modal-title">
            <div class="flex justify-between items-center mb-4">
                <h3 id="takwim-modal-title" class="text-xl font-bold text-brand-primary">Tambah Aktiviti</h3>
                <button type="button" id="takwim-modal-close" class="text-gray-500 hover:text-red-600 text-2xl font-bold" aria-label="Tutup modal">&times;</button>
            </div>
            <form id="takwim-form" class="space-y-4">
                <input type="hidden" id="takwim-event-id">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Tajuk <span class="text-red-500">*</span></label>
                    <input type="text" id="takwim-title" required placeholder="Contoh: Majlis Alumni Tahunan"
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Tarikh Mula <span class="text-red-500">*</span></label>
                    <input type="date" id="takwim-date" required
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Tarikh Akhir <span class="text-xs text-gray-400 font-normal">(kosongkan jika 1 hari)</span></label>
                    <input type="date" id="takwim-date-to"
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Lokasi</label>
                    <input type="text" id="takwim-location" placeholder="Contoh: Dewan Besar UPSI"
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Catatan / Status</label>
                    <input type="text" id="takwim-notes" list="takwim-notes-options" autocomplete="off"
                        placeholder="Pilih status atau taip sendiri"
                        class="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-brand-primary focus:border-brand-primary">
                    <datalist id="takwim-notes-options">
                        <option value="Telah Berlangsung"></option>
                        <option value="Ditangguhkan"></option>
                        <option value="Dibatalkan"></option>
                    </datalist>
                </div>
                <div class="flex gap-2 pt-2">
                    <button type="button" id="takwim-cancel-btn"
                        class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-semibold">Batal</button>
                    <button type="submit"
                        class="flex-1 bg-brand-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-800 transition-all">Simpan</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);

    const close = () => closeModal(modal);
    modal.querySelector('#takwim-modal-close').addEventListener('click', close);
    modal.querySelector('#takwim-cancel-btn').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelector('#takwim-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = modal.querySelector('#takwim-event-id').value;
        const title = modal.querySelector('#takwim-title').value.trim();
        const date = modal.querySelector('#takwim-date').value;
        const dateTo = modal.querySelector('#takwim-date-to').value || '';
        const location = modal.querySelector('#takwim-location').value.trim();
        const notes = modal.querySelector('#takwim-notes').value.trim();

        if (!title || !date) {
            showToastNotification('Sila isi Tajuk dan Tarikh Mula.', 'danger');
            return;
        }
        if (dateTo && dateTo < date) {
            showToastNotification('Tarikh Akhir mesti sama atau selepas Tarikh Mula.', 'danger');
            return;
        }
        close();
        if (id) {
            await updateTakwimEvent(currentYear, id, { title, date, dateTo, location, notes });
        } else {
            await addTakwimEvent(currentYear, { title, date, dateTo, location, notes });
        }
        // Real-time listener will refresh the list automatically.
    });

    return modal;
}

function openTakwimModal(eventObj) {
    const modal = ensureModal();
    modal.querySelector('#takwim-modal-title').textContent = eventObj ? 'Edit Aktiviti' : 'Tambah Aktiviti';
    modal.querySelector('#takwim-event-id').value = eventObj ? eventObj.id : '';
    modal.querySelector('#takwim-title').value = eventObj ? (eventObj.title || '') : '';
    modal.querySelector('#takwim-date').value = eventObj ? (eventObj.date || '') : '';
    modal.querySelector('#takwim-date-to').value = eventObj ? (eventObj.dateTo || '') : '';
    modal.querySelector('#takwim-location').value = eventObj ? (eventObj.location || '') : '';
    modal.querySelector('#takwim-notes').value = eventObj ? (eventObj.notes || '') : '';
    openModal(modal);
}

// ---- Detail popup (tap a card to see full info) -----------------------
// On small screens the title/location/notes get truncated; tapping a card
// opens this read-only popup with the complete details (and admin actions).

function ensureDetailModal() {
    let modal = document.getElementById('takwim-detail-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'takwim-detail-modal';
    modal.className = 'modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="takwim-detail-title">
            <div class="flex justify-between items-start mb-4">
                <h3 id="takwim-detail-title" class="text-lg font-bold text-brand-primary flex items-center gap-2">
                    <i class="ph-duotone ph-calendar-dots"></i><span>Butiran Aktiviti</span>
                </h3>
                <button type="button" id="takwim-detail-close" class="text-gray-500 hover:text-red-600 text-2xl font-bold leading-none" aria-label="Tutup">&times;</button>
            </div>
            <div id="takwim-detail-body" class="space-y-3"></div>
            <div id="takwim-detail-actions" class="flex gap-2 pt-5"></div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => closeModal(modal);
    modal.querySelector('#takwim-detail-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    return modal;
}

function openDetailModal(ev) {
    const modal = ensureDetailModal();
    const st = statusStyle(ev.notes);
    const tarikh = ev.dateTo && ev.dateTo !== ev.date
        ? `${formatDate(ev.date)} – ${formatDate(ev.dateTo)}`
        : formatDate(ev.date);
    const statusHtml = ev.notes
        ? (st
            ? `<span class="inline-flex items-center gap-1.5 text-sm font-bold ${st.pill} border rounded-full px-3 py-1"><i class="ph-duotone ${st.icon}"></i>${escapeHtml(ev.notes)}</span>`
            : `<p class="text-sm font-semibold text-gray-700 break-words">${escapeHtml(ev.notes)}</p>`)
        : `<p class="text-sm text-gray-400 italic">Tiada catatan</p>`;

    modal.querySelector('#takwim-detail-body').innerHTML = `
        <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Aktiviti</p>
            <p class="text-base font-bold text-gray-800 break-words">${escapeHtml(ev.title)}</p>
        </div>
        <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Tarikh</p>
            <p class="text-sm font-semibold text-gray-700">${escapeHtml(tarikh)}</p>
        </div>
        <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Lokasi</p>
            ${ev.location
                ? `<p class="text-sm font-semibold text-gray-700 break-words">${escapeHtml(ev.location)}</p>`
                : `<p class="text-sm text-gray-400 italic">Tiada lokasi</p>`}
        </div>
        <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Status / Catatan</p>
            ${statusHtml}
        </div>`;

    const actions = modal.querySelector('#takwim-detail-actions');
    if (isAdminMode) {
        actions.innerHTML = `
            <button type="button" id="takwim-detail-edit" class="detail-btn-edit flex-1 px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg font-semibold hover:bg-blue-100 transition-all flex items-center justify-center gap-2"><i class="fas fa-pencil-alt text-xs"></i> Edit</button>
            <button type="button" id="takwim-detail-delete" class="detail-btn-delete flex-1 px-4 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg font-semibold hover:bg-red-100 transition-all flex items-center justify-center gap-2"><i class="fas fa-trash-alt text-xs"></i> Padam</button>`;
        actions.querySelector('#takwim-detail-edit').addEventListener('click', () => {
            closeModal(modal);
            openTakwimModal(ev);
        });
        actions.querySelector('#takwim-detail-delete').addEventListener('click', () => {
            closeModal(modal);
            showConfirmModal(
                'Padam Aktiviti?',
                `Adakah anda pasti mahu memadam "${ev.title}"? Tindakan ini tidak boleh diundur.`,
                async () => { await deleteTakwimEvent(currentYear, ev.id); }
            );
        });
    } else {
        actions.innerHTML = `
            <button type="button" id="takwim-detail-ok" class="flex-1 bg-brand-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-800 transition-all">Tutup</button>`;
        actions.querySelector('#takwim-detail-ok').addEventListener('click', () => closeModal(modal));
    }

    openModal(modal);
}

// ---- Rendering --------------------------------------------------------

function eventCardHtml(ev) {
    const badge = dateBadgeParts(ev.date, ev.dateTo);
    const rangeHtml = badge.range
        ? `<p class="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
               <i class="ph-duotone ph-calendar-dots text-brand-primary"></i>
               <span>${escapeHtml(formatDate(ev.date))} ${escapeHtml(badge.range)}</span>
           </p>` : '';
    const locationHtml = ev.location
        ? `<p class="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
               <i class="ph-duotone ph-map-pin text-brand-primary"></i>
               <span>${escapeHtml(ev.location)}</span>
           </p>` : '';
    const st = statusStyle(ev.notes);
    const notesHtml = ev.notes
        ? (st
            ? `<span class="inline-flex items-center gap-1 text-xs font-bold ${st.pill} border rounded-full px-2 py-0.5 mt-1.5">
                   <i class="ph-duotone ${st.icon}"></i>${escapeHtml(ev.notes)}
               </span>`
            : `<p class="flex items-start gap-1.5 text-sm text-gray-500 mt-1">
                   <i class="ph-duotone ph-note text-brand-primary mt-0.5"></i>
                   <span>${escapeHtml(ev.notes)}</span>
               </p>`)
        : '';
    const adminHtml = isAdminMode
        ? `<div class="flex items-center gap-1 flex-shrink-0">
               <button class="takwim-edit-btn footer-action-btn bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200" data-id="${escapeHtml(ev.id)}" title="Edit">
                   <i class="fas fa-pencil-alt"></i>
               </button>
               <button class="takwim-delete-btn footer-action-btn bg-red-50 text-red-600 hover:bg-red-100 border-red-200" data-id="${escapeHtml(ev.id)}" title="Padam">
                   <i class="fas fa-trash-alt"></i>
               </button>
           </div>` : '';

    return `
    <div class="takwim-card bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex gap-3 items-start cursor-pointer hover:shadow-md hover:border-blue-100 transition-all" data-id="${escapeHtml(ev.id)}" role="button" tabindex="0" title="Lihat butiran">
        <div class="takwim-date-badge flex-shrink-0 flex flex-col items-center justify-center rounded-lg bg-blue-50 text-brand-primary w-14 py-2 px-1">
            <span class="text-base font-extrabold leading-none text-center">${escapeHtml(badge.day)}</span>
            <span class="text-[10px] font-bold tracking-wide leading-none mt-0.5">${escapeHtml(badge.mon)}</span>
            <span class="text-[10px] text-gray-400 leading-none mt-0.5">${escapeHtml(badge.year)}</span>
        </div>
        <div class="flex-1 min-w-0">
            <h4 class="font-bold text-gray-800 text-sm sm:text-base leading-snug break-words">${escapeHtml(ev.title)}</h4>
            ${rangeHtml}
            ${locationHtml}
            ${notesHtml}
        </div>
        ${adminHtml}
    </div>`;
}

function sectionHtml(titleText, iconClass, events) {
    if (!events.length) return '';
    const cards = events.map(eventCardHtml).join('');
    return `
    <div class="mb-6">
        <h3 class="flex items-center gap-2 text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
            <i class="ph-duotone ${iconClass} text-base text-brand-primary"></i>${escapeHtml(titleText)}
            <span class="text-xs font-semibold bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">${events.length}</span>
        </h3>
        <div class="space-y-3">${cards}</div>
    </div>`;
}

function render() {
    if (!currentContainer) return;

    const tKey = todayKey();
    const sorted = [...cachedEvents].sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // An event counts as "past" only once its LAST day is over, so multi-day
    // programmes still in progress stay under "Akan Datang".
    const endKey = (ev) => (ev.dateTo && String(ev.dateTo) >= String(ev.date))
        ? String(ev.dateTo) : String(ev.date);

    // Cancelled / postponed go to their own sections regardless of date
    const cancelled  = sorted.filter(ev => ev.notes === 'Dibatalkan');
    const postponed  = sorted.filter(ev => ev.notes === 'Ditangguhkan');
    const active     = sorted.filter(ev => ev.notes !== 'Dibatalkan' && ev.notes !== 'Ditangguhkan');
    const upcoming   = active.filter(ev => endKey(ev) >= tKey);
    const past       = active.filter(ev => endKey(ev) < tKey).reverse(); // most recent first

    const addBtnHtml = isAdminMode
        ? `<button id="takwim-add-btn" class="bg-brand-primary text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-800 shadow-md transition-all text-sm flex items-center gap-2 flex-shrink-0">
               <i class="fas fa-plus-circle"></i><span>Tambah Aktiviti</span>
           </button>` : '';

    let bodyHtml;
    if (!cachedEvents.length) {
        bodyHtml = `
        <div class="flex flex-col items-center justify-center text-center p-10 bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-200">
            <div class="bg-blue-50 p-4 rounded-full mb-4">
                <i class="ph-duotone ph-calendar-dots text-brand-primary text-4xl"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-700 mb-1">Tiada Aktiviti</h3>
            <p class="text-gray-500 text-sm">${isAdminMode ? 'Tekan "Tambah Aktiviti" untuk mula merekod takwim tahun ini.' : 'Belum ada aktiviti direkodkan untuk tahun ini.'}</p>
        </div>`;
    } else {
        bodyHtml =
            sectionHtml('Akan Datang', 'ph-clock-countdown', upcoming) +
            sectionHtml('Telah Berlangsung', 'ph-clock-counter-clockwise', past) +
            sectionHtml('Ditangguhkan', 'ph-pause-circle', postponed) +
            sectionHtml('Dibatalkan', 'ph-x-circle', cancelled);
    }

    currentContainer.innerHTML = `
    <div class="takwim-wrapper">
        <div class="flex items-center justify-between gap-3 mb-5">
            <h2 class="text-lg sm:text-xl font-bold text-brand-primary flex items-center gap-2 min-w-0">
                <i class="ph-duotone ph-calendar-dots flex-shrink-0"></i>
                <span class="truncate">Takwim Aktiviti ${escapeHtml(currentYear)}</span>
            </h2>
            ${addBtnHtml}
        </div>
        ${bodyHtml}
    </div>`;

    // Wire up listeners
    const addBtn = currentContainer.querySelector('#takwim-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => openTakwimModal(null));

    // Tap any card -> detail popup (full info, untruncated). Available to
    // everyone; clicks on the inline admin buttons are ignored here.
    currentContainer.querySelectorAll('.takwim-card').forEach(card => {
        const open = (e) => {
            if (e.target.closest('.takwim-edit-btn, .takwim-delete-btn')) return;
            const ev = cachedEvents.find(x => x.id === card.dataset.id);
            if (ev) openDetailModal(ev);
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); }
        });
    });

    if (isAdminMode) {
        currentContainer.querySelectorAll('.takwim-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const ev = cachedEvents.find(e => e.id === btn.dataset.id);
                if (ev) openTakwimModal(ev);
            });
        });
        currentContainer.querySelectorAll('.takwim-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const ev = cachedEvents.find(e => e.id === btn.dataset.id);
                if (!ev) return;
                showConfirmModal(
                    'Padam Aktiviti?',
                    `Adakah anda pasti mahu memadam "${ev.title}"? Tindakan ini tidak boleh diundur.`,
                    async () => { await deleteTakwimEvent(currentYear, ev.id); }
                );
            });
        });
    }
}

// ---- Public API -------------------------------------------------------

export function initTakwim(containerEl, isAdmin, year) {
    if (!containerEl) return;
    currentContainer = containerEl;
    isAdminMode = !!isAdmin;
    const yearStr = String(year);

    // Always show a loading placeholder while (re)subscribing.
    containerEl.innerHTML = `
        <div class="flex items-center justify-center p-10 text-gray-400">
            <i class="fas fa-spinner fa-spin mr-2"></i> Memuatkan takwim...
        </div>`;

    // If the year changed (or first run), reset the listener.
    if (year && yearStr !== currentYear) {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        currentYear = yearStr;
        cachedEvents = [];
    } else {
        currentYear = yearStr;
    }

    if (!unsubscribe) {
        unsubscribe = subscribeTakwim(currentYear, (events) => {
            cachedEvents = events || [];
            render();
        });
    } else {
        // Re-render with cached data (e.g. admin mode toggled without year change).
        render();
    }
}
