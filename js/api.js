// --- JS/API.JS ---
import {
    isEditMode,
    showToastNotification,
    closeModal,
    showDetailsModal,
    showLoading,
    hideLoading,
    showConfirmModal
} from './ui.js';

// Cache Exported
export let kpiDataCache = {};

// Variable Global untuk Tahun (Default 2026)
export let selectedYear = "2026";

export function setApiYear(year) {
    selectedYear = year || "2026"; // Fallback to 2026 if empty
    kpiDataCache = {}; // Reset cache bila tukar tahun
    console.log("API Year Set To:", selectedYear);
}

// Variable untuk simpan listener aktif
let activeListener = null;
let listenerGeneration = 0;

// Helper to get APP ID safely
const getAppId = () => {
    // Check if firebase config exists globally
    if (typeof appId !== 'undefined') return appId;
    // Fallback based on config.js pattern if appId variable isn't visible yet
    return "dashboard-alumni-kpi";
};

// Timestamp string for the "Data dikemaskini pada ..." dashboard footer.
// Stamped on every KPI write so the footer reflects the latest change.
const nowFooterDate = () => new Date().toLocaleDateString('ms-MY', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

// --- GLOBAL "LAST UPDATED" --------------------------------------------------
// One per-year marker bumped by EVERY write (KPI, Penjanaan, Takwim) so the
// footer always shows the most recent change, regardless of quarter or tab.
const lastUpdatedDocRef = (year) =>
    db.collection(`artifacts/${getAppId()}/public/data/meta`).doc(String(year));

async function touchLastUpdated(year = selectedYear) {
    try {
        const user = firebase.auth().currentUser;
        await lastUpdatedDocRef(year).set({
            label: nowFooterDate(),
            by: user ? user.email : 'unknown',
            ts: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("touchLastUpdated error:", e);
    }
}

export function subscribeLastUpdated(year, callback) {
    try {
        return lastUpdatedDocRef(year).onSnapshot(
            (snap) => callback(snap.exists ? (snap.data().label || null) : null),
            (err) => console.error("Ralat sync lastUpdated:", err)
        );
    } catch (e) {
        console.error("subscribeLastUpdated error:", e);
        return () => {};
    }
}

// --- AUDIT LOG ---
async function writeAuditLog(action, details) {
    try {
        const user = firebase.auth().currentUser;
        await db.collection(`artifacts/${getAppId()}/public/data/audit-logs`).add({
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            user: user ? user.email : 'unknown',
            action,
            year: selectedYear,
            details
        });
    } catch (e) {
        console.error("Audit log error:", e);
    }
    // Any audited action also bumps the global "last updated" marker.
    touchLastUpdated();
}

// --- FUNGSI REAL-TIME LISTENER ---
export function subscribeToQuarterData(quarterKey, onUpdateCallback) {
    // 1. Matikan listener lama jika ada
    if (activeListener) {
        activeListener();
        activeListener = null;
    }

    // Generation counter — callbacks dari subscription lama diabaikan
    const generation = ++listenerGeneration;

    if (!navigator.onLine) {
        showToastNotification("Tiada sambungan internet.", "danger");
    }

    const currentQuarterNum = parseInt(quarterKey.replace('q', ''));
    let previousQuarterKey = null;
    if (currentQuarterNum > 1) {
        previousQuarterKey = `q${currentQuarterNum - 1}`;
    }

    // Dynamic Path based on YEAR using safe ID
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;

    // Fetch previous quarter once (for trend). A failure here must NOT block the
    // main listener — fall back to "no previous data" so trends are simply absent.
    const prevQuarterPromise = previousQuarterKey
        ? db.collection(basePath).doc(previousQuarterKey).get().catch(() => null)
        : Promise.resolve(null);

    prevQuarterPromise.then(prevSnap => {
        // Abaikan jika subscription baru sudah dilancarkan
        if (generation !== listenerGeneration) return;

        const previousData = (prevSnap && prevSnap.exists) ? prevSnap.data() : null;

        // 2. Start Real-time Listener
        const docRef = db.collection(basePath).doc(quarterKey);

        activeListener = docRef.onSnapshot((docSnap) => {
            // Abaikan callback dari subscription lama
            if (generation !== listenerGeneration) return;

            hideLoading();

            if (docSnap.exists) {
                const currentData = docSnap.data();

                // Update Cache
                kpiDataCache[quarterKey] = currentData;
                if (previousData && previousQuarterKey) {
                    kpiDataCache[previousQuarterKey] = previousData;
                }

                // Callback to UI (false = not empty)
                onUpdateCallback(currentData, previousData, false);
            } else {
                console.log(`Dokumen untuk ${selectedYear} ${quarterKey} tidak dijumpai.`);
                // Return flag empty untuk handle UI
                onUpdateCallback(null, null, true);
            }
        }, (error) => {
            if (generation !== listenerGeneration) return;
            console.error("Ralat Sync:", error);
            hideLoading();
            const msg = error.code === 'permission-denied'
                ? "Tiada kebenaran membaca data."
                : "Gagal memuatkan data. Semak sambungan internet.";
            showToastNotification(msg, "danger");
            // Tell the UI to render an error/retry state instead of leaving skeletons.
            onUpdateCallback(null, null, false, error);
        });

    }).catch(error => {
        if (generation !== listenerGeneration) return;
        console.error("Ralat sync:", error);
        hideLoading();
        showToastNotification("Gagal memuatkan data. Semak sambungan internet.", "danger");
        onUpdateCallback(null, null, false, error);
    });
}

// Fungsi untuk Charts.js (Fetch Once)
export async function getKpiDataFromFirestore(quarterKey) {
    if (kpiDataCache[quarterKey]) {
        return kpiDataCache[quarterKey];
    }

    try {
        const docRef = db.collection(`artifacts/${getAppId()}/public/data/kpi-${selectedYear}`).doc(quarterKey);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            const data = docSnap.data();
            kpiDataCache[quarterKey] = data;
            return data;
        } else {
            return { placeholder: true };
        }
    } catch (error) {
        console.error("Ralat get data:", error);
        return { placeholder: true };
    }
}

// --- WRITE PLUMBING -------------------------------------------------------
//
// Every writer below rewrites the WHOLE `kpis` array of a quarter document.
// With a plain WriteBatch the document was read, mutated in memory and written
// back with no check that it hadn't changed in between — so two admins (or two
// tabs, or a phone and a laptop) editing DIFFERENT KPIs in the same quarter
// silently clobbered each other, and BOTH saw "Berjaya!". A transaction re-reads
// under a snapshot and retries on contention, so the loser can never overwrite
// the winner.

// Firestore transactions need a live connection — unlike a queued batch write
// they cannot settle from the offline cache. Fail fast with a clear message
// rather than leaving the blocking overlay up until the network returns.
function assertOnline() {
    if (navigator.onLine) return true;
    showToastNotification("Tiada sambungan internet. Perubahan tidak disimpan.", "danger");
    return false;
}

// Read-modify-write across several quarter docs, atomically.
//
// `mutate(data, quarterNum)` receives the document data and should mutate
// `data.kpis` in place; return false to leave that quarter untouched.
//
// Firestore requires every read to precede every write inside the callback, and
// may re-run the callback on contention — so `mutate` must not touch anything
// outside the `data` object it is handed (no toasts, no DOM, no shared state).
async function runQuarterTransaction(quarterNums, mutate) {
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    return db.runTransaction(async (t) => {
        const refs = quarterNums.map(n => db.collection(basePath).doc(`q${n}`));
        const snaps = await Promise.all(refs.map(ref => t.get(ref)));   // ALL reads first

        const pending = [];
        snaps.forEach((snap, i) => {
            if (!snap.exists) return;
            const data = snap.data();
            if (mutate(data, quarterNums[i], snap) === false) return;
            pending.push([refs[i], data]);
        });

        pending.forEach(([ref, data]) =>
            t.update(ref, { kpis: data.kpis, footerDate: nowFooterDate() }));
    });
}

const quartersFrom = (startQuarterNum) => {
    const out = [];
    for (let i = startQuarterNum; i <= 4; i++) out.push(i);
    return out;
};
const ALL_QUARTERS = [1, 2, 3, 4];

// --- CRUD FUNCTIONS (ADMIN) ---

// 1. ADD NEW KPI (To all 4 quarters of selected year)
export async function addNewKpi(kpiData) {
    if (!isEditMode) return;

    if (!navigator.onLine) {
        showToastNotification("Tiada sambungan internet.", "danger");
        return;
    }

    showLoading("Menambah KPI...");
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const DUPLICATE = 'kpi/duplicate-name';

    try {
        await db.runTransaction(async (t) => {
            const refs = ALL_QUARTERS.map(i => db.collection(basePath).doc(`q${i}`));
            const snaps = await Promise.all(refs.map(ref => t.get(ref)));   // ALL reads first
            const pending = [];

            for (let i = 1; i <= 4; i++) {
                const doc = snaps[i - 1];

                let currentKpis = [];
                let title = "";
                let subtitle = "";

                if (i === 1) { title = "Suku Pertama"; subtitle = `Januari - Mac ${selectedYear}`; }
                if (i === 2) { title = "Suku Kedua"; subtitle = `April - Jun ${selectedYear}`; }
                if (i === 3) { title = "Suku Ketiga"; subtitle = `Julai - September ${selectedYear}`; }
                if (i === 4) { title = "Suku Keempat"; subtitle = `Oktober - Disember ${selectedYear}`; }

                if (doc.exists) {
                    const data = doc.data();
                    currentKpis = data.kpis || [];
                    if (data.title) title = data.title;
                    if (data.subtitle) subtitle = data.subtitle;
                }

                // Semak duplikat pada suku pertama sahaja
                if (i === 1 && currentKpis.some(k => k.name.toLowerCase() === kpiData.name.toLowerCase())) {
                    const dup = new Error('Duplicate KPI name');
                    dup.code = DUPLICATE;
                    throw dup;   // aborts the transaction — nothing is written
                }

                // Push new KPI
                currentKpis.push(kpiData);

                pending.push([refs[i - 1], {
                    title: title,
                    subtitle: subtitle,
                    kpis: currentKpis,
                    footerDate: nowFooterDate()
                }]);
            }

            pending.forEach(([ref, payload]) => t.set(ref, payload, { merge: true }));
        });

        await writeAuditLog('ADD_KPI', { name: kpiData.name, id: kpiData.id });
        showToastNotification("KPI berjaya ditambah!", "success");

    } catch (e) {
        if (e && e.code === DUPLICATE) {
            showToastNotification(`KPI "${kpiData.name}" sudah wujud.`, "danger");
            return;
        }
        console.error("Error adding KPI:", e);
        if (e.code === 'permission-denied') {
            showToastNotification("GAGAL: Tiada kebenaran. Pastikan anda Login.", "danger");
        } else {
            showToastNotification("Gagal menambah KPI. Sila cuba lagi.", "danger");
        }
    } finally {
        hideLoading();
    }
}

// 2. EDIT KPI STRUCTURE (Name/Target)
export async function updateKpiStructure(kpiId, newName, newTarget) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    showLoading("Mengemaskini Struktur...");

    try {
        await runQuarterTransaction(ALL_QUARTERS, (data) => {
            data.kpis = data.kpis.map(k => {
                if (k.id === kpiId) {
                    let finalTarget = parseFloat(newTarget);
                    // If KPI has a checklist, ignore manual target and use list length
                    if (k.details && Array.isArray(k.details.targetList) && k.details.targetList.length > 0) {
                        finalTarget = k.details.targetList.length;
                    }
                    return { ...k, name: newName, target: finalTarget };
                }
                return k;
            });
        });
        await writeAuditLog('EDIT_KPI_STRUCTURE', { kpiId, newName, newTarget });
        showToastNotification("Struktur KPI dikemaskini!", "success");
    } catch (e) {
        console.error(e);
        if (e.code === 'permission-denied') {
            showToastNotification("AKSES DITOLAK.", "danger");
        } else {
            showToastNotification("Gagal kemaskini.", "danger");
        }
    } finally {
        hideLoading();
    }
}

// 3. DELETE KPI
// 3. DELETE KPI
export function deleteKpi(kpiId) {
    if (!isEditMode) return;

    showConfirmModal(
        "Padam KPI?",
        "Adakah anda pasti mahu memadam KPI ini dari SEMUA suku tahun? Tindakan ini tidak boleh diundur.",
        async () => {
            if (!assertOnline()) return;
            showLoading("Memadam KPI...");

            try {
                await runQuarterTransaction(ALL_QUARTERS, (data) => {
                    data.kpis = data.kpis.filter(k => k.id !== kpiId);
                });
                await writeAuditLog('DELETE_KPI', { kpiId });
                showToastNotification("KPI berjaya dipadam.", "success");
            } catch (e) {
                console.error(e);
                if (e.code === 'permission-denied') {
                    showToastNotification("AKSES DITOLAK.", "danger");
                } else {
                    showToastNotification("Gagal memadam.", "danger");
                }
            } finally {
                hideLoading();
            }
        }
    );
}

// 4. CLONE FROM PREVIOUS YEAR
export async function cloneFromYear(sourceYear) {
    if (!isEditMode) return;
    showLoading(`Menyalin data dari ${sourceYear}...`);
    const batch = db.batch();
    const sourcePath = `artifacts/${getAppId()}/public/data/kpi-${sourceYear}`;
    const targetPath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;

    try {
        for (let i = 1; i <= 4; i++) {
            const qKey = `q${i}`;
            const sourceDoc = await db.collection(sourcePath).doc(qKey).get();

            if (sourceDoc.exists) {
                const data = sourceDoc.data();
                // Reset values to 0 for new year
                // Helper to reset item values recursively
                const resetItemValues = (items) => {
                    return items.map(item => {
                        const newItem = { ...item, value: 0 };
                        if (item.subItems && Array.isArray(item.subItems)) {
                            newItem.subItems = resetItemValues(item.subItems);
                        }
                        return newItem;
                    });
                };

                const cleanKpis = data.kpis.map(k => ({
                    ...k,
                    value: 0,
                    details: k.details ? {
                        ...k.details,
                        items: k.details.items ? resetItemValues(k.details.items) : [],
                        achieved: []
                    } : null
                }));

                const targetDocRef = db.collection(targetPath).doc(qKey);

                let title = `Suku ${i}`;
                let subtitle = `(${selectedYear})`;
                if (i === 1) { title = "Suku Pertama"; subtitle = `(Januari - Mac ${selectedYear})`; }
                if (i === 2) { title = "Suku Kedua"; subtitle = `(April - Jun ${selectedYear})`; }
                if (i === 3) { title = "Suku Ketiga"; subtitle = `(Julai - September ${selectedYear})`; }
                if (i === 4) { title = "Suku Keempat"; subtitle = `(Oktober - Disember ${selectedYear})`; }

                batch.set(targetDocRef, {
                    title: title,
                    subtitle: subtitle,
                    kpis: cleanKpis,
                    footerDate: nowFooterDate()
                });
            }
        }
        await batch.commit();
        await writeAuditLog('CLONE_YEAR', { sourceYear, targetYear: selectedYear });
        showToastNotification(`Berjaya menyalin struktur dari ${sourceYear}!`, "success");
    } catch (e) {
        console.error(e);
        if (e.code === 'permission-denied') {
            showToastNotification("AKSES DITOLAK: Admin sahaja.", "danger");
        } else {
            showToastNotification("Gagal menyalin data.", "danger");
        }
    } finally {
        hideLoading();
    }
}

// --- STANDARD UPDATE FUNCTIONS ---

export async function saveBulkKpiValues(kpiId, valuesObj) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    showLoading("Menyimpan nilai semua suku...");
    try {
        await runQuarterTransaction(ALL_QUARTERS, (data, qNum) => {
            const qKey = `q${qNum}`;
            if (valuesObj[qKey] === undefined) return false;
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) return false;
            data.kpis[kpiIndex].value = valuesObj[qKey];
        });
        await writeAuditLog('BULK_UPDATE_VALUES', { kpiId, values: valuesObj });
        showToastNotification('Nilai semua suku dikemaskini!', 'success');
    } catch (e) {
        console.error(e);
        showToastNotification("Ralat simpan nilai bulk.", "danger");
    } finally {
        hideLoading();
    }
}

