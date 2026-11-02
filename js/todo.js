// --- JS/TODO.JS ---
// Admin "Perlu tindakan" panel (redesign canvas, Admin-Main): a short list
// of things the admin probably still has to record. READ ONLY: it reads the
// selected year's q4 document and the takwim, and its buttons only open the
// existing screens (Butiran, Penjanaan, Takwim) where the admin does the work.
//
// Checks:
//   1. Kembara programmes that have ended but have no attendance (hadir).
//   2. Current year only, from day 15 of a quarter: no Penjanaan record whose
//      bulan falls in the current quarter.
//   3. Current year only: no upcoming Takwim activity (next year's takwim
//      counts too, so December does not raise a false alarm).

import { getQuarterOnce, getTakwimEvents, kpiDataCache } from './api.js';
import { escapeHtml, showDetailsModal } from './ui.js';

const BULAN_FULL = ['', 'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const KEMBARA_ID = 'kembara';
const PENJANAAN_ID = 'pendanaan';
const QUARTER_GRACE_DAYS = 15;

let refreshToken = 0;

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToDmy = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const quarterOfMonth = (m) => Math.floor((m - 1) / 3) + 1;

// Same reading as takwim.js: a `status` key wins; legacy events keep the
// status word in `notes`
function isCancelled(ev) {
    if (Object.prototype.hasOwnProperty.call(ev, 'status')) return ev.status === 'Dibatalkan';
    return /^\s*dibatalkan\b/i.test(ev.notes || '');
}

// Waits for an element rendered asynchronously (another tab, a quarter that
// is still loading); `ready` adds a condition the element alone can't show
function whenEl(selector, timeout = 5000, ready = () => true) {
    return new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
            const el = document.querySelector(selector);
            if (el && ready()) return resolve(el);
            if (Date.now() - start > timeout) return resolve(null);
            setTimeout(tick, 120);
        };
        tick();
    });
}

function kehadiranTodo(q4, today) {
    const kpi = (q4.kpis || []).find(k => k.id === KEMBARA_ID);
    const items = (kpi && kpi.details && Array.isArray(kpi.details.items)) ? kpi.details.items : [];
    const missing = items.filter(it => {
        const end = it.tarikhTamat || it.tarikh;
        return end && end < today && (it.hadir == null || it.hadir === '');
    }).sort((a, b) => String(a.tarikh).localeCompare(String(b.tarikh)));
    if (!missing.length) return null;
    const first = missing[0];
    const detail = missing.length === 1
        ? `${first.name}, ${isoToDmy(first.tarikh)}`
        : `${missing.length} program, antaranya ${first.name} (${isoToDmy(first.tarikh)}).`;
    const m = parseInt(String(first.tarikh).slice(5, 7), 10);
    return {
        key: 'kehadiran', icon: 'ph-users-three',
        title: 'Kehadiran belum direkod', detail, action: 'Isi kehadiran',
        run: () => openKembaraDetails(m ? quarterOfMonth(m) : 4)
    };
}

function penjanaanTodo(q4, now) {
    const q = quarterOfMonth(now.getMonth() + 1);
    const qStart = new Date(now.getFullYear(), (q - 1) * 3, 1);
    if ((now - qStart) / 86400000 < QUARTER_GRACE_DAYS - 1) return null;
    const kpi = (q4.kpis || []).find(k => k.id === PENJANAAN_ID);
    const items = (kpi && kpi.details && Array.isArray(kpi.details.items)) ? kpi.details.items : [];
    const months = items.map(it => parseInt(it.bulan, 10)).filter(b => b >= 1 && b <= 12);
    if (months.some(b => quarterOfMonth(b) === q)) return null;
    const last = months.length ? Math.max(...months) : 0;
    return {
        key: 'penjanaan', icon: 'ph-currency-circle-dollar',
        title: `Tiada rekod penjanaan Suku ${q}`,
        detail: last ? `Rekod terakhir pada ${BULAN_FULL[last]} ${now.getFullYear()}.` : `Belum ada rekod bagi tahun ${now.getFullYear()}.`,
        action: 'Tambah rekod',
        run: () => openAddForm('penjanaan', '#penjanaan-add-btn')
    };
}

