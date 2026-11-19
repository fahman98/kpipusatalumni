// --- JS/ASET-VIEW.JS ---
// Tab "Aset": the asset check for the aset accounts (auth.js ASET_EMAILS,
// alumni@, fahman@ and farhiah@). Hidden from the public; firestore.rules
// keeps the data private (isAset).
//   Bilik        progress of the active cycle per room, global search
//   (a room)     assets not yet checked on top, checked ones greyed below
//   Mod QR       full-screen QR of the asset code for the UPSI app on the
//                phone; opening it marks the asset checked (Batal undoes)
//   Ringkasan    counts per status, not checked, problems, CSV export
//   Pentadbiran  import CSV with a diff preview, cycles, room names
//   Cetak        A4 list per room with QR codes (backup with phone only)
// Live data via onSnapshot, so a tick by the other verifier shows at once.
// Firestore access only through aset-api.js.

import {
    ASET_STATUS, STATUS_BAIK, STATUS_LAIN, STATUS_BELUM, isBermasalah, nameOf, assetDocId,
    ownerLabel, byKod, byRoom, formatDateTime, toDate, suggestKitaranName, toCsv,
    readAssetCsv, buildImportPlan, FIELD_LABELS
} from './aset.js';
import {
    subscribeAset, subscribeBilik, subscribeKitaran, subscribeTetapan, subscribeSemakan,
    markScanned, undoScan, updateSemakan, saveBilikName, checkAsetRules, asetAdminGuard,
    importAset, openKitaran, closeKitaran
} from './aset-api.js';
import { escapeHtml, showConfirmModal, showToastNotification, showLoading, hideLoading } from './ui.js';

const esc = escapeHtml;
const SCREENS = [
    { id: 'bilik', label: 'Bilik', icon: 'ph-door-open' },
    { id: 'ringkasan', label: 'Ringkasan', icon: 'ph-chart-pie-slice' },
    { id: 'pentadbiran', label: 'Pentadbiran', icon: 'ph-gear-six' },
    { id: 'cetak', label: 'Cetak', icon: 'ph-printer' }
];

const S = {
    container: null, email: '', started: false,
    master: new Map(),      // assetDocId -> asset (incl. aktif: false)
    bilik: new Map(),       // kod_bilik -> room
    kitaran: [],            // every cycle
    tetapan: null,          // { kitaran_aktif }
    semakan: new Map(),     // assetDocId -> check record of S.semakanFor
    semakanFor: undefined, unsubSemakan: null,
    loaded: { aset: false, bilik: false, kitaran: false, tetapan: false, semakan: false },
    error: null,
    screen: 'bilik', roomId: null, roomFilter: 'semua', search: '',
    summaryId: null, printRoom: 'semua',
    importParsed: null, importPlan: null, importErrors: null, importFile: '',
    rules: null, renderQueued: false, renderWaiting: false, pointerDown: false
};

// ---- Entry points (main.js) -------------------------------------------------
export function syncAsetNav(on) {
    document.querySelectorAll('.aset-nav').forEach(el => el.classList.toggle('hidden', !on));
}

export function initAset(container, email) {
    if (!container) return;
    S.container = container;
    S.email = String(email || '').toLowerCase();
    if (!container.dataset.asetBound) {
        container.dataset.asetBound = '1';
        container.addEventListener('click', onClick);
        container.addEventListener('input', onInput);
        container.addEventListener('change', onChange);
        // A render held back while typing runs once the field is left, but
        // never between the press and the click of a button (the DOM under
        // the pointer would be replaced and the click lost)
        container.addEventListener('pointerdown', () => { S.pointerDown = true; });
        document.addEventListener('pointerup', () => setTimeout(() => {
            S.pointerDown = false;
            if (S.renderWaiting && !typingInside()) render();
        }, 0));
        container.addEventListener('focusout', () => setTimeout(() => {
            if (!S.pointerDown && S.renderWaiting && !typingInside()) render();
        }, 0));
    }
    if (!S.started) start();
    loadQrLib().catch(() => {});
    if (S.screen === 'pentadbiran') refreshRules();
    render();
}

function start() {
    S.started = true;
    const fail = (err) => { S.error = err || true; scheduleRender(); };
    subscribeAset(list => {
        S.master = new Map(list.map(a => [a._id, a]));
        S.loaded.aset = true; S.error = null; scheduleRender();
    }, fail);
    subscribeBilik(list => {
        S.bilik = new Map(list.map(b => [b._id, Object.assign({ kod_bilik: b._id }, b)]));
        S.loaded.bilik = true; scheduleRender();
    }, fail);
    subscribeKitaran(list => {
        S.kitaran = list;
        S.loaded.kitaran = true; syncSemakanSub(); scheduleRender();
    }, fail);
    subscribeTetapan(data => {
        S.tetapan = data || {};
        S.loaded.tetapan = true; syncSemakanSub(); scheduleRender();
    }, fail);
}

// ---- Derived data ----------------------------------------------------------
const activeId = () => (S.tetapan && S.tetapan.kitaran_aktif) || null;
function activeKitaran() {
    const id = activeId();
    const k = id && S.kitaran.find(x => x._id === id);
    return k && k.status === 'aktif' ? k : null;
}
// Ringkasan may look at an older cycle; everything else uses the active one
function viewKitaranId() {
    if (S.screen === 'ringkasan' && S.summaryId) return S.summaryId;
    const k = activeKitaran();
    return k ? k._id : null;
}

function syncSemakanSub() {
    const id = viewKitaranId();
    if (id === S.semakanFor) return;
    if (S.unsubSemakan) { S.unsubSemakan(); S.unsubSemakan = null; }
    S.semakanFor = id;
    S.semakan = new Map();
    S.loaded.semakan = !id;
    if (!id) return;
    S.unsubSemakan = subscribeSemakan(id, list => {
        if (S.semakanFor !== id) return;
        S.semakan = new Map(list.map(s => [s._id, s]));
        S.loaded.semakan = true;
        scheduleRender();
        if (Q.open) refreshQr();
    }, (err) => { S.error = err || true; scheduleRender(); });
}

const activeAssets = () => [...S.master.values()].filter(a => a.aktif !== false);
const isScanned = (id) => { const s = S.semakan.get(id); return !!(s && s.discan); };

function roomList() {
    const rooms = new Map();
    activeAssets().forEach(a => {
        if (!rooms.has(a.bilik)) {
            const b = S.bilik.get(a.bilik) || {};
            rooms.set(a.bilik, { kod_bilik: a.bilik, nama: b.nama || '', urutan: b.urutan, assets: [] });
        }
        rooms.get(a.bilik).assets.push(a);
    });
    return [...rooms.values()].map(r => {
        r.assets.sort(byKod);
        r.done = r.assets.filter(a => isScanned(a._id)).length;
        return r;
    }).sort(byRoom);
}