export async function updateKpiValueInFirestore(quarterKey, kpiId, newValue, bulan = null) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    const stamp = new Date().toISOString();   // hoisted: the tx callback may re-run

    showLoading("Menyimpan...");
    try {
        await runQuarterTransaction(quartersFrom(startQuarterNum), (data, qNum) => {
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) return false;
            data.kpis[kpiIndex].value = newValue;
            data.kpis[kpiIndex].updatedAt = stamp;
            // bulan hanya disimpan untuk suku yang diedit, bukan propagate
            if (qNum === startQuarterNum && bulan !== null) {
                data.kpis[kpiIndex].bulan = bulan;
            }
        });
        await writeAuditLog('UPDATE_VALUE', { kpiId, quarterKey, newValue, bulan });
        showToastNotification('Nilai dikemaskini!', 'success');
    } catch (e) {
        console.error(e);
        showToastNotification("Ralat simpan.", "danger");
    } finally {
        hideLoading();
    }
}

export async function updateKpiDescriptionInFirestore(kpiId, text) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    showLoading("Menyimpan...");
    try {
        await runQuarterTransaction(ALL_QUARTERS, (data) => {
            const idx = data.kpis.findIndex(k => k.id === kpiId);
            if (idx === -1) return false;
            data.kpis[idx].description = text;
        });
        touchLastUpdated();
        showToastNotification('Deskripsi disimpan!', 'success');
    } catch (e) {
        console.error(e);
        showToastNotification("Ralat simpan.", "danger");
    } finally {
        hideLoading();
    }
}

