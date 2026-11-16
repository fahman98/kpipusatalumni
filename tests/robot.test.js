// --- TESTS/ROBOT.TEST.JS ---
// Tests apps-script/Robot.gs in Node with fake Google services: Firestore
// REST (in memory, with updateTime preconditions), DriveApp, MailApp,
// PropertiesService. Nothing real is touched.
//   node tests/robot.test.js
// Exit code 1 if any case fails.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Robot.gs'), 'utf8');
const BASE = 'https://firestore.googleapis.com/v1/projects/dashboard-alumni-kpi/databases/(default)/documents/';
const DATA = 'artifacts/dashboard-alumni-kpi/public/data/';

// ---- Fake Firestore REST ----------------------------------------------
function fakeFirestore(world) {
    const docs = world.docs;   // path -> { fields, updateTime }
    let tick = 0;
    const stamp = () => `2026-11-16T00:00:${String(++tick).padStart(2, '0')}Z`;
    const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body || {}) });
    return {
        fetch(url, opts) {
            world.requests.push({ url, method: opts.method, headers: opts.headers });
            assert.equal(opts.headers['X-Goog-User-Project'], 'dashboard-alumni-kpi');
            assert.match(opts.headers.Authorization, /^Bearer /);
            const [p, q = ''] = url.slice(BASE.length).split('?');
            const params = new URLSearchParams(q);
            if (opts.method === 'get') {
                const d = docs[p];
                return d ? resp(200, { name: p, fields: d.fields, updateTime: d.updateTime }) : resp(404, { error: { status: 'NOT_FOUND' } });
            }
            if (opts.method === 'patch') {
                if (world.beforePatch) { const f = world.beforePatch; world.beforePatch = null; f(); }
                const body = JSON.parse(opts.payload);
                const cur = docs[p];
                const want = params.get('currentDocument.updateTime');
                if (want && (!cur || cur.updateTime !== want)) return resp(400, { error: { status: 'FAILED_PRECONDITION' } });
                if (params.get('currentDocument.exists') === 'false' && cur) return resp(400, { error: { status: 'FAILED_PRECONDITION' } });
                const mask = params.getAll('updateMask.fieldPaths');
                const fields = mask.length ? Object.assign({}, cur && cur.fields) : {};
                if (mask.length) mask.forEach(k => { fields[k] = body.fields[k]; });
                else Object.assign(fields, body.fields);
                docs[p] = { fields, updateTime: stamp() };
                world.writes.push(p);
                return resp(200, { name: p, fields, updateTime: docs[p].updateTime });
            }
            if (opts.method === 'post') {
                const body = JSON.parse(opts.payload);
                const id = `${p}/auto${++tick}`;
                docs[id] = { fields: body.fields, updateTime: stamp() };
                world.writes.push(id);
                return resp(200, { name: id });
            }
            throw new Error('unexpected ' + opts.method);
        }
    };
}

// ---- Fake Drive -------------------------------------------------------
function fakeDrive(world) {
    let n = 0;
    const folders = world.folders;   // id -> { name, parent, trashed, editors: [], files: [] }
    const wrap = (id) => {
        const f = folders[id];
        return {
            getId: () => id,
            getUrl: () => `https://drive.google.com/drive/folders/${id}`,
            getName: () => f.name,
            setName: (x) => { f.name = x; world.renames.push(x); },
            isTrashed: () => !!f.trashed,
            addEditor: (e) => { f.editors.push(e); },
            createFolder: (name) => {
                const nid = 'F' + (++n);
                folders[nid] = { name, parent: id, editors: [], files: [] };
                world.created.push(name);
                return wrap(nid);
            },
            getFoldersByName: (name) => iter(Object.keys(folders).filter(k => folders[k].parent === id && folders[k].name === name).map(wrap)),
            getFiles: () => iter(f.files.map(file => ({
                getId: () => file.id, getUrl: () => `https://drive.google.com/file/d/${file.id}`,
                getName: () => file.name, isTrashed: () => !!file.trashed
            })))
        };
    };
    const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
    return {
        getFolderById: (id) => { if (!folders[id]) throw new Error('no folder ' + id); return wrap(id); },
        // test helper
        _byName: (name) => Object.keys(folders).find(k => folders[k].name === name)
    };
}