function roomAssets(kod) {
    return activeAssets().filter(a => a.bilik === kod).sort(byKod);
}

function roomName(kod) {
    const b = S.bilik.get(kod);
    return (b && b.nama) || '';
}

const ready = () => S.loaded.aset && S.loaded.bilik && S.loaded.kitaran && S.loaded.tetapan
    && (S.loaded.semakan || !viewKitaranId());

// ---- Rendering -------------------------------------------------------------
function scheduleRender() {
    if (S.renderQueued) return;
    S.renderQueued = true;
    requestAnimationFrame(() => { S.renderQueued = false; render(); });
}

function typingInside() {
    const el = document.activeElement;
    return !!(el && S.container && S.container.contains(el)
        && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'file' && el.type !== 'button')));
}

function render() {
    if (!S.container || S.container.classList.contains('hidden')) return;
    // Live updates must not wipe what someone is typing
    if (typingInside()) {
        S.renderWaiting = true;
        if (S.screen === 'bilik' && !S.roomId) renderDyn();
        return;
    }
    S.renderWaiting = false;
    syncSemakanSub();
    S.container.innerHTML = `
        <div class="asv">
            <div class="asv-top">
                <div>
                    <p class="asv-eyebrow">Sulit · pengguna aset sahaja</p>
                    <h2 class="asv-title">Semakan Aset</h2>
                    <p class="asv-lead">${kitaranLine()}</p>
                </div>
            </div>
            <div class="asv-tabs" role="tablist" aria-label="Bahagian semakan aset">
                ${SCREENS.map(s => `<button type="button" role="tab" data-screen="${s.id}"
                    aria-selected="${S.screen === s.id}"><i class="ph-duotone ${s.icon}" aria-hidden="true"></i><span>${s.label}</span></button>`).join('')}
            </div>
            <div class="asv-body">${bodyHtml()}</div>
        </div>`;
}

function kitaranLine() {
    if (!S.loaded.kitaran || !S.loaded.tetapan) return 'Memuatkan...';
    const k = activeKitaran();
    if (!k) return 'Tiada kitaran semakan aktif.';
    return `Kitaran aktif: <strong>${esc(k.nama)}</strong>, dibuka ${esc(formatDateTime(k.dibuka_pada).slice(0, 10))}`;
}

function bodyHtml() {
    if (S.error) {
        const denied = S.error && S.error.code === 'permission-denied';
        return note(denied
            ? 'Akaun ini tiada akses ke data aset.'
            : 'Data aset tidak dapat dibaca. Semak sambungan internet, kemudian muat semula halaman.', 'bad');
    }
    if (!ready()) return `<div class="asv-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Memuatkan data aset...</div>`;
    if (S.screen === 'ringkasan') return summaryHtml();
    if (S.screen === 'pentadbiran') return adminHtml();
    if (S.screen === 'cetak') return printHtml();
    if (!activeAssets().length) {
        return `<div class="asv-empty">
            <i class="ph-duotone ph-package" aria-hidden="true"></i>
            <p><strong>Belum ada data aset.</strong> Import fail CSV laporan KEW.PA-7 di Pentadbiran.</p>
            <button type="button" class="asv-btn is-primary" data-screen="pentadbiran">Ke Pentadbiran</button></div>`;
    }
    if (S.roomId) return roomHtml(S.roomId);
    return roomsHtml();
}

const note = (text, tone = 'info') =>
    `<p class="asv-note" data-tone="${tone}" role="${tone === 'bad' ? 'alert' : 'status'}">${text}</p>`;