export async function updateKpiDetailsList(quarterKey, kpiId, itemName, isChecked) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    showLoading("Menyimpan...");
    try {
        await runQuarterTransaction(quartersFrom(startQuarterNum), (data) => {
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) return false;
            const achieved = data.kpis[kpiIndex].details.achieved || [];
            const idx = achieved.indexOf(itemName);
            if (isChecked) { if (idx === -1) achieved.push(itemName); }
            else { if (idx > -1) achieved.splice(idx, 1); }
            data.kpis[kpiIndex].details.achieved = achieved;

            // SYNC VALUE WITH ACHIEVED COUNT
            if (data.kpis[kpiIndex].details.targetList) {
                data.kpis[kpiIndex].value = achieved.length;
            }
        });
        touchLastUpdated();
        showToastNotification('Status dikemaskini!', 'success');
    } catch (e) {
        console.error(e);
        showToastNotification("Ralat simpan.", "danger");
    } finally {
        hideLoading();
    }
}

export async function updateKpiTargetListItem(quarterKey, kpiId, payload, action) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    showLoading("Menyimpan...");
    try {
        await runQuarterTransaction(quartersFrom(startQuarterNum), (data) => {
            const idx = data.kpis.findIndex(k => k.id === kpiId);
            if (idx === -1) return false;

            const kpi = data.kpis[idx];
            if (!kpi.details) return false;

            const targetList = kpi.details.targetList || [];
            const achieved = kpi.details.achieved || [];

            // Apply the SAME operation to THIS quarter's own lists.
            //
            // The old code copied the start quarter's targetList over every later
            // quarter wholesale (`targetList = [...sourceList]`) and then filtered
            // that quarter's `achieved` against it. Any checklist item that existed
            // only in Q3/Q4 — added directly at that quarter — was therefore
            // silently deleted, together with its achievement record, just because
            // the admin edited an unrelated item back in Q1.
            //
            // Applying the operation per quarter keeps each quarter's own items
            // intact. When the lists are already in sync (the normal case) the
            // result is byte-identical to the old behaviour.
            if (action === 'add') {
                if (!targetList.includes(payload)) targetList.push(payload);
            } else if (action === 'delete') {
                const t = targetList.indexOf(payload); if (t > -1) targetList.splice(t, 1);
                const a = achieved.indexOf(payload); if (a > -1) achieved.splice(a, 1);
            } else if (action === 'edit') {
                const t = targetList.indexOf(payload.oldName); if (t > -1) targetList[t] = payload.newName;
                const a = achieved.indexOf(payload.oldName); if (a > -1) achieved[a] = payload.newName;
            }

            kpi.details.targetList = targetList;
            kpi.details.achieved = achieved;
            if (Array.isArray(targetList)) kpi.target = targetList.length;

            // Keep the displayed count in step with the checklist — the same
            // formula updateKpiDetailsList already uses. Previously only the LATER
            // quarters got this, so deleting an achieved item left the quarter you
            // were actually editing showing a count one too high.
            if (kpi.details.targetList) kpi.value = achieved.length;
        });
        touchLastUpdated();
        showToastNotification('Senarai dikemaskini!', 'success');
        const btn = document.querySelector(`.show-details-btn[data-kpi-id="${kpiId}"]`);
        closeModal(document.getElementById('details-modal'));
        showDetailsModal(kpiId, btn);
    } catch (e) {
        console.error(e);
        showToastNotification("Ralat simpan.", "danger");
    } finally {
        hideLoading();
    }
}

