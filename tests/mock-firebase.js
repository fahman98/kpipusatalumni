// --- TESTS/MOCK-FIREBASE.JS ---
// Stands in for the Firebase SDK (firebase-app.js) during browser tests, so
// the app runs against sample data and NOTHING reaches the live Firestore.
// Every write is recorded on window for the tests to inspect:
//   window.__writes   batch.set paths (clone / reset)
//   window.__tx       transaction writes [{ k: 'kpi-2026/q1', d: {...} }]
//   window.__audit    audit-log entries added
//   window.__persist  auth.setPersistence() calls
// Flags read at load (set with page.addInitScript):
//   window.__ADMIN    sign in as the admin instead of an anonymous guest
//   window.__WITH2025 also seed kpi-2025 (default: only 2026 has data)
// signOut() leaves a sessionStorage marker so the reload after a logout comes
// back as a guest even when __ADMIN is set.
(function () {
    const mk = (id, name, icon, target, value, extra = {}) => Object.assign(
        { id, name, icon, target, value, description: 'Penerangan ringkas KPI ' + name, updatedAt: '2026-10-15T09:00:00Z' },
        extra);

    // Cumulative values per quarter, like the real data
    function kpis(q) {
        const f = q / 4;
        return [
            mk('pendaftaran', 'Pendaftaran Alumni Baharu', 'fa-users', 5000, Math.round(4600 * f + 300)),
            mk('program', 'Program Libat Sama Alumni', 'fa-handshake', 24, Math.round(20 * f)),
            mk('pendanaan', 'Penjanaan Dana Alumni (RM)', 'fa-money', 150000, undefined, {
                isCurrency: true,
                details: { type: 'breakdownList', items: [
                    { name: 'Sumbangan Majlis Makan Malam Alumni', value: 42000, bulan: 2 },
                    { name: 'Tajaan Syarikat XYZ Sdn Bhd', value: 15000, bulan: 5 },
                    { name: 'Jualan Cenderamata Konvokesyen', value: 8800, bulan: 10 },
                    { name: 'Kutipan Dana Endowmen', value: 12500, bulan: 7 }
                ].slice(0, q) }
            }),
            mk('kepuasan', 'Indeks Kepuasan Alumni', 'fa-star', 100, 82 * Math.min(1, f + 0.3), { isPercentage: true }),
            mk('kembara', 'Kembara Alumni', 'fa-globe', 8, undefined, {
                details: { type: 'breakdownList', items: [
                    { name: 'Kembara Alumni Sabah', value: 1, tarikh: '2026-03-14', hadir: 120 },
                    { name: 'Kembara Alumni Johor', value: 1, tarikh: '2026-06-20', tarikhTamat: '2026-06-21', hadir: 85 }
                ].slice(0, Math.min(q, 2)) }
            }),
            mk('hebahan', 'Hebahan Media Sosial', 'fa-megaphone', 200, Math.round(210 * f)),
        ];
    }

    const TS = (iso) => ({ toDate: () => new Date(iso) });
    const SEED_AUDIT = [
        { id: 'a1', timestamp: TS('2026-10-29T09:15:00'), user: 'alumni@upsi.edu.my', action: 'UPDATE_VALUE', year: '2026', details: { kpiId: 'pendaftaran', quarterKey: 'q4', oldValue: 4600, newValue: 4900, bulan: 10 } },
        { id: 'a2', timestamp: TS('2026-10-29T09:10:00'), user: 'alumni@upsi.edu.my', action: 'UPDATE_BREAKDOWN_ITEM', year: '2026', details: { kpiId: 'pendanaan', quarterKey: 'q3', action: 'delete', deleted: { name: 'Tajaan Syarikat ABC', value: 5000, bulan: 8 } } },
        { id: 'a3', timestamp: TS('2026-10-29T09:05:00'), user: 'alumni@upsi.edu.my', action: 'DELETE_TAKWIM', year: '2026', details: { year: '2026', eventId: 'e9', deleted: { id: 'e9', title: 'Bengkel Alumni', date: '2026-11-02', location: 'Bilik Mesyuarat', status: '', notes: '' } } },
        { id: 'a4', timestamp: TS('2026-10-29T09:00:00'), user: 'alumni@upsi.edu.my', action: 'UPDATE_BREAKDOWN_ITEM', year: '2026', details: { kpiId: 'pendanaan', quarterKey: 'q2', action: 'edit', before: { name: 'Tajaan XYZ', value: 15000, bulan: 5 }, after: { name: 'Tajaan Syarikat XYZ Sdn Bhd', value: 15000, bulan: 5 } } },
        { id: 'a5', timestamp: TS('2026-10-20T14:00:00'), user: 'alumni@upsi.edu.my', action: 'DELETE_KPI', year: '2026', details: { kpiId: 'kpi-171' } },
        { id: 'a6', timestamp: TS('2026-01-03T10:00:00'), user: 'alumni@upsi.edu.my', action: 'CLONE_YEAR', year: '2026', details: { sourceYear: '2025' } },
    ];
    for (let i = 0; i < 30; i++) {
        SEED_AUDIT.push({ id: 'b' + i, timestamp: TS('2026-09-01T10:00:00'), user: 'alumni@upsi.edu.my', action: 'ADD_TAKWIM', year: '2026', details: { year: '2026', title: 'Aktiviti lama ' + (i + 1) } });
    }

    const DATA = {};
    for (const q of [1, 2, 3, 4]) DATA['kpi-2026/q' + q] = { kpis: kpis(q), footerDate: '15 Oktober 2026' };
    if (window.__WITH2025) {
        for (const q of [1, 2, 3, 4]) DATA['kpi-2025/q' + q] = { kpis: kpis(q).slice(0, 3), footerDate: '20 Disember 2025' };
    }
    // Takwim mixes legacy events (status word inside notes) and new ones
    DATA['takwim-2026/main'] = { events: [
        { id: 'e1', title: 'Majlis Konvokesyen ke-27 UPSI', date: '2026-11-08', dateTo: '2026-11-11', location: 'Dewan Tuanku Canselor', notes: '' },
        { id: 'e2', title: 'Hari Alumni UPSI 2026', date: '2026-10-29', location: 'Kampus Sultan Azlan Shah', notes: '' },
        { id: 'e3', title: 'Kembara Alumni Sarawak (lama)', date: '2026-12-05', location: 'Kuching', notes: 'Ditangguhkan' },
        { id: 'e4', title: 'Mesyuarat Agung (lama, catatan bebas)', date: '2026-09-12', location: 'Bilik Senat', notes: 'Selesai, minit diedarkan' },
        { id: 'p1', title: 'Program Lalu 1', date: '2026-02-10', location: 'UPSI', notes: '' },
        { id: 'p2', title: 'Program Lalu 2', date: '2026-03-10', location: 'UPSI', notes: '' },
        { id: 'p3', title: 'Program Lalu 3', date: '2026-05-10', location: 'UPSI', notes: '' },
        { id: 'p4', title: 'Program Lalu 4', date: '2026-07-10', location: 'UPSI', notes: '' },
        { id: 'e5', title: 'Karnival Alumni (baru)', date: '2026-12-20', location: 'Padang UPSI', status: 'Dibatalkan', notes: 'Amaran banjir JPS' },
    ] };
    DATA['meta/2026'] = { label: '15 Oktober 2026, 10:30 PG' };

    window.__writes = [];
    window.__tx = [];
    window.__audit = [];
    window.__persist = [];

    const key = (path, id) => path.replace(/^artifacts\/[^/]+\/public\/data\//, '') + '/' + id;
    const snap = (k) => ({ exists: !!DATA[k], data: () => DATA[k], id: k });
    const docRef = (k) => ({
        _k: k,
        get: async () => snap(k),
        onSnapshot: (cb) => { setTimeout(() => cb(snap(k)), 300); return () => {}; },
        set: async () => {}, update: async () => {}
    });

    const firestore = () => ({
        collection: (p) => {
            const base = {
                doc: (id) => docRef(key(p, id)),
                add: async (d) => { window.__audit.push(JSON.parse(JSON.stringify(d))); }
            };
            if (!p.endsWith('audit-logs')) return base;
            // orderBy / limit / startAfter / get over the seeded log, newest first
            const query = (lim, after) => ({
                orderBy: () => query(lim, after),
                limit: (n) => query(n, after),
                startAfter: (d) => query(lim, d),
                get: async () => {
                    const start = after ? SEED_AUDIT.findIndex(x => x.id === after.id) + 1 : 0;
                    const page = SEED_AUDIT.slice(start, start + lim);
                    return { docs: page.map(e => ({ id: e.id, data: () => { const { id, ...rest } = e; return rest; } })) };
                }
            });
            return Object.assign(base, query(30, null));
        },
        enablePersistence: async () => {},
        runTransaction: async (fn) => fn({
            get: async (ref) => ref.get(),
            set: (ref, d) => { window.__tx.push({ k: ref._k, d: JSON.parse(JSON.stringify(d)) }); },
            update: (ref, d) => { window.__tx.push({ k: ref._k, d: JSON.parse(JSON.stringify(d)) }); }
        }),
        batch: () => {
            const pending = [];
            return { set(ref) { pending.push(ref._k); }, commit: async () => { window.__writes.push(...pending); } };
        }
    });
    firestore.FieldValue = { delete: () => null, serverTimestamp: () => null };

    const signedOut = (() => { try { return !!sessionStorage.getItem('mockSignedOut'); } catch (_) { return false; } })();
    const user = (window.__ADMIN && !signedOut)
        ? { isAnonymous: false, uid: 'adm', email: 'alumni@upsi.edu.my' }
        : { isAnonymous: true, uid: 'anon' };

    const auth = () => ({
        onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 50); return () => {}; },
        signInAnonymously: async () => ({ user }),
        signOut: async () => { try { sessionStorage.setItem('mockSignedOut', '1'); } catch (_) {} },
        // Every password is wrong: lets the login form's error and lockout paths run
        signInWithEmailAndPassword: async () => {
            await new Promise(r => setTimeout(r, 300));
            const err = new Error('bad credentials');
            err.code = 'auth/invalid-credential';
            throw err;
        },
        currentUser: user,
        setPersistence: async (mode) => { window.__persist.push(mode); }
    });
    auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session' } };

    window.firebase = { initializeApp() {}, auth, firestore };
})();