function progressHtml(done, total, label) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="asv-progress">
        <p class="asv-progress-num"><strong>${done} / ${total}</strong> ${label}<span>${pct}%</span></p>
        <div class="asv-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"
            aria-label="${done} daripada ${total} ${label}"><span style="width:${pct}%"></span></div></div>`;
}

// -- Bilik (room list + global search)
function roomsHtml() {
    const k = activeKitaran();
    const all = activeAssets();
    const done = all.filter(a => isScanned(a._id)).length;
    const head = k
        ? `<div class="asv-card">${progressHtml(done, all.length, 'diimbas')}</div>`
        : `<div class="asv-card asv-nokit"><p><strong>Tiada kitaran semakan aktif.</strong> Buka kitaran di Pentadbiran untuk mula menanda aset. QR masih boleh dipaparkan untuk rujukan.</p>
            <button type="button" class="asv-btn is-primary" data-screen="pentadbiran">Buka kitaran</button></div>`;
    return `${head}
        <div class="asv-search">
            <i class="fas fa-search" aria-hidden="true"></i>
            <input id="asv-search" type="search" autocomplete="off" value="${esc(S.search)}"
                placeholder="Cari kod, keterangan atau owner" aria-label="Cari aset di semua bilik mengikut kod aset, keterangan atau owner">
        </div>
        <div class="asv-dyn">${dynHtml()}</div>`;
}

function renderDyn() {
    const el = S.container && S.container.querySelector('.asv-dyn');
    if (el) el.innerHTML = dynHtml();
}

function dynHtml() {
    const q = S.search.trim().toLowerCase();
    if (q.length >= 2) {
        const hits = activeAssets().filter(a => [a.kod_aset, a.keterangan, a.owner, a.id_owner]
            .some(v => String(v || '').toLowerCase().includes(q))).sort(byKod);
        if (!hits.length) return `<p class="asv-muted">Tiada aset sepadan dengan "${esc(S.search.trim())}".</p>`;
        const shown = hits.slice(0, 50);
        return `<p class="asv-muted">${hits.length} aset dijumpai${hits.length > 50 ? ', 50 pertama dipaparkan' : ''}.</p>
            <ul class="asv-assets">${shown.map(a => assetRow(a, true)).join('')}</ul>`;
    }
    const rooms = roomList();
    const shown = S.roomFilter === 'belum' ? rooms.filter(r => r.done < r.assets.length) : rooms;
    const k = activeKitaran();
    return `<div class="asv-filters" role="group" aria-label="Tapis bilik">
            <button type="button" data-filter="semua" aria-pressed="${S.roomFilter === 'semua'}">Semua (${rooms.length})</button>
            <button type="button" data-filter="belum" aria-pressed="${S.roomFilter === 'belum'}">Belum siap (${rooms.filter(r => r.done < r.assets.length).length})</button>
        </div>
        ${shown.length ? `<ul class="asv-rooms">${shown.map(r => {
            const complete = k && r.done === r.assets.length;
            const pct = r.assets.length ? Math.round(r.done / r.assets.length * 100) : 0;
            return `<li><button type="button" class="asv-room${complete ? ' is-done' : ''}" data-room="${esc(r.kod_bilik)}">
                <span class="asv-room-main">
                    <span class="asv-room-kod">${esc(r.kod_bilik)}</span>
                    <span class="asv-room-nama">${r.nama ? esc(r.nama) : '<em>Tiada nama</em>'}</span>
                    <span class="asv-bar is-small" aria-hidden="true"><span style="width:${k ? pct : 0}%"></span></span>
                </span>
                <span class="asv-room-count">${complete
                    ? '<span class="asv-done-chip"><i class="fas fa-check" aria-hidden="true"></i> Selesai</span>' : ''}
                    <strong>${k ? r.done : 0} / ${r.assets.length}</strong></span>
                <i class="fas fa-chevron-right asv-chev" aria-hidden="true"></i>
            </button></li>`;
        }).join('')}</ul>` : `<p class="asv-muted">Semua bilik sudah siap diimbas.</p>`}`;
}

function assetRow(a, withRoom = false) {
    const s = S.semakan.get(a._id);
    const done = !!(s && s.discan);
    const issue = done && isBermasalah(s.status);
    const icon = !done ? '<i class="ph-duotone ph-qr-code" aria-hidden="true"></i>'
        : issue ? '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>'
        : '<i class="fas fa-check" aria-hidden="true"></i>';
    const statusLine = done ? `<span class="asv-asset-status">${esc(s.status)} · ${esc(formatDateTime(s.discan_pada))} · ${esc(nameOf(s.discan_oleh))}${s._pending ? ' · <span class="asv-pending">belum disegerakkan</span>' : ''}</span>
        ${s.catatan ? `<span class="asv-asset-note">Catatan: ${esc(s.catatan)}</span>` : ''}` : '';
    return `<li><button type="button" class="asv-asset" data-open="${esc(a._id)}"
            data-state="${!done ? 'belum' : issue ? 'issue' : 'done'}">
        <span class="asv-asset-icon">${icon}</span>
        <span class="asv-asset-main">
            <span class="asv-asset-name">${esc(a.keterangan || '(tiada keterangan)')}</span>
            <span class="asv-asset-code">${esc(a.kod_aset)}</span>
            <span class="asv-asset-meta">${esc(ownerLabel(a))}${withRoom ? ` · ${esc(a.bilik)}` : ''}</span>
            ${statusLine}
        </span>
        <i class="fas fa-chevron-right asv-chev" aria-hidden="true"></i>
    </button></li>`;
}

// -- One room
function roomHtml(kod) {
    const list = roomAssets(kod);
    const k = activeKitaran();
    const belum = list.filter(a => !isScanned(a._id));
    const sudah = list.filter(a => isScanned(a._id));
    const nama = roomName(kod);
    return `<button type="button" class="asv-back" data-act="rooms"><i class="fas fa-arrow-left" aria-hidden="true"></i> Semua bilik</button>
        <div class="asv-card">
            <h3 class="asv-room-title">${esc(kod)}</h3>
            <p class="asv-room-sub">${nama ? esc(nama) : '<em>Tiada nama</em>'}</p>
            ${k ? progressHtml(sudah.length, list.length, 'diimbas') : '<p class="asv-muted">Tiada kitaran aktif: QR untuk rujukan sahaja.</p>'}
            ${k && list.length && !belum.length ? note('<i class="fas fa-check-circle" aria-hidden="true"></i> Bilik ini sudah selesai.', 'good') : ''}
        </div>
        ${list.length ? '' : '<p class="asv-muted">Tiada aset aktif dalam bilik ini.</p>'}
        ${belum.length ? `<h4 class="asv-h">Belum diimbas (${belum.length})</h4>
            <ul class="asv-assets">${belum.map(a => assetRow(a)).join('')}</ul>` : ''}
        ${sudah.length ? `<h4 class="asv-h">Sudah diimbas (${sudah.length})</h4>
            <ul class="asv-assets is-done">${sudah.map(a => assetRow(a)).join('')}</ul>` : ''}
        <button type="button" class="asv-btn" data-act="print-room" data-room="${esc(kod)}"><i class="ph-duotone ph-printer" aria-hidden="true"></i> Cetak senarai bilik ini</button>`;
}

// -- Ringkasan
function sortedKitaran() {
    return [...S.kitaran].sort((a, b) => (toDate(b.dibuka_pada) || 0) - (toDate(a.dibuka_pada) || 0));
}

function summaryRows() {
    // Active assets, plus inactive ones that were checked in this cycle
    const ids = new Set(activeAssets().map(a => a._id));
    S.semakan.forEach((s, id) => { if (s.discan) ids.add(id); });
    return [...ids].map(id => {
        const a = S.master.get(id) || { kod_aset: (S.semakan.get(id) || {}).kod_aset || decodeURIComponent(id), bilik: (S.semakan.get(id) || {}).bilik || '' };
        return { a, s: S.semakan.get(id) };
    }).sort((x, y) => String(x.a.bilik).localeCompare(String(y.a.bilik), 'en', { numeric: true }) || byKod(x.a, y.a));
}

function summaryHtml() {
    const list = sortedKitaran();
    if (!list.length) return note('Belum ada kitaran semakan. Buka kitaran pertama di Pentadbiran.');
    const id = viewKitaranId() || list[0]._id;
    const k = list.find(x => x._id === id);
    const rows = summaryRows();
    const counts = Object.fromEntries(ASET_STATUS.map(x => [x.status, 0]));
    let belum = 0;
    rows.forEach(({ s }) => { if (s && s.discan) counts[s.status] = (counts[s.status] || 0) + 1; else belum++; });
    const scanned = rows.length - belum;
    const notDone = rows.filter(r => !(r.s && r.s.discan));
    const byRoomMap = new Map();
    notDone.forEach(({ a }) => { if (!byRoomMap.has(a.bilik)) byRoomMap.set(a.bilik, []); byRoomMap.get(a.bilik).push(a); });
    const problems = rows.filter(r => r.s && r.s.discan && isBermasalah(r.s.status));
    return `<div class="asv-row-between">
            <label class="asv-field">Kitaran
                <select id="asv-summary-kitaran">${list.map(x => `<option value="${esc(x._id)}"${x._id === id ? ' selected' : ''}>${esc(x.nama)}${x.status === 'aktif' ? ' (aktif)' : ''}</option>`).join('')}</select>
            </label>
            <button type="button" class="asv-btn is-primary" data-act="export"><i class="fas fa-file-csv" aria-hidden="true"></i> Eksport CSV</button>
        </div>
        <div class="asv-card">
            ${progressHtml(scanned, rows.length, 'diimbas')}
            <p class="asv-muted">${k && k.status === 'ditutup' ? `Kitaran ini ditutup pada ${esc(formatDateTime(k.ditutup_pada))}.` : 'Kitaran sedang berjalan.'}</p>
        </div>
        <h4 class="asv-h">Kiraan mengikut status</h4>
        <table class="asv-table">
            <thead><tr><th scope="col">Status</th><th scope="col" class="num">Bilangan</th></tr></thead>
            <tbody>
                ${ASET_STATUS.map(x => `<tr${x.bermasalah && counts[x.status] ? ' class="is-issue"' : ''}><td>${esc(x.status)}</td><td class="num">${counts[x.status] || 0}</td></tr>`).join('')}
                <tr class="is-belum"><td>${STATUS_BELUM}</td><td class="num">${belum}</td></tr>
            </tbody>
        </table>
        <h4 class="asv-h">Belum diimbas (${notDone.length})</h4>
        ${notDone.length ? [...byRoomMap.entries()].map(([kod, items]) => `<details class="asv-details">
            <summary><strong>${esc(kod)}</strong> ${esc(roomName(kod))} <span class="asv-count">${items.length}</span></summary>
            <ul>${items.map(a => `<li><span>${esc(a.keterangan || '')}</span> <code>${esc(a.kod_aset)}</code></li>`).join('')}</ul>
        </details>`).join('') : '<p class="asv-muted">Semua aset sudah diimbas.</p>'}
        <h4 class="asv-h">Aset bermasalah (${problems.length})</h4>
        ${problems.length ? `<ul class="asv-problems">${problems.map(({ a, s }) => `<li>
            <p class="asv-problem-status"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i> ${esc(s.status)}</p>
            <p><strong>${esc(a.keterangan || '')}</strong> <code>${esc(a.kod_aset)}</code></p>
            <p class="asv-muted">${esc(a.bilik)} · ${esc(ownerLabel(a))}</p>
            ${s.catatan ? `<p>Catatan: ${esc(s.catatan)}</p>` : ''}
        </li>`).join('')}</ul>` : '<p class="asv-muted">Tiada aset bermasalah.</p>'}`;
}

function exportCsv() {
    const id = viewKitaranId();
    const k = S.kitaran.find(x => x._id === id);
    if (!k) return;
    const rows = summaryRows().map(({ a, s }) => [
        a.kod_aset, a.keterangan || '', a.owner || '', a.bilik || '',
        s && s.discan ? s.status : STATUS_BELUM, (s && s.catatan) || '',
        s && s.discan ? formatDateTime(s.discan_pada) : '', s && s.discan ? (s.discan_oleh || '') : ''
    ]);
    const csv = toCsv(['kod_aset', 'keterangan', 'owner', 'bilik', 'status', 'catatan', 'discan_pada', 'discan_oleh'], rows);
    const slug = String(k.nama).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kitaran';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `semakan-aset-${slug}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToastNotification(`${rows.length} aset dieksport ke CSV.`, 'success');
}