export async function updateKpiBreakdownList(quarterKey, kpiId, payload, action) {
    if (!isEditMode) return;
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    const NOT_FOUND = 'kpi/item-not-found';
    if (!assertOnline()) return;
    showLoading("Menyimpan...");
    try {
        // breakdownList items are cumulative (an item added at Qn propagates Qn..Q4),
        // but items starting at different quarters mean each quarter's `items` array can
        // have a DIFFERENT order/length. So a fixed numeric index is only valid for the
        // start quarter. For delete/edit we capture the target item's identity from the
        // start quarter, then re-locate it by identity in every quarter Qn..Q4.
        // Identity match. When BOTH items carry a stable `id` (new Penjanaan
        // records), match purely by id — bulletproof even for look-alike rows.
        // Otherwise fall back to name+value+bulan (legacy items / other KPIs).
        const sameItem = (a, b) => {
            if (!a || !b) return false;
            if (a.id != null && a.id !== '' && b.id != null && b.id !== '') {
                return String(a.id) === String(b.id);
            }
            return a.name === b.name &&
                Number(a.value) === Number(b.value) &&
                String(a.bulan ?? '') === String(b.bulan ?? '');
        };

        // Everything below runs inside ONE transaction: the identity lookup on the
        // start quarter and the propagated writes now share a single consistent
        // snapshot, so the item can't shift underneath us between read and write.
        const quarterNums = quartersFrom(startQuarterNum);
        await db.runTransaction(async (t) => {
            const refs = quarterNums.map(n => db.collection(basePath).doc(`q${n}`));
            const snaps = await Promise.all(refs.map(ref => t.get(ref)));   // ALL reads first

            let targetIdentity = null;
            if (action === 'delete' || action === 'edit') {
                const startDoc = snaps[0];   // quarterNums[0] === startQuarterNum
                if (startDoc.exists) {
                    const ki = startDoc.data().kpis.findIndex(k => k.id === kpiId);
                    if (ki !== -1) {
                        const startItems = startDoc.data().kpis[ki].details.items || [];
                        const targetIndex = action === 'delete' ? payload : payload.index;
                        targetIdentity = startItems[targetIndex] || null;
                    }
                }
                if (!targetIdentity) {
                    const missing = new Error('Item not found');
                    missing.code = NOT_FOUND;
                    throw missing;   // aborts the transaction — nothing is written
                }
            }

            const pending = [];
            snaps.forEach((doc, n) => {
                if (!doc.exists) return;
                const data = doc.data();
                const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
                if (kpiIndex === -1) return;
                const items = data.kpis[kpiIndex].details.items || [];
                if (action === 'add') {
                    const isDup = payload.bulan != null
                        ? items.some(it => it.name === payload.name && String(it.bulan ?? '') === String(payload.bulan ?? ''))
                        : items.some(it => it.name === payload.name);
                    if (!isDup) items.push(payload);
                } else if (action === 'delete') {
                    const idx = items.findIndex(it => sameItem(it, targetIdentity));
                    if (idx !== -1) items.splice(idx, 1);
                } else if (action === 'edit') {
                    const idx = items.findIndex(it => sameItem(it, targetIdentity));
                    if (idx !== -1) items[idx] = payload.data;
                }
                data.kpis[kpiIndex].details.items = items;
                pending.push([refs[n], data]);
            });

            pending.forEach(([ref, data]) =>
                t.update(ref, { kpis: data.kpis, footerDate: nowFooterDate() }));
        });
        touchLastUpdated();
        showToastNotification('Butiran dikemaskini!', 'success');
        const btn = document.querySelector(`.show-details-btn[data-kpi-id="${kpiId}"]`);
        closeModal(document.getElementById('details-modal'));
        showDetailsModal(kpiId, btn);
    } catch (e) {
        if (e && e.code === NOT_FOUND) {
            showToastNotification("Item tidak dijumpai.", "danger");
            return;
        }
        console.error(e);
        showToastNotification("Ralat simpan.", "danger");
    } finally {
        hideLoading();
    }
}

