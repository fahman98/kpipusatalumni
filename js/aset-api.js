// --- JS/ASET-API.JS ---
// Every Firestore read and write of the asset check (tab Aset). Kept apart
// from api.js so the KPI data paths are never touched from here.
// Path: artifacts/{appId}/public/data/
//   aset/{assetDocId}            master data, changed only by an import
//   aset-bilik/{kod_bilik}       { kod_bilik, nama, urutan? }
//   aset-kitaran/{id}            { nama, status aktif|ditutup, dibuka_pada,
//                                  ditutup_pada, dibuka_oleh }
//   aset-kitaran/{id}/semakan/{assetDocId}
//                                { kod_aset, bilik, discan, status, catatan,
//                                  discan_pada, discan_oleh, dikemaskini_pada,
//                                  dikemaskini_oleh }
//   aset-tetapan/umum            { kitaran_aktif }
// None of this is public: firestore.rules allows the aset accounts only
// (isAset). Imports and cycle changes first check those rules are live.
//
// Ticks are written without waiting for the server (set() resolves only
// once the server has it, which never happens offline). Firestore keeps the
// write in its offline queue and sends it when the connection is back.

import { assetDocId, STATUS_BAIK } from './aset.js';

const getAppId = () => (typeof appId !== 'undefined' ? appId : 'dashboard-alumni-kpi');
const base = () => `artifacts/${getAppId()}/public/data`;
const col = (name) => db.collection(`${base()}/${name}`);
const semakanCol = (kitaranId) => db.collection(`${base()}/aset-kitaran/${kitaranId}/semakan`);
const tetapanRef = () => col('aset-tetapan').doc('umum');
const ts = () => firebase.firestore.FieldValue.serverTimestamp();

// A pending local write has no server time yet: 'estimate' gives the local
// clock instead of null, so a fresh tick shows its time straight away.
const readDocs = (snap) => snap.docs.map(d => Object.assign(
    { _id: d.id, _pending: !!(d.metadata && d.metadata.hasPendingWrites) },
    d.data({ serverTimestamps: 'estimate' })));

function subscribeCol(ref, onData, onError) {
    try {
        return ref.onSnapshot(
            (snap) => onData(readDocs(snap)),
            (err) => { console.error('Aset listener:', err); if (onError) onError(err); });
    } catch (e) {
        console.error('Aset subscribe failed:', e);
        if (onError) onError(e);
        return () => {};
    }
}

// ---- Live reads (onSnapshot), each returns an unsubscribe function --------
export const subscribeAset = (onData, onError) => subscribeCol(col('aset'), onData, onError);
export const subscribeBilik = (onData, onError) => subscribeCol(col('aset-bilik'), onData, onError);
export const subscribeKitaran = (onData, onError) => subscribeCol(col('aset-kitaran'), onData, onError);
export const subscribeSemakan = (kitaranId, onData, onError) =>
    subscribeCol(semakanCol(kitaranId), onData, onError);

export function subscribeTetapan(onData, onError) {
    try {
        return tetapanRef().onSnapshot(
            (snap) => onData(snap.exists ? snap.data() : {}),
            (err) => { console.error('Aset tetapan listener:', err); if (onError) onError(err); });
    } catch (e) {
        if (onError) onError(e);
        return () => {};
    }
}

// ---- Ticks (work offline) --------------------------------------------------
// Opening the QR of an asset not yet checked marks it checked, status BAIK.
export function markScanned(kitaranId, asset, email) {
    return semakanCol(kitaranId).doc(assetDocId(asset.kod_aset)).set({
        kod_aset: asset.kod_aset,
        bilik: asset.bilik || '',
        discan: true,
        status: STATUS_BAIK,
        catatan: '',
        discan_pada: ts(),
        discan_oleh: email,
        dikemaskini_pada: ts(),
        dikemaskini_oleh: email
    });
}

// "Batal" after opening by mistake: back to not checked
export function undoScan(kitaranId, kod) {
    return semakanCol(kitaranId).doc(assetDocId(kod)).delete();
}

// Status / catatan change; never touches discan_pada or discan_oleh
export function updateSemakan(kitaranId, kod, { status, catatan }, email) {
    return semakanCol(kitaranId).doc(assetDocId(kod)).set({
        status, catatan: String(catatan || ''),
        dikemaskini_pada: ts(), dikemaskini_oleh: email
    }, { merge: true });
}