// -- Pentadbiran
async function refreshRules() {
    const r = await checkAsetRules();
    if (r !== S.rules) { S.rules = r; scheduleRender(); }
}

function rulesHtml() {
    if (S.rules === 'locked') return note('<i class="fas fa-lock" aria-hidden="true"></i> Peraturan keselamatan aset aktif. Data aset tidak boleh dibaca oleh orang awam.', 'good');
    if (S.rules === 'open') return note(`<strong>Peraturan keselamatan aset belum diterbitkan.</strong> Import dan kitaran dikunci sehingga
        <code>firestore.rules</code> terkini diterbitkan dalam Firebase Console, supaya data aset tidak terdedah kepada umum.`, 'bad');
    if (S.rules === 'unknown') return note('Status peraturan keselamatan tidak dapat disemak (mungkin luar talian). Import dan kitaran perlukan sambungan internet.', 'warn');
    return note('Menyemak peraturan keselamatan...');
}

function adminHtml() {
    const k = activeKitaran();
    const past = sortedKitaran().filter(x => !k || x._id !== k._id);
    const rooms = new Map();
    S.bilik.forEach((b, kod) => rooms.set(kod, b));
    activeAssets().forEach(a => { if (!rooms.has(a.bilik)) rooms.set(a.bilik, { kod_bilik: a.bilik, nama: '' }); });
    const roomRows = [...rooms.values()].sort(byRoom);
    const locked = S.rules === 'locked';
    // Suggest "Semakan 1/2027" style names only while unused
    const suggested = suggestKitaranName();
    const kitName = S.kitaran.some(x => String(x.nama).trim().toLowerCase() === suggested.toLowerCase()) ? '' : suggested;
    return `${rulesHtml()}
        <section class="asv-card asv-section" aria-labelledby="asv-kit-h">
            <h3 id="asv-kit-h" class="asv-section-h"><i class="ph-duotone ph-arrows-clockwise" aria-hidden="true"></i> Kitaran semakan</h3>
            ${k ? `<div class="asv-kit-active">
                    <p><span class="asv-chip is-good">Aktif</span> <strong>${esc(k.nama)}</strong></p>
                    <p class="asv-muted">Dibuka ${esc(formatDateTime(k.dibuka_pada))} oleh ${esc(nameOf(k.dibuka_oleh))}</p>
                    <button type="button" class="asv-btn" data-act="close-kitaran"${locked ? '' : ' disabled'}>Tutup kitaran ini</button>
                </div>` : '<p class="asv-muted">Tiada kitaran aktif.</p>'}
            <div class="asv-inline-form">
                <label class="asv-field">Nama kitaran baharu
                    <input id="asv-kit-name" type="text" maxlength="60" value="${esc(kitName)}" placeholder="contoh: Semakan 1/2027">
                </label>
                <button type="button" class="asv-btn is-primary" data-act="open-kitaran"${locked ? '' : ' disabled'}>Buka kitaran baharu</button>
            </div>
            ${k ? '<p class="asv-hint">Membuka kitaran baharu akan menutup kitaran aktif. Rekod kitaran lama kekal.</p>' : ''}
            ${past.length ? `<details class="asv-details"><summary>Kitaran terdahulu <span class="asv-count">${past.length}</span></summary>
                <ul>${past.map(x => `<li><strong>${esc(x.nama)}</strong> <span class="asv-muted">${esc(formatDateTime(x.dibuka_pada).slice(0, 10))}${x.ditutup_pada ? ' hingga ' + esc(formatDateTime(x.ditutup_pada).slice(0, 10)) : ''}</span></li>`).join('')}</ul>
            </details>` : ''}
        </section>
        <section class="asv-card asv-section" aria-labelledby="asv-imp-h">
            <h3 id="asv-imp-h" class="asv-section-h"><i class="ph-duotone ph-upload-simple" aria-hidden="true"></i> Import CSV</h3>
            <p class="asv-hint">Lajur: kod_aset, keterangan, id_owner, owner, cost_centre, cc_keterangan, bangunan, bilik, nama_bilik (muka_surat diabaikan).
                Aset yang tiada dalam fail ditanda tidak aktif, tidak dipadam.</p>
            <label class="asv-file">
                <input id="asv-file" type="file" accept=".csv,text/csv">
                <span><i class="fas fa-file-upload" aria-hidden="true"></i> ${S.importFile ? esc(S.importFile) : 'Pilih fail CSV'}</span>
            </label>
            ${importPreviewHtml(locked)}
        </section>
        <section class="asv-card asv-section" aria-labelledby="asv-bil-h">
            <h3 id="asv-bil-h" class="asv-section-h"><i class="ph-duotone ph-door" aria-hidden="true"></i> Nama bilik</h3>
            ${roomRows.length ? `<ul class="asv-bilik-list">${roomRows.map(b => `<li>
                <label class="asv-field"><span class="asv-bilik-kod">${esc(b.kod_bilik)}</span>
                    <input type="text" maxlength="120" data-bilik-input="${esc(b.kod_bilik)}" value="${esc(b.nama || '')}" placeholder="Tiada nama">
                </label>
                <button type="button" class="asv-btn" data-act="save-bilik" data-room="${esc(b.kod_bilik)}">Simpan</button>
            </li>`).join('')}</ul>` : '<p class="asv-muted">Bilik dicipta secara automatik semasa import.</p>'}
        </section>`;
}