export async function updateKpiProgressListItem(quarterKey, kpiId, itemName, subItemName, newValue) {
    if (!isEditMode) return;
    if (!assertOnline()) return;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    showLoading("Menyimpan...");
    try {
        await runQuarterTransaction(quartersFrom(startQuarterNum), (data) => {
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) return false;
            const itemIndex = data.kpis[kpiIndex].details.items.findIndex(i => i.name === itemName);
            if (itemIndex === -1) return false;
            if (subItemName) {
                const subItems = data.kpis[kpiIndex].details.items[itemIndex].subItems;
                const subIdx = subItems ? subItems.findIndex(si => si.name === subItemName) : -1;
                if (subIdx > -1) subItems[subIdx].value = newValue;
            } else {
                data.kpis[kpiIndex].details.items[itemIndex].value = newValue;
            }

            // Recalculate Main Value (Weighted Average)
            const kpi = data.kpis[kpiIndex];
            if (kpi.details && kpi.details.items) {
                let totalScore = 0;
                let totalItems = kpi.details.items.length;

                kpi.details.items.forEach(item => {
                    let itemScore = 0;
                    if (item.subItems && item.subItems.length > 0) {
                        const subTotal = item.subItems.reduce((acc, sub) => acc + sub.value, 0);
                        // Average of sub-items represents this item's completion
                        itemScore = subTotal / item.subItems.length;
                    } else {
                        itemScore = item.value;
                    }
                    totalScore += itemScore;
                });

                // If the main KPI is "Penerbitan" (Percentage based), the Value IS the average percentage
                if (kpi.isPercentage) {
                    kpi.value = totalScore / totalItems;
                }
            }
        });
        touchLastUpdated();
        showToastNotification('Progres dikemaskini!', 'success');
        const btn = document.querySelector(`.show-details-btn[data-kpi-id="${kpiId}"]`);
        closeModal(document.getElementById('details-modal'));
        showDetailsModal(kpiId, btn);
    } catch (e) {
        console.error(e);
        showToastNotification("Ralat simpan.", "danger");
    } finally {
        hideLoading();
    }
}

