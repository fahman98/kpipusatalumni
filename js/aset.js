// --- JS/ASET.JS ---
// Semakan aset: plain logic with no Firestore and no DOM, so it is easy to
// read and to test. Status list, CSV parse / export, the import diff and
// small formatting helpers. Firestore access lives in aset-api.js, the tab
// in aset-view.js.

// Verification remarks, spelled EXACTLY as in the UPSI asset app so the
// verifier never has to translate. Mirrored in firestore.rules
// (validSemakan). The first one is the default when a QR is opened.
export const ASET_STATUS = [
    { status: 'ASET DALAM KEADAAN BAIK', bermasalah: false },
    { status: 'ASET TIADA DI LOKASI', bermasalah: true },
    { status: 'ASET ROSAK', bermasalah: true },
    { status: 'ASET DALAM PROSES PELUPUSAN', bermasalah: true },
    { status: 'ASET SUDAH LUPUS', bermasalah: true },
    { status: 'ASET DALAM PROSES BAIK PULIH', bermasalah: true },
    { status: 'LOKASI TIDAK DIKEMASKINI', bermasalah: true },
    { status: 'PEMILIK ASET TIDAK DIKEMASKINI', bermasalah: true },
    { status: 'STICKER HILANG/TIADA', bermasalah: true },
    { status: 'STICKER PUDAR', bermasalah: true },
    { status: 'LAIN-LAIN', bermasalah: true }   // catatan wajib
];
export const STATUS_BAIK = ASET_STATUS[0].status;
export const STATUS_LAIN = 'LAIN-LAIN';
export const STATUS_BELUM = 'BELUM DIIMBAS';   // export only, never stored

export function isBermasalah(status) {
    const s = ASET_STATUS.find(x => x.status === status);
    return !!(s && s.bermasalah);
}

// Short names for "oleh ..." lines; anyone else shows their email's first part
const ASET_NAMES = {
    'fahman@upsi.edu.my': 'Fahman',
    'farhiah@upsi.edu.my': 'Farhiah',
    'alumni@upsi.edu.my': 'Akaun unit'
};
export function nameOf(email) {
    const e = String(email || '').trim().toLowerCase();
    return ASET_NAMES[e] || (e ? e.split('@')[0] : '-');
}

// Firestore document ids cannot contain "/" (e.g. KK/15/03/6940/107011),
// so every asset document id is the encoded code. The QR is ALWAYS made
// from the `kod_aset` field, never from this id.
export function assetDocId(kod) {
    return encodeURIComponent(String(kod || '').trim());
}

export function ownerLabel(a) {
    return (a && String(a.owner || '').trim()) || '(tiada owner)';
}

// Sort by asset code, the order of the KEW.PA-7 report
export function byKod(a, b) {
    return String(a.kod_aset).localeCompare(String(b.kod_aset), 'en', { numeric: true });
}

export function byRoom(a, b) {
    const ua = Number.isFinite(a.urutan) ? a.urutan : 1e9;
    const ub = Number.isFinite(b.urutan) ? b.urutan : 1e9;
    return (ua - ub) || String(a.kod_bilik).localeCompare(String(b.kod_bilik), 'en', { numeric: true });
}