function importPreviewHtml(locked) {
    if (S.importErrors) {
        return `<div class="asv-note" data-tone="bad" role="alert">
            <p><strong>Fail tidak diimport.</strong> Betulkan perkara berikut, kemudian pilih fail semula:</p>
            <ul class="asv-errors">${S.importErrors.slice(0, 20).map(e => `<li>${esc(e)}</li>`).join('')}${S.importErrors.length > 20 ? `<li>dan ${S.importErrors.length - 20} lagi.</li>` : ''}</ul></div>`;
    }
    const p = S.importPlan;
    if (!p) return '';
    const list = (items, fmt) => `<ul>${items.slice(0, 200).map(fmt).join('')}${items.length > 200 ? `<li>dan ${items.length - 200} lagi.</li>` : ''}</ul>`;
    const block = (title, items, fmt, open = false) => items.length ? `<details class="asv-details"${open ? ' open' : ''}>
        <summary>${title} <span class="asv-count">${items.length}</span></summary>${list(items, fmt)}</details>` : '';
    return `<div class="asv-preview">
        <p class="asv-preview-sum"><strong>Pratonton:</strong> ${p.baharu.length} baharu, ${p.berubah.length} berubah,
            ${p.tiada.length} tiada dalam CSV, ${p.bilikBaharu.length} bilik baharu, ${p.sama} tiada perubahan.</p>
        ${block('Aset baharu', p.baharu, a => `<li><code>${esc(a.kod_aset)}</code> ${esc(a.keterangan)} <span class="asv-muted">${esc(a.bilik)}</span></li>`)}
        ${block('Aset berubah', p.berubah, c => `<li><code>${esc(c.asset.kod_aset)}</code> ${esc(c.asset.keterangan)}
            <ul class="asv-changes">${c.aktifSemula ? '<li>Diaktifkan semula</li>' : ''}${c.changes.map(ch => `<li>${esc(FIELD_LABELS[ch.field] || ch.field)}: ${esc(ch.from || '(kosong)')} <i class="fas fa-arrow-right" aria-label="kepada"></i> ${esc(ch.to || '(kosong)')}</li>`).join('')}</ul></li>`, true)}
        ${block('Tiada dalam CSV (akan ditanda tidak aktif)', p.tiada, a => `<li><code>${esc(a.kod_aset)}</code> ${esc(a.keterangan)} <span class="asv-muted">${esc(a.bilik)}</span></li>`, true)}
        ${block('Bilik baharu', p.bilikBaharu, b => `<li><code>${esc(b.kod_bilik)}</code> ${b.nama ? esc(b.nama) : '<em>Tiada nama</em>'}</li>`)}
        <div class="asv-preview-actions">
            <button type="button" class="asv-btn" data-act="import-cancel">Batal</button>
            <button type="button" class="asv-btn is-primary" data-act="import-run"${p.jumlah && locked ? '' : ' disabled'}>${p.jumlah ? `Import ${p.jumlah} perubahan` : 'Tiada perubahan'}</button>
        </div>
    </div>`;
}

async function onFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    S.importFile = file.name;
    S.importPlan = null; S.importErrors = null; S.importParsed = null;
    try {
        const parsed = readAssetCsv(await file.text());
        if (parsed.errors.length) S.importErrors = parsed.errors;
        else {
            S.importParsed = parsed;
            S.importPlan = buildImportPlan(parsed, S.master, S.bilik);
        }
    } catch (e) {
        console.error('Import read failed:', e);
        S.importErrors = ['Fail tidak dapat dibaca. Pastikan ia fail CSV.'];
    }
    render();
}

const GUARD_MESSAGES = {
    offline: 'Perlu sambungan internet untuk langkah ini.',
    rules: 'Peraturan keselamatan aset belum diterbitkan. Terbitkan firestore.rules terkini dahulu.',
    unknown: 'Peraturan keselamatan tidak dapat disemak. Semak sambungan internet dan cuba lagi.'
};

async function guarded(fn) {
    const g = await asetAdminGuard();
    if (g) { S.rules = g === 'rules' ? 'open' : S.rules; showToastNotification(GUARD_MESSAGES[g], 'danger'); render(); return; }
    await fn();
}

function runImport() {
    if (!S.importParsed) return;
    // Recount against the latest data: the other verifier may have imported meanwhile
    const plan = buildImportPlan(S.importParsed, S.master, S.bilik);
    if (!plan.jumlah) { S.importPlan = plan; render(); return; }
    showConfirmModal('Import data aset?',
        `${plan.baharu.length} aset baharu, ${plan.berubah.length} berubah, ${plan.tiada.length} ditanda tidak aktif (tidak dipadam) dan ${plan.bilikBaharu.length} bilik baharu.`,
        () => guarded(async () => {
            showLoading('Mengimport data aset...');
            try {
                const n = await importAset(plan);
                S.importPlan = null; S.importParsed = null; S.importFile = '';
                showToastNotification(`Import selesai: ${n} rekod dikemas kini.`, 'success');
            } catch (e) {
                console.error('Import failed:', e);
                showToastNotification(e && e.code === 'permission-denied'
                    ? 'Akaun ini tiada kebenaran menulis data aset.'
                    : 'Import gagal separuh jalan. Pilih fail yang sama sekali lagi untuk melengkapkannya.', 'danger');
            } finally {
                hideLoading();
                render();
            }
        }), { okLabel: 'Import', tone: 'safe' });
}