// =====================================================================
// TAKWIM (CALENDAR / ACTIVITY) FUNCTIONS
// Path: artifacts/{appId}/public/data/takwim-{year}, single doc "main"
// Doc shape: { events: [{ id, title, date, location, notes, createdAt }] }
// =====================================================================

const takwimDocRef = (year) =>
    db.collection(`artifacts/${getAppId()}/public/data/takwim-${year}`).doc('main');

export function subscribeTakwim(year, callback) {
    try {
        return takwimDocRef(year).onSnapshot((docSnap) => {
            const events = (docSnap.exists && Array.isArray(docSnap.data().events))
                ? docSnap.data().events
                : [];
            callback(events);
        }, (error) => {
            console.error("Ralat sync takwim:", error);
            if (error.code !== 'permission-denied') {
                showToastNotification("Terputus hubungan dengan server.", "danger");
            }
            callback([]);
        });
    } catch (e) {
        console.error("subscribeTakwim error:", e);
        callback([]);
        return () => {};
    }
}

export async function addTakwimEvent(year, eventData) {
    if (!isEditMode) return;
    if (!navigator.onLine) {
        showToastNotification("Tiada sambungan internet.", "danger");
        return;
    }
    showLoading("Menambah aktiviti...");
    try {
        const ref = takwimDocRef(year);
        const doc = await ref.get();
        const events = (doc.exists && Array.isArray(doc.data().events)) ? doc.data().events : [];
        const newEvent = {
            id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            title: eventData.title || '',
            date: eventData.date || '',
            dateTo: eventData.dateTo || '',
            location: eventData.location || '',
            notes: eventData.notes || '',
            createdAt: new Date().toISOString()
        };
        events.push(newEvent);
        await ref.set({ events }, { merge: true });
        await writeAuditLog('ADD_TAKWIM', { year, title: newEvent.title });
        showToastNotification("Aktiviti berjaya ditambah!", "success");
    } catch (e) {
        console.error("addTakwimEvent error:", e);
        if (e.code === 'permission-denied') {
            showToastNotification("AKSES DITOLAK: Admin sahaja.", "danger");
        } else {
            showToastNotification("Gagal menambah aktiviti.", "danger");
        }
    } finally {
        hideLoading();
    }
}

