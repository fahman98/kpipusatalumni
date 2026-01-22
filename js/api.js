// --- JS/API.JS ---
import {
    isEditMode,
    showToastNotification,
    closeModal,
    showDetailsModal,
    showLoading,
    hideLoading
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

// Helper to get APP ID safely
const getAppId = () => {
    // Check if firebase config exists globally
    if (typeof appId !== 'undefined') return appId;
    // Fallback based on config.js pattern if appId variable isn't visible yet
    return "dashboard-alumni-kpi";
};

// --- FUNGSI REAL-TIME LISTENER ---
export function subscribeToQuarterData(quarterKey, onUpdateCallback) {
    // 1. Matikan listener lama jika ada
    if (activeListener) {
        activeListener();
        activeListener = null;
    }

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

    // Fetch previous quarter once (for trend)
    const prevQuarterPromise = previousQuarterKey
        ? db.collection(basePath).doc(previousQuarterKey).get()
        : Promise.resolve(null);

    prevQuarterPromise.then(prevSnap => {
        const previousData = (prevSnap && prevSnap.exists) ? prevSnap.data() : null;

        // 2. Start Real-time Listener
        const docRef = db.collection(basePath).doc(quarterKey);

        activeListener = docRef.onSnapshot((docSnap) => {
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
            console.error("Ralat Sync:", error);
            hideLoading();
            if (error.code !== 'permission-denied') {
                showToastNotification("Terputus hubungan dengan server.", "danger");
            }
        });

    }).catch(error => {
        console.error("Ralat fetch previous quarter:", error);
        hideLoading();
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

// --- CRUD FUNCTIONS (ADMIN) ---

// 1. ADD NEW KPI (To all 4 quarters of selected year)
export async function addNewKpi(kpiData) {
    if (!isEditMode) return;

    if (!navigator.onLine) {
        showToastNotification("Tiada sambungan internet.", "danger");
        return;
    }

    showLoading("Menambah KPI...");
    const batch = db.batch();
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;

    try {
        for (let i = 1; i <= 4; i++) {
            const qKey = `q${i}`;
            const docRef = db.collection(basePath).doc(qKey);
            const doc = await docRef.get();

            let currentKpis = [];
            let title = "";
            let subtitle = "";

            if (i === 1) { title = "Suku Pertama"; subtitle = `(Januari - Mac ${selectedYear})`; }
            if (i === 2) { title = "Suku Kedua"; subtitle = `(April - Jun ${selectedYear})`; }
            if (i === 3) { title = "Suku Ketiga"; subtitle = `(Julai - September ${selectedYear})`; }
            if (i === 4) { title = "Suku Keempat"; subtitle = `(Oktober - Disember ${selectedYear})`; }

            if (doc.exists) {
                const data = doc.data();
                currentKpis = data.kpis || [];
                if (data.title) title = data.title;
                if (data.subtitle) subtitle = data.subtitle;
            }

            // Push new KPI
            currentKpis.push(kpiData);

            batch.set(docRef, {
                title: title,
                subtitle: subtitle,
                kpis: currentKpis,
                footerDate: new Date().toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            }, { merge: true });
        }

        await batch.commit();
        showToastNotification("KPI berjaya ditambah!", "success");

    } catch (e) {
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
    showLoading("Mengemaskini Struktur...");
    const batch = db.batch();
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;

    try {
        for (let i = 1; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;

            const data = doc.data();
            const kpis = data.kpis.map(k => {
                if (k.id === kpiId) {
                    return { ...k, name: newName, target: parseFloat(newTarget) };
                }
                return k;
            });

            batch.update(docRef, { kpis: kpis });
        }
        await batch.commit();
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
export async function deleteKpi(kpiId) {
    if (!isEditMode) return;
    if (!confirm("Adakah anda pasti mahu memadam KPI ini dari SEMUA suku tahun?")) return;

    showLoading("Memadam KPI...");
    const batch = db.batch();
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;

    try {
        for (let i = 1; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;

            const data = doc.data();
            const filteredKpis = data.kpis.filter(k => k.id !== kpiId);

            batch.update(docRef, { kpis: filteredKpis });
        }
        await batch.commit();
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
                const cleanKpis = data.kpis.map(k => ({
                    ...k,
                    value: 0,
                    details: k.details ? {
                        ...k.details,
                        items: k.details.items ? k.details.items.map(item => ({ ...item, value: 0 })) : [],
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
                    footerDate: new Date().toLocaleDateString('ms-MY')
                });
            }
        }
        await batch.commit();
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

export async function updateKpiValueInFirestore(quarterKey, kpiId, newValue) {
    if (!isEditMode) return;
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    const batch = db.batch();

    showLoading("Menyimpan...");
    try {
        for (let i = startQuarterNum; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;
            const data = doc.data();
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex > -1) {
                data.kpis[kpiIndex].value = newValue;
                batch.update(docRef, { kpis: data.kpis });
            }
        }
        await batch.commit();
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
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const batch = db.batch();
    showLoading("Menyimpan...");
    try {
        for (let i = 1; i <= 4; i++) {
            const ref = db.collection(basePath).doc(`q${i}`);
            const doc = await ref.get();
            if (doc.exists) {
                const kpis = doc.data().kpis;
                const idx = kpis.findIndex(k => k.id === kpiId);
                if (idx > -1) {
                    kpis[idx].description = text;
                    batch.update(ref, { kpis });
                }
            }
        }
        await batch.commit();
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
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    const batch = db.batch();
    showLoading("Menyimpan...");
    try {
        for (let i = startQuarterNum; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;
            const data = doc.data();
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) continue;
            const achieved = data.kpis[kpiIndex].details.achieved || [];
            const idx = achieved.indexOf(itemName);
            if (isChecked) { if (idx === -1) achieved.push(itemName); }
            else { if (idx > -1) achieved.splice(idx, 1); }
            data.kpis[kpiIndex].details.achieved = achieved;

            // SYNC VALUE WITH ACHIEVED COUNT
            if (data.kpis[kpiIndex].details.targetList) {
                data.kpis[kpiIndex].value = achieved.length;
            }

            batch.update(docRef, { kpis: data.kpis });
        }
        await batch.commit();
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
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    const batch = db.batch();
    showLoading("Menyimpan...");
    try {
        // 1. Get Source Doc (Start Quarter)
        const sourceDocRef = db.collection(basePath).doc(`q${startQuarterNum}`);
        const sourceDoc = await sourceDocRef.get();
        if (!sourceDoc.exists) throw new Error("Source quarter not found");

        const sourceData = sourceDoc.data();
        const kpiIndex = sourceData.kpis.findIndex(k => k.id === kpiId);
        if (kpiIndex === -1) throw new Error("KPI not found in source");

        const sourceKpi = sourceData.kpis[kpiIndex];
        const targetList = sourceKpi.details.targetList || [];
        const achieved = sourceKpi.details.achieved || [];

        // 2. Apply Action to Source First
        if (action === 'add') { if (!targetList.includes(payload)) targetList.push(payload); }
        else if (action === 'delete') {
            const tIdx = targetList.indexOf(payload); if (tIdx > -1) targetList.splice(tIdx, 1);
            const aIdx = achieved.indexOf(payload); if (aIdx > -1) achieved.splice(aIdx, 1);
        }
        else if (action === 'edit') {
            const tIdx = targetList.indexOf(payload.oldName); if (tIdx > -1) targetList[tIdx] = payload.newName;
            const aIdx = achieved.indexOf(payload.oldName); if (aIdx > -1) achieved[aIdx] = payload.newName;
        }

        sourceKpi.details.targetList = targetList;
        sourceKpi.details.achieved = achieved;
        if (Array.isArray(targetList)) sourceKpi.target = targetList.length;

        batch.update(sourceDocRef, { kpis: sourceData.kpis });

        // 3. Propagate to Future Quarters (Overwrite List)
        for (let i = startQuarterNum + 1; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;

            const data = doc.data();
            const idx = data.kpis.findIndex(k => k.id === kpiId);
            if (idx === -1) continue;

            // Overwrite targetList from Source
            data.kpis[idx].details.targetList = [...targetList];

            // Sync Value/Target
            if (Array.isArray(targetList)) data.kpis[idx].target = targetList.length;

            // Handle Achieved (Rename/Cleanup)
            let qAchieved = data.kpis[idx].details.achieved || [];
            if (action === 'edit') {
                const aIdx = qAchieved.indexOf(payload.oldName);
                if (aIdx > -1) qAchieved[aIdx] = payload.newName;
            }
            // Filter achieved to ensure only valid items remain
            qAchieved = qAchieved.filter(item => targetList.includes(item));

            data.kpis[idx].details.achieved = qAchieved;

            // Sync Value Count
            if (data.kpis[idx].details.targetList) {
                data.kpis[idx].value = qAchieved.length;
            }

            batch.update(docRef, { kpis: data.kpis });
        }
        await batch.commit();
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
    const batch = db.batch();
    showLoading("Menyimpan...");
    try {
        for (let i = startQuarterNum; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;
            const data = doc.data();
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) continue;
            const items = data.kpis[kpiIndex].details.items || [];
            if (action === 'add') { if (!items.some(i => i.name === payload.name)) items.push(payload); }
            else if (action === 'delete') { items.splice(payload, 1); }
            else if (action === 'edit') { if (items[payload.index]) items[payload.index] = payload.data; }
            data.kpis[kpiIndex].details.items = items;
            batch.update(docRef, { kpis: data.kpis });
        }
        await batch.commit();
        showToastNotification('Butiran dikemaskini!', 'success');
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

export async function updateKpiProgressListItem(quarterKey, kpiId, itemName, subItemName, newValue) {
    if (!isEditMode) return;
    const basePath = `artifacts/${getAppId()}/public/data/kpi-${selectedYear}`;
    const startQuarterNum = parseInt(quarterKey.replace('q', ''), 10);
    const batch = db.batch();
    showLoading("Menyimpan...");
    try {
        for (let i = startQuarterNum; i <= 4; i++) {
            const docRef = db.collection(basePath).doc(`q${i}`);
            const doc = await docRef.get();
            if (!doc.exists) continue;
            const data = doc.data();
            const kpiIndex = data.kpis.findIndex(k => k.id === kpiId);
            if (kpiIndex === -1) continue;
            const itemIndex = data.kpis[kpiIndex].details.items.findIndex(i => i.name === itemName);
            if (itemIndex === -1) continue;
            if (subItemName) {
                const subIdx = data.kpis[kpiIndex].details.items[itemIndex].subItems.findIndex(si => si.name === subItemName);
                if (subIdx > -1) data.kpis[kpiIndex].details.items[itemIndex].subItems[subIdx].value = newValue;
            } else {
                data.kpis[kpiIndex].details.items[itemIndex].value = newValue;
            }
            batch.update(docRef, { kpis: data.kpis });
        }
        await batch.commit();
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