function runOpenKitaran() {
    const input = S.container.querySelector('#asv-kit-name');
    const nama = input ? input.value.trim() : '';
    if (!nama) { showToastNotification('Sila isi nama kitaran.', 'danger'); if (input) input.focus(); return; }
    if (S.kitaran.some(k => String(k.nama).trim().toLowerCase() === nama.toLowerCase())) {
        showToastNotification('Nama kitaran ini sudah digunakan.', 'danger'); return;
    }
    const k = activeKitaran();
    const go = () => guarded(async () => {
        showLoading('Membuka kitaran...');
        try {
            await openKitaran(nama, S.email, k ? k._id : null);
            showToastNotification(`Kitaran ${nama} dibuka.`, 'success');
        } catch (e) {
            console.error('openKitaran failed:', e);
            showToastNotification('Kitaran tidak dapat dibuka. Cuba lagi.', 'danger');
        } finally { hideLoading(); }
    });
    if (k) {
        showConfirmModal('Buka kitaran baharu?',
            `Kitaran ${k.nama} akan ditutup dan ${nama} dibuka. Rekod ${k.nama} kekal dan boleh dilihat dalam Ringkasan.`,
            go, { okLabel: 'Buka kitaran', tone: 'safe' });
    } else go();
}

function runCloseKitaran() {
    const k = activeKitaran();
    if (!k) return;
    showConfirmModal('Tutup kitaran ini?',
        `Selepas ${k.nama} ditutup, aset tidak lagi boleh ditanda. Rekodnya kekal dalam Ringkasan.`,
        () => guarded(async () => {
            showLoading('Menutup kitaran...');
            try {
                await closeKitaran(k._id);
                showToastNotification(`Kitaran ${k.nama} ditutup.`, 'success');
            } catch (e) {
                console.error('closeKitaran failed:', e);
                showToastNotification('Kitaran tidak dapat ditutup. Cuba lagi.', 'danger');
            } finally { hideLoading(); }
        }), { okLabel: 'Tutup kitaran' });
}

function runSaveBilik(kod) {
    const input = [...S.container.querySelectorAll('[data-bilik-input]')].find(el => el.dataset.bilikInput === kod);
    if (!input) return;
    saveBilikName(kod, input.value).catch(e => {
        console.error('saveBilikName failed:', e);
        showToastNotification('Nama bilik tidak dapat disimpan.', 'danger');
    });
    showToastNotification(`Nama bilik ${kod} disimpan.`, 'success');
}

// -- Cetak
function printHtml() {
    const rooms = roomList();
    if (!rooms.length) return note('Belum ada data aset untuk dicetak.');
    return `<div class="asv-card asv-section">
        <p class="asv-hint">Senarai aset mengikut bilik berserta QR (kira-kira 3 cm) dan kotak tanda. Satu bilik bermula pada halaman baharu, saiz A4.
            Guna sebagai sandaran apabila hanya membawa telefon: imbas QR pada kertas dengan app UPSI.</p>
        <div class="asv-inline-form">
            <label class="asv-field">Bilik
                <select id="asv-print-room">
                    <option value="semua"${S.printRoom === 'semua' ? ' selected' : ''}>Semua bilik (${rooms.length})</option>
                    ${rooms.map(r => `<option value="${esc(r.kod_bilik)}"${S.printRoom === r.kod_bilik ? ' selected' : ''}>${esc(r.kod_bilik)}${r.nama ? ' · ' + esc(r.nama) : ''} (${r.assets.length})</option>`).join('')}
                </select>
            </label>
            <button type="button" class="asv-btn is-primary" data-act="print"><i class="ph-duotone ph-printer" aria-hidden="true"></i> Cetak</button>
        </div>
    </div>`;
}

async function printRooms(kod) {
    try { await loadQrLib(); } catch (_) {
        showToastNotification('Penjana QR tidak dapat dimuatkan. Muat semula halaman dan cuba lagi.', 'danger');
        return;
    }
    const rooms = roomList().filter(r => kod === 'semua' || r.kod_bilik === kod);
    const k = activeKitaran();
    const today = formatDateTime(new Date()).slice(0, 10);
    document.getElementById('aset-print-root')?.remove();
    const root = document.createElement('div');
    root.id = 'aset-print-root';
    root.innerHTML = rooms.map(r => `<section class="asp-room">
        <div class="asp-head">
            <h2>${esc(r.kod_bilik)}${r.nama ? ' · ' + esc(r.nama) : ''}</h2>
            <p>Semakan aset Pusat Alumni UPSI${k ? ' · ' + esc(k.nama) : ''} · Dicetak ${esc(today)} · ${r.assets.length} aset</p>
        </div>
        <table class="asp-table">
            <colgroup><col class="c-qr"><col class="c-kod"><col><col class="c-owner"><col class="c-box"></colgroup>
            <thead><tr><th>QR</th><th>Kod aset</th><th>Keterangan</th><th>Owner</th><th>Tanda</th></tr></thead>
            <tbody>${r.assets.map(a => `<tr>
                <td class="asp-qr">${qrSvg(a.kod_aset)}</td>
                <td class="asp-kod">${esc(a.kod_aset)}</td>
                <td>${esc(a.keterangan || '')}</td>
                <td>${esc(ownerLabel(a))}</td>
                <td class="asp-box"><span></span></td>
            </tr>`).join('')}</tbody>
        </table>
    </section>`).join('');
    document.body.appendChild(root);
    document.documentElement.classList.add('aset-printing');
    const cleanup = () => {
        document.documentElement.classList.remove('aset-printing');
        root.remove();
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
}

// ---- Events ------------------------------------------------------------------
function onClick(e) {
    const t = e.target.closest('button, [data-open]');
    if (!t || !S.container.contains(t)) return;
    if (t.dataset.screen) {
        S.screen = t.dataset.screen;
        S.roomId = null;
        if (S.screen !== 'ringkasan') S.summaryId = null;
        if (S.screen === 'pentadbiran') refreshRules();
        render();
        return;
    }
    if (t.dataset.filter) { S.roomFilter = t.dataset.filter; renderDyn(); return; }
    if (t.dataset.open) { openQr(t.dataset.open); return; }
    if (t.dataset.room && !t.dataset.act) {
        S.roomId = t.dataset.room; render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    const act = t.dataset.act;
    if (act === 'rooms') { S.roomId = null; render(); }
    else if (act === 'export') exportCsv();
    else if (act === 'open-kitaran') runOpenKitaran();
    else if (act === 'close-kitaran') runCloseKitaran();
    else if (act === 'import-run') runImport();
    else if (act === 'import-cancel') { S.importPlan = null; S.importParsed = null; S.importErrors = null; S.importFile = ''; render(); }
    else if (act === 'save-bilik') runSaveBilik(t.dataset.room);
    else if (act === 'print') printRooms(S.printRoom);
    else if (act === 'print-room') printRooms(t.dataset.room);
}

function onInput(e) {
    if (e.target.id === 'asv-search') { S.search = e.target.value; renderDyn(); }
}

function onChange(e) {
    const el = e.target;
    if (el.id === 'asv-file') onFile(el);
    else if (el.id === 'asv-summary-kitaran') { S.summaryId = el.value; syncSemakanSub(); render(); }
    else if (el.id === 'asv-print-room') S.printRoom = el.value;
}

// ---- QR library (vendored, loaded on first use) ---------------------------
let qrLibPromise = null;
function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLibPromise) {
        qrLibPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'js/vendor/qrcode.js';
            s.onload = () => resolve();
            s.onerror = () => { qrLibPromise = null; reject(new Error('qrcode.js failed to load')); };
            document.head.appendChild(s);
        });
    }
    return qrLibPromise;
}