export async function updateTakwimEvent(year, eventId, updatedData) {
    if (!isEditMode) return;
    if (!navigator.onLine) {
        showToastNotification("Tiada sambungan internet.", "danger");
        return;
    }
    showLoading("Mengemaskini aktiviti...");
    try {
        const ref = takwimDocRef(year);
        const doc = await ref.get();
        if (!doc.exists) throw new Error("Takwim tidak dijumpai");
        const events = Array.isArray(doc.data().events) ? doc.data().events : [];
        const idx = events.findIndex(ev => ev.id === eventId);
        if (idx === -1) throw new Error("Aktiviti tidak dijumpai");
        events[idx] = {
            ...events[idx],
            title: updatedData.title !== undefined ? updatedData.title : events[idx].title,
            date: updatedData.date !== undefined ? updatedData.date : events[idx].date,
            dateTo: updatedData.dateTo !== undefined ? updatedData.dateTo : (events[idx].dateTo || ''),
            location: updatedData.location !== undefined ? updatedData.location : events[idx].location,
            notes: updatedData.notes !== undefined ? updatedData.notes : events[idx].notes
        };
        await ref.update({ events });
        await writeAuditLog('EDIT_TAKWIM', { year, eventId });
        showToastNotification("Aktiviti dikemaskini!", "success");
    } catch (e) {
        console.error("updateTakwimEvent error:", e);
        if (e.code === 'permission-denied') {
            showToastNotification("AKSES DITOLAK: Admin sahaja.", "danger");
        } else {
            showToastNotification("Gagal mengemaskini aktiviti.", "danger");
        }
    } finally {
        hideLoading();
    }
}