async function takwimTodo(year, today) {
    const events = await getTakwimEvents(year);
    if (events === null) return null;   // unreadable: say nothing
    const live = events.filter(ev => ev && ev.date && !isCancelled(ev));
    if (live.some(ev => ev.date > today)) return null;
    const next = await getTakwimEvents(String(Number(year) + 1));
    if (next === null || next.some(ev => ev && ev.date && !isCancelled(ev))) return null;
    const last = live.map(ev => ev.dateTo || ev.date).sort().pop();
    return {
        key: 'takwim', icon: 'ph-calendar-plus',
        title: 'Tiada aktiviti akan datang',
        detail: last ? `Aktiviti terakhir dalam takwim bertarikh ${isoToDmy(last)}.` : `Takwim ${year} masih kosong.`,
        action: 'Tambah aktiviti',
        run: () => openAddForm('takwim', '#takwim-add-btn')
    };
}

// Butiran Kembara for a quarter that holds the programme (lists are
// cumulative, so the current tab already does when it is that late or later)
async function openKembaraDetails(quarterNum) {
    const pagination = document.getElementById('pagination');
    const active = pagination && pagination.querySelector('.active');
    const activeNum = active ? parseInt(active.dataset.quarter, 10) : 0;
    if (pagination && activeNum < quarterNum) {
        const tab = pagination.querySelector(`[data-quarter="${quarterNum}"]`);
        if (tab) tab.click();
    }
    // The details modal reads the quarter on the tab bar from kpiDataCache,
    // which is filled once that quarter's data arrives
    const card = await whenEl(`#kpi-grid-container .kpi-card[data-kpi-id="${KEMBARA_ID}"] .show-details-btn`, 5000, () => {
        const a = pagination && pagination.querySelector('.active');
        const c = a && kpiDataCache[`q${a.dataset.quarter}`];
        return !!(c && c.processedKpis && c.processedKpis.some(k => k.id === KEMBARA_ID));
    });
    if (card) showDetailsModal(KEMBARA_ID, card);
}

async function openAddForm(view, selector) {
    if (typeof window.switchView === 'function') window.switchView(view);
    const btn = await whenEl(`#view-${view} ${selector}`);
    if (btn) btn.click();
}

export function hideAdminTodo() {
    refreshToken++;
    const panel = document.getElementById('admin-todo');
    if (panel) panel.classList.add('hidden');
}

// year: the selected year (string). Hidden for guests and when nothing is due.
export async function refreshAdminTodo(year, isAdmin) {
    const panel = document.getElementById('admin-todo');
    if (!panel) return;
    if (!isAdmin) { hideAdminTodo(); return; }
    const token = ++refreshToken;

    const now = new Date();
    const today = dateKey(now);
    const isCurrentYear = String(year) === String(now.getFullYear());

    const q4 = await getQuarterOnce('q4');
    const todos = [];
    if (q4) {
        const k = kehadiranTodo(q4, today);
        if (k) todos.push(k);
        if (isCurrentYear) {
            const p = penjanaanTodo(q4, now);
            if (p) todos.push(p);
        }
    }
    if (isCurrentYear) {
        const t = await takwimTodo(year, today);
        if (t) todos.push(t);
    }
    if (token !== refreshToken) return;   // a newer refresh (or a hide) won

    if (!todos.length) { panel.classList.add('hidden'); return; }
    document.getElementById('admin-todo-count').textContent = String(todos.length);
    const list = document.getElementById('admin-todo-list');
    list.innerHTML = todos.map((t, i) => `
        <div class="admin-todo-row" data-todo="${t.key}">
            <div class="admin-todo-icon" aria-hidden="true"><i class="ph-duotone ${t.icon}"></i></div>
            <div class="admin-todo-main">
                <p class="admin-todo-title">${escapeHtml(t.title)}</p>
                <p class="admin-todo-detail">${escapeHtml(t.detail)}</p>
                <button type="button" class="admin-todo-action" data-todo-index="${i}">${escapeHtml(t.action)}
                    <i class="ph ph-arrow-right" aria-hidden="true"></i></button>
            </div>
        </div>`).join('');
    list.querySelectorAll('.admin-todo-action').forEach(btn => {
        btn.addEventListener('click', () => todos[parseInt(btn.dataset.todoIndex, 10)].run());
    });
    panel.classList.remove('hidden');
}