// The raw asset code only: no prefix, suffix, URL, spaces or line breaks
// (tested with the UPSI app on 18/11/2026). Error correction M, a quiet zone
// of 4 modules, drawn as SVG so it stays sharp at any size.
function qrSvg(kod) {
    const q = window.qrcode(0, 'M');
    q.addData(String(kod).trim());
    q.make();
    return q.createSvgTag({ cellSize: 1, margin: 4, scalable: true });
}

// ---- Mod QR -----------------------------------------------------------------
const Q = {
    el: null, open: false, id: null, roomId: null, pendingStatus: null,
    undoTimer: null, noteTimer: null, wakeLock: null, undone: false
};

function qrEl() {
    if (Q.el) return Q.el;
    const el = document.createElement('div');
    el.id = 'aset-qr';
    el.className = 'asq hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'asq-kod');
    el.innerHTML = `
        <div class="asq-inner">
            <div class="asq-left">
                <div class="asq-qr" aria-hidden="true"></div>
                <p id="asq-kod" class="asq-kod"></p>
            </div>
            <div class="asq-right">
                <p class="asq-offline hidden" role="status"><i class="fas fa-wifi" aria-hidden="true"></i> Luar talian - perubahan akan disegerakkan</p>
                <div class="asq-banner" role="status"></div>
                <div class="asq-toast hidden" role="status">
                    <span><i class="fas fa-check-circle" aria-hidden="true"></i> Ditanda sudah diimbas</span>
                    <button type="button" data-q="undo">Batal</button>
                </div>
                <p class="asq-ket"></p>
                <p class="asq-meta"></p>
                <fieldset class="asq-status">
                    <legend>Status (pilih yang sama dalam app UPSI)</legend>
                    <div class="asq-chips">${ASET_STATUS.map(x => `<button type="button" class="asq-chip${x.bermasalah ? ' is-issue' : ''}"
                        data-status="${esc(x.status)}" aria-pressed="false">${esc(x.status)}</button>`).join('')}</div>
                </fieldset>
                <label class="asq-note-label" for="asq-note">Catatan <span class="asq-note-req">(wajib bagi LAIN-LAIN)</span></label>
                <textarea id="asq-note" class="asq-note" rows="2" maxlength="500"></textarea>
                <p class="asq-err" role="alert"></p>
                <div class="asq-actions">
                    <button type="button" class="asq-btn" data-q="close"><i class="fas fa-times" aria-hidden="true"></i> Tutup</button>
                    <button type="button" class="asq-btn is-primary" data-q="next">Seterusnya <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
                </div>
            </div>
        </div>`;
    el.addEventListener('click', onQrClick);
    el.querySelector('#asq-note').addEventListener('input', () => {
        clearTimeout(Q.noteTimer);
        Q.noteTimer = setTimeout(saveNote, 700);
        if (Q.pendingStatus === STATUS_LAIN && noteText()) setErr('');
    });
    el.querySelector('#asq-note').addEventListener('blur', saveNote);
    const syncOffline = () => el.querySelector('.asq-offline').classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', syncOffline);
    window.addEventListener('offline', syncOffline);
    syncOffline();
    document.body.appendChild(el);
    Q.el = el;
    return el;
}

const noteText = () => (Q.el ? Q.el.querySelector('#asq-note').value.trim() : '');
const setErr = (t) => { if (Q.el) Q.el.querySelector('.asq-err').textContent = t; };
const qrAsset = () => S.master.get(Q.id);
const qrRecord = () => S.semakan.get(Q.id);
const qrWritable = () => !!activeKitaran() && S.semakanFor === activeKitaran()._id;

async function openQr(id, roomId) {
    const asset = S.master.get(id);
    if (!asset) return;
    try { await loadQrLib(); } catch (_) {
        showToastNotification('Penjana QR tidak dapat dimuatkan. Muat semula halaman dan cuba lagi.', 'danger');
        return;
    }
    const el = qrEl();
    if (!Q.open) {
        Q.open = true;
        el.classList.remove('hidden');
        document.body.classList.add('asq-open');
        history.pushState({ asetQr: true }, '');
        document.addEventListener('keydown', onQrKey);
        lockScreen();
    }
    clearTimeout(Q.undoTimer);
    el.querySelector('.asq-toast').classList.add('hidden');
    Q.id = id;
    Q.roomId = roomId || asset.bilik;
    Q.pendingStatus = null;
    Q.undone = false;
    setErr('');
    const box = el.querySelector('.asq-qr');
    box.innerHTML = qrSvg(asset.kod_aset);
    box.dataset.kod = asset.kod_aset;
    el.querySelector('#asq-kod').textContent = asset.kod_aset;
    el.querySelector('.asq-ket').textContent = asset.keterangan || '(tiada keterangan)';
    const nama = roomName(asset.bilik);
    el.querySelector('.asq-meta').textContent = `${ownerLabel(asset)} · ${asset.bilik}${nama ? ' ' + nama : ''}`;
    el.querySelector('#asq-note').value = (qrRecord() && qrRecord().catatan) || '';

    if (qrWritable() && !isScanned(id)) mark(asset, true);
    refreshQr();
    el.querySelector('[data-q="next"]').focus({ preventScroll: true });
}

// Marks the asset checked (status BAIK) without waiting for the server
function mark(asset, withUndo) {
    const k = activeKitaran();
    if (!k) return;
    markScanned(k._id, asset, S.email).catch(e => {
        console.error('markScanned failed:', e);
        showToastNotification('Tanda tidak dapat disimpan. Semak akses akaun ini.', 'danger');
    });
    // Shown at once; the live listener confirms it a moment later
    S.semakan.set(asset._id, { _id: asset._id, kod_aset: asset.kod_aset, bilik: asset.bilik, discan: true,
        status: STATUS_BAIK, catatan: '', discan_pada: new Date(), discan_oleh: S.email, _pending: true });
    Q.undone = false;
    scheduleRender();
    if (withUndo) {
        const toast = Q.el.querySelector('.asq-toast');
        toast.classList.remove('hidden');
        clearTimeout(Q.undoTimer);
        Q.undoTimer = setTimeout(() => { toast.classList.add('hidden'); refreshQr(); }, 6000);
    }
}