// ---- World + run ------------------------------------------------------
const fsVal = (v) => {
    // Plain JS -> REST fields, same encoding as the robot (kept separate on purpose)
    if (v === null) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } };
};
const fsPlain = (v) => {
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsPlain);
    return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsPlain(x)]));
};

function makeWorld({ programs, staf, props = {} }) {
    const world = { docs: {}, folders: { INDUK: { name: 'Tugasan Dokumen', editors: [], files: [] } },
        requests: [], writes: [], mails: [], created: [], renames: [], logs: [], today: '2026-11-16' };
    world.docs[DATA + 'tugasan/2026'] = { fields: { programs: fsVal(programs) }, updateTime: '2026-11-15T00:00:00Z' };
    world.docs[DATA + 'tugasan/staf'] = { fields: { staf: fsVal(staf) }, updateTime: '2026-11-15T00:00:00Z' };
    // A KPI document the robot must never touch
    world.docs[DATA + 'kpi-2026/q4'] = { fields: { kpis: fsVal([]) }, updateTime: '2026-11-15T00:00:00Z' };
    world.props = Object.assign({ FOLDER_INDUK_ID: 'INDUK' }, props);
    const drive = fakeDrive(world);
    const ctx = {
        console,
        Logger: { log: (m) => world.logs.push(String(m)) },
        PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => world.props[k] ?? null }) },
        Utilities: { formatDate: () => world.today },
        ScriptApp: { getOAuthToken: () => 'tok' },
        UrlFetchApp: fakeFirestore(world),
        DriveApp: drive,
        MailApp: { sendEmail: (o) => world.mails.push(o), getRemainingDailyQuota: () => 1500 }
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    world.run = () => vm.runInContext('jalankanRobot()', ctx);
    world.eval = (code) => vm.runInContext(code, ctx);
    world.programs = () => fsPlain({ mapValue: { fields: world.docs[DATA + 'tugasan/2026'].fields } }).programs;
    world.status = () => { const d = world.docs[DATA + 'tugasan/robot']; return d && fsPlain({ mapValue: { fields: d.fields } }); };
    world.audits = () => Object.keys(world.docs).filter(k => k.startsWith(DATA + 'audit-logs/')).map(k => fsPlain({ mapValue: { fields: world.docs[k].fields } }));
    world.drive = drive;
    return world;
}

const STAF = [
    { id: 'st-1', nama: 'Aminah Yusof', emel: 'aminah@upsi.edu.my' },
    { id: 'st-2', nama: 'Hafiz Rahman', emel: 'Hafiz@UPSI.edu.my' },
    { id: 'st-3', nama: 'Tiada Emel', emel: '' }
];
const PERAK = () => ({
    key: 'id:it-perak', kpiId: 'kembara', name: 'Kembara Alumni Perak', tarikh: '2026-11-28', tarikhTamat: '2026-11-29',
    tasks: [
        { id: 'tg-1', jenis: 'Kertas kerja', pic: 'st-1', tarikhAkhir: '2026-11-19', link: '', selesai: false },
        { id: 'tg-2', jenis: 'Laporan', pic: 'st-2', tarikhAkhir: '2026-12-13', link: '', selesai: false },
        { id: 'tg-3', jenis: 'Maklum balas', pic: 'st-3', tarikhAkhir: '2026-12-06', link: '', selesai: false }
    ]
});
const kpiUntouched = (w) => assert.ok(!w.writes.some(p => p.includes('/kpi-')), 'KPI documents untouched');