export function saveBilikName(kod, nama) {
    return col('aset-bilik').doc(kod).set({ kod_bilik: kod, nama: String(nama || '').trim() }, { merge: true });
}

// ---- Rules check ------------------------------------------------------------
// Are the aset rules live? Reads aset-tetapan/umum as a guest through a
// second, never-signed-in Firebase app: a refusal means they are.
// 'locked' | 'open' | 'unknown' (offline / other error). Remembered once
// locked, since rules are not rolled back in practice.
let rulesLocked = false;
export async function checkAsetRules() {
    if (rulesLocked) return 'locked';
    try {
        let probe;
        try { probe = firebase.app('aset-probe'); }
        catch (_) { probe = firebase.initializeApp(firebaseConfig, 'aset-probe'); }
        await probe.firestore().collection(`${base()}/aset-tetapan`).doc('umum').get({ source: 'server' });
        return 'open';
    } catch (e) {
        if (e && e.code === 'permission-denied') { rulesLocked = true; return 'locked'; }
        console.warn('checkAsetRules:', e);
        return 'unknown';
    }
}

// Before an import or a cycle change: null when it may go ahead, else
// 'offline' | 'rules' (not deployed yet) | 'unknown'
export async function asetAdminGuard() {
    if (!navigator.onLine) return 'offline';
    const rules = await checkAsetRules();
    if (rules === 'open') return 'rules';
    if (rules !== 'locked') return 'unknown';
    return null;
}

// Firestore allows 500 writes per batch; stay well under it
const BATCH_LIMIT = 450;
async function commitInBatches(ops) {
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        ops.slice(i, i + BATCH_LIMIT).forEach(op => {
            if (op.type === 'update') batch.update(op.ref, op.data);
            else batch.set(op.ref, op.data, op.merge ? { merge: true } : undefined);
        });
        await batch.commit();
    }
}

// ---- Import (aset.js buildImportPlan) --------------------------------------
// Upsert by kod_aset with merge (keeps nota_tetap), mark assets missing from
// the CSV aktif: false (never deleted), create the new rooms. Existing room
// names are left alone: they may have been edited here.
export async function importAset(plan) {
    const ops = [];
    const assetRef = (kod) => col('aset').doc(assetDocId(kod));
    plan.baharu.forEach(a => ops.push({ ref: assetRef(a.kod_aset), merge: true,
        data: Object.assign({}, a, { aktif: true, nota_tetap: '', dikemaskini_pada: ts() }) }));
    plan.berubah.forEach(({ asset }) => ops.push({ ref: assetRef(asset.kod_aset), merge: true,
        data: Object.assign({}, asset, { aktif: true, dikemaskini_pada: ts() }) }));
    plan.tiada.forEach(a => ops.push({ type: 'update', ref: assetRef(a.kod_aset),
        data: { aktif: false, dikemaskini_pada: ts() } }));
    plan.bilikBaharu.forEach(b => ops.push({ ref: col('aset-bilik').doc(b.kod_bilik), merge: true,
        data: { kod_bilik: b.kod_bilik, nama: b.nama || '' } }));
    await commitInBatches(ops);
    return ops.length;
}

// ---- Cycles -----------------------------------------------------------------
// Readable id from the opening time, e.g. k-20261029-100000
function newKitaranId(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `k-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

// Opens a new cycle; the active one (if any) is closed in the same batch.
// Records of old cycles stay.
export async function openKitaran(nama, email, activeId) {
    const id = newKitaranId();
    const ops = [{ ref: col('aset-kitaran').doc(id), data: {
        nama: String(nama).trim(), status: 'aktif', dibuka_pada: ts(), ditutup_pada: null, dibuka_oleh: email } }];
    if (activeId) ops.push({ type: 'update', ref: col('aset-kitaran').doc(activeId),
        data: { status: 'ditutup', ditutup_pada: ts() } });
    ops.push({ ref: tetapanRef(), merge: true, data: { kitaran_aktif: id } });
    await commitInBatches(ops);
    return id;
}

export async function closeKitaran(id) {
    await commitInBatches([
        { type: 'update', ref: col('aset-kitaran').doc(id), data: { status: 'ditutup', ditutup_pada: ts() } },
        { ref: tetapanRef(), merge: true, data: { kitaran_aktif: null } }
    ]);
}