// ---- Dates ---------------------------------------------------------------
// Firestore Timestamp, Date or ISO string -> Date (null when missing)
export function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');
// DD/MM/YYYY HH:mm (24 hours); '' when unknown
export function formatDateTime(v) {
    const d = toDate(v);
    if (!d) return '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "Semakan 1/2027" for January to June, "Semakan 2/2027" after
export function suggestKitaranName(now = new Date()) {
    return `Semakan ${now.getMonth() < 6 ? 1 : 2}/${now.getFullYear()}`;
}

// ---- CSV -----------------------------------------------------------------
// RFC 4180 parser: quoted fields, "" inside quotes, commas and line breaks
// inside quotes, CRLF or LF, and a UTF-8 BOM. Returns rows of strings.
export function parseCsv(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inQuotes) {
            if (c === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// With a BOM so Excel opens Malay text and symbols correctly
export function toCsv(header, rows) {
    return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Columns of data/aset_awal.csv; muka_surat is a reference to the paper
// report only and is not imported
export const CSV_COLUMNS = ['kod_aset', 'keterangan', 'id_owner', 'owner', 'cost_centre',
    'cc_keterangan', 'bangunan', 'bilik', 'nama_bilik'];
// Fields compared on re-import (bilik / owner / keterangan and the rest)
export const MASTER_FIELDS = ['keterangan', 'id_owner', 'owner', 'cost_centre', 'cc_keterangan', 'bangunan', 'bilik'];
export const FIELD_LABELS = {
    keterangan: 'Keterangan', id_owner: 'ID owner', owner: 'Owner', cost_centre: 'Cost centre',
    cc_keterangan: 'Keterangan cost centre', bangunan: 'Bangunan', bilik: 'Bilik'
};

// The OCR of the KEW.PA-7 report put the table header into the room name of
// rooms that had none (e.g. "NEW ASSETCODE _| OLD ASSET CODE ..."). Those
// rooms have no name: treat such text as empty.
export function cleanRoomName(name) {
    const s = String(name || '').replace(/\s+/g, ' ').trim();
    if (!s || /ASSET\s*CODE|ASSET\s*OWNER|COST\s*CENTRE|\|/i.test(s)) return '';
    return s;
}

// CSV text -> { assets: [{...}], rooms: Map(kod -> nama), errors: [] }.
// errors are plain sentences; a file with any error is not imported.
export function readAssetCsv(text) {
    const rows = parseCsv(text);
    const errors = [];
    if (!rows.length) return { assets: [], rooms: new Map(), errors: ['Fail CSV kosong.'] };
    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const missing = CSV_COLUMNS.filter(c => !header.includes(c));
    if (missing.length) {
        return { assets: [], rooms: new Map(), errors: [`Lajur tiada dalam fail: ${missing.join(', ')}.`] };
    }
    const col = Object.fromEntries(CSV_COLUMNS.map(c => [c, header.indexOf(c)]));
    const seen = new Set();
    const assets = [];
    const rooms = new Map();
    rows.slice(1).forEach((r, i) => {
        const line = i + 2;
        const get = (c) => String(r[col[c]] == null ? '' : r[col[c]]).trim();
        const kod = get('kod_aset');
        if (!kod) { errors.push(`Baris ${line}: kod aset kosong.`); return; }
        if (/\s/.test(kod)) { errors.push(`Baris ${line}: kod aset "${kod}" mengandungi ruang kosong.`); return; }
        if (seen.has(kod)) { errors.push(`Baris ${line}: kod aset ${kod} berulang.`); return; }
        const bilik = get('bilik');
        if (!bilik) { errors.push(`Baris ${line}: kod bilik kosong bagi ${kod}.`); return; }
        if (bilik.includes('/')) { errors.push(`Baris ${line}: kod bilik "${bilik}" tidak boleh mengandungi "/".`); return; }
        seen.add(kod);
        const a = { kod_aset: kod };
        MASTER_FIELDS.forEach(f => { a[f] = get(f); });
        assets.push(a);
        const nama = cleanRoomName(get('nama_bilik'));
        if (!rooms.has(bilik) || (!rooms.get(bilik) && nama)) rooms.set(bilik, nama);
    });
    if (!assets.length && !errors.length) errors.push('Tiada aset dalam fail ini.');
    return { assets, rooms, errors };
}

// Compare the CSV with the stored master data.
//   master  Map(docId -> asset)     bilik  Map(kod -> room)
// Returns what an import would do; nothing is ever deleted: assets missing
// from the CSV are only marked aktif: false.
export function buildImportPlan(parsed, master, bilik) {
    const plan = { baharu: [], berubah: [], tiada: [], sama: 0, bilikBaharu: [] };
    const inCsv = new Set();
    parsed.assets.forEach(a => {
        const id = assetDocId(a.kod_aset);
        inCsv.add(id);
        const old = master.get(id);
        if (!old) { plan.baharu.push(a); return; }
        const changes = MASTER_FIELDS
            .filter(f => String(old[f] == null ? '' : old[f]) !== a[f])
            .map(f => ({ field: f, from: String(old[f] == null ? '' : old[f]), to: a[f] }));
        const aktifSemula = old.aktif === false;
        if (changes.length || aktifSemula) plan.berubah.push({ asset: a, changes, aktifSemula });
        else plan.sama++;
    });
    master.forEach((old, id) => {
        if (!inCsv.has(id) && old.aktif !== false) plan.tiada.push(old);
    });
    parsed.rooms.forEach((nama, kod) => {
        if (!bilik.has(kod)) plan.bilikBaharu.push({ kod_bilik: kod, nama });
    });
    [plan.baharu, plan.tiada].forEach(l => l.sort(byKod));
    plan.berubah.sort((x, y) => byKod(x.asset, y.asset));
    plan.bilikBaharu.sort(byRoom);
    plan.jumlah = plan.baharu.length + plan.berubah.length + plan.tiada.length + plan.bilikBaharu.length;
    return plan;
}