function undo() {
    const k = activeKitaran();
    const asset = qrAsset();
    if (!k || !asset) return;
    clearTimeout(Q.undoTimer);
    Q.el.querySelector('.asq-toast').classList.add('hidden');
    undoScan(k._id, asset.kod_aset).catch(e => {
        console.error('undoScan failed:', e);
        showToastNotification('Batal tidak dapat disimpan.', 'danger');
    });
    S.semakan.delete(asset._id);
    Q.undone = true;
    Q.pendingStatus = null;
    Q.el.querySelector('#asq-note').value = '';
    scheduleRender();
    refreshQr();
}

// Banner, status chips and the note, from the latest record
function refreshQr() {
    if (!Q.open || !Q.el) return;
    const el = Q.el;
    const rec = qrRecord();
    const writable = qrWritable();
    const done = !!(rec && rec.discan);
    const banner = el.querySelector('.asq-banner');
    if (!activeKitaran()) {
        banner.dataset.tone = 'warn';
        banner.innerHTML = 'Tiada kitaran aktif. QR dipaparkan untuk rujukan sahaja; tiada apa-apa ditanda.';
    } else if (Q.undone || !done) {
        banner.dataset.tone = 'warn';
        banner.innerHTML = `Aset ini belum diimbas.${writable ? ' <button type="button" class="asq-link" data-q="remark">Tanda sudah diimbas</button>' : ''}`;
    } else if (el.querySelector('.asq-toast').classList.contains('hidden')) {
        banner.dataset.tone = isBermasalah(rec.status) ? 'issue' : 'done';
        banner.textContent = `Sudah diimbas pada ${formatDateTime(rec.discan_pada)} oleh ${nameOf(rec.discan_oleh)}`;
    } else {
        banner.dataset.tone = 'new';
        banner.textContent = 'Imbas QR ini dengan app UPSI di telefon, kemudian pilih status yang sama di sini.';
    }
    const current = Q.pendingStatus || (done ? rec.status : null);
    el.querySelectorAll('.asq-chip').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.status === current));
        b.disabled = !writable || !done;
    });
    const note = el.querySelector('#asq-note');
    note.disabled = !writable || !done;
    if (document.activeElement !== note && done && !Q.pendingStatus) note.value = rec.catatan || '';
}

function chooseStatus(status) {
    const k = activeKitaran();
    const asset = qrAsset();
    const rec = qrRecord();
    if (!k || !asset || !rec || !rec.discan) return;
    if (status === STATUS_LAIN && !noteText()) {
        Q.pendingStatus = STATUS_LAIN;
        setErr('Catatan wajib bagi LAIN-LAIN. Status akan disimpan sebaik catatan diisi.');
        refreshQr();
        Q.el.querySelector('#asq-note').focus();
        return;
    }
    save(status, noteText());
}

function save(status, catatan) {
    const k = activeKitaran();
    const asset = qrAsset();
    if (!k || !asset) return;
    updateSemakan(k._id, asset.kod_aset, { status, catatan }, S.email).catch(e => {
        console.error('updateSemakan failed:', e);
        showToastNotification('Status tidak dapat disimpan.', 'danger');
    });
    const rec = qrRecord();
    if (rec) S.semakan.set(asset._id, Object.assign({}, rec, { status, catatan, _pending: true }));
    Q.pendingStatus = null;
    setErr('');
    scheduleRender();
    refreshQr();
}

// Saves the note (debounced while typing, and on leaving the field)
function saveNote() {
    clearTimeout(Q.noteTimer);
    if (!Q.open) return;
    const rec = qrRecord();
    if (!rec || !rec.discan || !qrWritable()) return;
    const text = noteText();
    const status = Q.pendingStatus || rec.status;
    if (status === STATUS_LAIN && !text) {
        if (!Q.pendingStatus) setErr('Catatan wajib bagi LAIN-LAIN. Catatan lama dikekalkan.');
        return;
    }
    if (status === rec.status && text === (rec.catatan || '')) return;
    save(status, text);
}

// A LAIN-LAIN chosen without a note would be lost: say so before leaving
function canLeave() {
    saveNote();
    if (Q.pendingStatus === STATUS_LAIN && !noteText()) {
        setErr('Isi catatan untuk LAIN-LAIN, atau pilih status lain, sebelum meneruskan.');
        Q.el.querySelector('#asq-note').focus();
        return false;
    }
    return true;
}

function next() {
    if (!canLeave()) return;
    const list = roomAssets(Q.roomId);
    const i = list.findIndex(a => a._id === Q.id);
    const order = list.slice(i + 1).concat(list.slice(0, Math.max(i, 0)));
    const nextAsset = order.find(a => a._id !== Q.id && !isScanned(a._id));
    if (!nextAsset) {
        closeQr();
        S.screen = 'bilik'; S.roomId = null;
        render();
        showToastNotification('Bilik ini sudah selesai.', 'success');
        return;
    }
    openQr(nextAsset._id, Q.roomId);
}

function closeQr() {
    if (!Q.open) return;
    if (history.state && history.state.asetQr) history.back();   // popstate below hides it
    else hideQr();
}

function hideQr() {
    if (!Q.open) return;
    saveNote();
    if (Q.pendingStatus === STATUS_LAIN && !noteText()) {
        showToastNotification('Status LAIN-LAIN tidak disimpan kerana tiada catatan.', 'info');
    }
    Q.open = false;
    clearTimeout(Q.undoTimer);
    clearTimeout(Q.noteTimer);
    Q.el.classList.add('hidden');
    document.body.classList.remove('asq-open');
    document.removeEventListener('keydown', onQrKey);
    releaseScreen();
    render();
}

window.addEventListener('popstate', () => {
    if (Q.open && !(history.state && history.state.asetQr)) hideQr();
});

function onQrClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.status) chooseStatus(b.dataset.status);
    else if (b.dataset.q === 'close') { if (canLeave()) closeQr(); }
    else if (b.dataset.q === 'next') next();
    else if (b.dataset.q === 'undo') undo();
    else if (b.dataset.q === 'remark') { const a = qrAsset(); if (a) { mark(a, true); refreshQr(); } }
}

function onQrKey(e) {
    if (e.key === 'Escape' && !document.querySelector('.modal.is-open')) {
        e.preventDefault();
        if (canLeave()) closeQr();
    }
}

// Keep the screen awake while a QR is shown (Screen Wake Lock API)
async function lockScreen() {
    try {
        if ('wakeLock' in navigator && !Q.wakeLock) {
            Q.wakeLock = await navigator.wakeLock.request('screen');
            Q.wakeLock.addEventListener('release', () => { Q.wakeLock = null; });
        }
    } catch (_) { /* not allowed or not supported: the QR still works */ }
}
function releaseScreen() {
    if (Q.wakeLock) Q.wakeLock.release().catch(() => {});
    Q.wakeLock = null;
}
// The browser drops the lock when the tab is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
    if (Q.open && document.visibilityState === 'visible') lockScreen();
});