const cases = {
    'first run: folders, sharing, assignment emails, state saved'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        const res = w.run();
        assert.equal(res.ralat, undefined, res.ralat);
        assert.deepEqual(w.created, ['2026', '2026-11-28 Kembara Alumni Perak', 'Kertas kerja', 'Laporan', 'Maklum balas']);
        const sub = (n) => w.folders[w.drive._byName(n)];
        assert.deepEqual(sub('Kertas kerja').editors, ['aminah@upsi.edu.my']);
        assert.deepEqual(sub('Laporan').editors, ['hafiz@upsi.edu.my']);
        assert.deepEqual(sub('Maklum balas').editors, [], 'no email, no sharing');
        assert.deepEqual(w.mails.map(m => [m.to, m.subject]), [
            ['aminah@upsi.edu.my', 'Tugasan dokumen: Kertas kerja, Kembara Alumni Perak'],
            ['hafiz@upsi.edu.my', 'Tugasan dokumen: Laporan, Kembara Alumni Perak']
        ]);
        assert.match(w.mails[0].htmlBody, /Tarikh akhir<\/b><\/td><td>19\/11\/2026/);
        assert.match(w.mails[0].htmlBody, /28\/11\/2026 hingga 29\/11\/2026/);
        assert.match(w.mails[0].htmlBody, /drive\.google\.com\/drive\/folders\//);
        assert.equal(w.mails[0].name, 'Pusat Alumni UPSI');
        const p = w.programs()[0];
        assert.match(p.robot.folderUrl, /folders\/F2$/);
        assert.equal(p.tasks[0].robot.emelTugasan.emel, 'aminah@upsi.edu.my');
        assert.equal(p.tasks[0].selesai, false);
        assert.equal(p.tasks[2].robot.emelTugasan, undefined);
        assert.equal(w.status().ok, true);
        assert.deepEqual(w.audits().map(a => a.details.emel), [['tugasan aminah@upsi.edu.my', 'tugasan hafiz@upsi.edu.my']]);
        kpiUntouched(w);
    },

    'second run the same day changes nothing'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.run();
        const writes = w.writes.length, mails = w.mails.length, made = w.created.length;
        w.run();
        assert.equal(w.mails.length, mails);
        assert.equal(w.created.length, made);
        assert.deepEqual(w.writes.slice(writes), [DATA + 'tugasan/robot'], 'only the status');
    },

    'a file in the PIC folder ticks Selesai and fills the link'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.run();
        w.folders[w.drive._byName('Laporan')].files.push({ id: 'laporan-perak', name: 'Laporan.pdf' });
        w.folders[w.drive._byName('Kertas kerja')].files.push({ id: 'buang', name: 'x.pdf', trashed: true });
        w.today = '2026-11-17';
        w.run();
        const t = w.programs()[0].tasks;
        assert.equal(t[1].selesai, true);
        assert.equal(t[1].link, 'https://drive.google.com/file/d/laporan-perak');
        assert.equal(t[1].robot.selesaiAuto, true);
        assert.equal(t[0].selesai, false, 'a file in the bin does not count');
        const a = w.audits().slice(1);   // [0] = the first run's emails
        assert.equal(a.length, 1);
        assert.equal(a[0].action, 'ROBOT_TUGASAN');
        assert.equal(a[0].user, 'robot (Apps Script)');
        assert.deepEqual(a[0].details.selesai, ['Laporan, Kembara Alumni Perak']);
        kpiUntouched(w);
    },

    'reminder 3 days before the due date, once'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.run();
        w.mails.length = 0;
        w.today = '2026-11-16';   // Kertas kerja due 19/11 = 3 days, but assigned today: no reminder
        w.run();
        assert.equal(w.mails.length, 0);
        w.today = '2026-11-17';
        w.run();
        assert.deepEqual(w.mails.map(m => m.subject), ['Peringatan: Kertas kerja, Kembara Alumni Perak (tarikh akhir 19/11/2026)']);
        w.today = '2026-11-18';
        w.run();
        assert.equal(w.mails.length, 1, 'once per due date');
    },

    'late emails every 7 days, at most 4, restart when the due date moves'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.run();
        w.today = '2026-11-17'; w.run();   // reminder
        w.mails.length = 0;
        const late = () => w.mails.filter(m => m.subject.startsWith('Tugasan lewat: Kertas kerja')).length;
        const days = ['2026-11-20', '2026-11-23', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25'];
        const counts = days.map(d => { w.today = d; w.run(); return late(); });
        assert.deepEqual(counts, [1, 1, 2, 3, 4, 4, 4]);
        // Admin moves the due date: a fresh reminder / late cycle
        const progs = w.programs();
        progs[0].tasks[0].tarikhAkhir = '2026-12-27';
        w.docs[DATA + 'tugasan/2026'] = { fields: { programs: fsVal(progs) }, updateTime: '2026-12-25T01:00:00Z' };
        w.today = '2026-12-26'; w.run();
        assert.equal(w.mails.filter(m => m.subject.startsWith('Peringatan: Kertas kerja')).length, 1);
        w.today = '2026-12-28'; w.run();
        assert.equal(late(), 5);
    },

    'an admin save during the run wins; nothing emailed, retried next run'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.beforePatch = () => {   // admin saves from the dashboard mid-run
            const d = w.docs[DATA + 'tugasan/2026'];
            w.docs[DATA + 'tugasan/2026'] = { fields: d.fields, updateTime: '2026-11-16T00:00:30Z' };
        };
        const res = w.run();
        assert.match(res.ralat, /diubah semasa robot berjalan/);
        assert.equal(w.mails.length, 0);
        assert.equal(w.status().ok, false);
        assert.equal(w.programs()[0].robot, undefined, 'admin copy kept');
        w.run();
        assert.equal(w.mails.length, 2, 'next run sends them');
        assert.equal(w.status().ok, true);
    },

    'PIC changed: new PIC gets the folder and an email'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.run();
        const progs = w.programs();
        progs[0].tasks[0].pic = 'st-2';
        w.docs[DATA + 'tugasan/2026'] = { fields: { programs: fsVal(progs) }, updateTime: '2026-11-16T05:00:00Z' };
        w.mails.length = 0;
        w.run();
        assert.deepEqual(w.mails.map(m => [m.to, m.subject]), [['hafiz@upsi.edu.my', 'Tugasan dokumen: Kertas kerja, Kembara Alumni Perak']]);
        assert.deepEqual(w.folders[w.drive._byName('Kertas kerja')].editors, ['aminah@upsi.edu.my', 'hafiz@upsi.edu.my']);
    },

    'renamed programme and task kind rename their folders'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF });
        w.run();
        const progs = w.programs();
        progs[0].name = 'Kembara Santuni Alumni Perak';
        progs[0].tasks[2].jenis = 'Gambar';
        w.docs[DATA + 'tugasan/2026'] = { fields: { programs: fsVal(progs) }, updateTime: '2026-11-16T05:00:00Z' };
        w.run();
        assert.deepEqual(w.renames, ['2026-11-28 Kembara Santuni Alumni Perak', 'Gambar']);
    },

    'test mode changes nothing'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF, props: { MOD_UJI: 'ya' } });
        const res = w.run();
        assert.equal(res.ralat, undefined, res.ralat);
        assert.deepEqual(w.writes, []);
        assert.deepEqual(w.mails, []);
        assert.deepEqual(w.created, []);
        assert.ok(res.ringkasan.some(l => l.includes('[MOD UJI] Akan emel aminah@upsi.edu.my')));
    },

    'the robot refuses any path outside tugasan'() {
        const w = makeWorld({ programs: [], staf: STAF });
        assert.throws(() => w.eval(`fsPatchPrograms_('artifacts/dashboard-alumni-kpi/public/data/kpi-2026/q4', [], null)`), /tidak dibenarkan/);
        assert.throws(() => w.eval(`assertLaluanTugasan_('artifacts/dashboard-alumni-kpi/public/data/tugasan/../kpi-2026', false)`), /tidak dibenarkan/);
        assert.deepEqual(w.writes, []);
    },

    'a failure is reported to the admin and in the status'() {
        const w = makeWorld({ programs: [PERAK()], staf: STAF, props: { EMEL_ADMIN: 'alumni@upsi.edu.my' } });
        w.props.FOLDER_INDUK_ID = 'HILANG';
        const res = w.run();
        assert.match(res.ralat, /no folder HILANG/);
        assert.deepEqual(w.mails.map(m => [m.to, m.subject]), [['alumni@upsi.edu.my', 'Robot tugasan dokumen gagal']]);
        assert.equal(w.status().ok, false);
    }
};

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
    try { fn(); console.log(`PASS  ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}
console.log(`\n${Object.keys(cases).length - failed}/${Object.keys(cases).length} passed`);
process.exit(failed ? 1 : 0);