export async function deleteTakwimEvent(year, eventId) {
    if (!isEditMode) return;
    if (!navigator.onLine) {
        showToastNotification("Tiada sambungan internet.", "danger");
        return;
    }
    showLoading("Memadam aktiviti...");
    try {
        const ref = takwimDocRef(year);
        const doc = await ref.get();
        if (!doc.exists) throw new Error("Takwim tidak dijumpai");
        const events = (Array.isArray(doc.data().events) ? doc.data().events : [])
            .filter(ev => ev.id !== eventId);
        await ref.update({ events });
        await writeAuditLog('DELETE_TAKWIM', { year, eventId });
        showToastNotification("Aktiviti dipadam.", "success");
    } catch (e) {
        console.error("deleteTakwimEvent error:", e);
        if (e.code === 'permission-denied') {
            showToastNotification("AKSES DITOLAK: Admin sahaja.", "danger");
        } else {
            showToastNotification("Gagal memadam aktiviti.", "danger");
        }
    } finally {
        hideLoading();
    }
}

// =====================================================================
// PENJANAAN (FUNDRAISING) HELPERS
// Reads the "pendanaan" KPI's details.items from the kpi-{year} collection.
// =====================================================================

export async function getPendanaanItemsForQuarter(year, quarterKey) {
    try {
        const docRef = db.collection(`artifacts/${getAppId()}/public/data/kpi-${year}`).doc(quarterKey);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return [];
        const data = docSnap.data();
        const kpi = (data.kpis || []).find(k => k.id === 'pendanaan');
        if (!kpi || !kpi.details || !Array.isArray(kpi.details.items)) return [];
        return kpi.details.items;
    } catch (e) {
        console.error("getPendanaanItemsForQuarter error:", e);
        return [];
    }
}

export async function getAllPendanaanItems(year) {
    return getPendanaanItemsForQuarter(year, 'q4');
}

export async function getPendanaanKpiTarget(year) {
    try {
        const docRef = db.collection(`artifacts/${getAppId()}/public/data/kpi-${year}`).doc('q4');
        const docSnap = await docRef.get();
        if (!docSnap.exists) return 0;
        const kpi = (docSnap.data().kpis || []).find(k => k.id === 'pendanaan');
        return (kpi && typeof kpi.target === 'number') ? kpi.target : 0;
    } catch (e) {
        console.error("getPendanaanKpiTarget error:", e);
        return 0;
    }
}