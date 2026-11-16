/**
 * ROBOT TUGASAN DOKUMEN · Pusat Alumni UPSI
 * ------------------------------------------------------------------------
 * Berjalan setiap pagi (pencetus masa) di bawah akaun Google UPSI yang
 * memasangnya (contoh fahman@upsi.edu.my). Folder dicipta dan emel dihantar
 * oleh akaun itu; balasan staf pergi ke EMEL_BALAS jika ditetapkan.
 * Untuk setiap program yang ada tugasan dalam Dashboard KPI, robot ini:
 *   1. mencipta folder program dalam Google Drive, dengan satu subfolder
 *      bagi setiap tugasan (contoh "Laporan"), dan berkongsi subfolder itu
 *      dengan PIC sebagai editor;
 *   2. mengemel PIC apabila ditetapkan sebagai PIC (sekali), 3 hari sebelum
 *      tarikh akhir (sekali) dan apabila lewat (setiap 7 hari, maksimum 4);
 *   3. menanda tugasan "Selesai" apabila ada fail dalam subfolder PIC, dan
 *      mengisi pautan fail itu dalam dashboard.
 *
 * KESELAMATAN DATA
 * - Robot MENULIS ke koleksi `tugasan` sahaja (lihat assertLaluanTugasan_).
 *   Dokumen KPI hanya DIBACA (kpi-{tahun}/q4) untuk melangkau program yang
 *   sudah dipadam daripada Kembara; ia tidak pernah ditulis.
 * - Akses ke Firestore menggunakan akaun Google pemilik skrip melalui IAM,
 *   jadi firestore.rules tidak terpakai di sini. Sebab itu had di atas
 *   dikuatkuasakan dalam kod.
 * - Simpanan menggunakan prasyarat `updateTime`: jika admin menyimpan dari
 *   dashboard semasa robot berjalan, simpanan robot ditolak dan dicuba
 *   semula pada larian seterusnya. Tiada perubahan admin yang tertindih.
 * - Mod uji (Script Property MOD_UJI = YA) hanya mencatat apa yang akan
 *   dibuat dalam Log. Tiada folder, emel atau tulisan Firestore.
 *
 * Panduan pemasangan: apps-script/README.md
 */

var ROBOT = {
  PROJECT_ID: 'dashboard-alumni-kpi',
  APP_ID: 'dashboard-alumni-kpi',
  ZON: 'Asia/Kuala_Lumpur',
  DASHBOARD_URL: 'https://kpipusatalumni.vercel.app/',
  HARI_PERINGATAN: 3,
  SELANG_LEWAT: 7,
  MAKS_EMEL_LEWAT: 4,
  NAMA_PENGIRIM: 'Pusat Alumni UPSI',
  JAM_LARIAN: 8
};

// ---------------------------------------------------------------- Menu ---

/** Larian harian (dipanggil oleh pencetus). */
function jalankanRobot() {
  var hasil = laksana_(tetapan_());
  Logger.log(hasil.ringkasan.join('\n'));
  return hasil;
}

/** Semak akses tanpa mengubah apa-apa: Firestore, folder induk, kuota emel. */
function semakSambungan() {
  var t = tetapan_();
  var tahun = tahunIni_(t.hariIni);
  var doc = fsGet_(laluanTugasan_(tahun));
  var staf = fsGet_(laluanTugasan_('staf'));
  var induk = DriveApp.getFolderById(t.folderInduk);
  var baris = [
    'Berjalan sebagai: ' + Session.getEffectiveUser().getEmail(),
    'Firestore tugasan/' + tahun + ': ' + (doc ? (doc.data.programs || []).length + ' program' : 'belum wujud'),
    'Firestore tugasan/staf: ' + (staf ? (staf.data.staf || []).length + ' staf' : 'belum wujud'),
    'Folder induk: ' + induk.getName() + ' (pemilik: ' + (induk.getOwner() ? induk.getOwner().getEmail() : 'Drive bersama') + ')',
    'Baki kuota emel hari ini: ' + MailApp.getRemainingDailyQuota(),
    'Mod uji: ' + (t.modUji ? 'YA (tiada perubahan dibuat)' : 'TIDAK')
  ];
  Logger.log(baris.join('\n'));
  return baris;
}

/** Pasang pencetus harian (sekali sahaja). */
function pasangPencetus() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'jalankanRobot') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('jalankanRobot').timeBased().everyDays(1).atHour(ROBOT.JAM_LARIAN)
    .inTimezone(ROBOT.ZON).create();
  Logger.log('Pencetus harian dipasang: setiap hari sekitar jam ' + ROBOT.JAM_LARIAN + ' pagi.');
}

// ------------------------------------------------------------- Tetapan ---

function tetapan_() {
  var p = PropertiesService.getScriptProperties();
  var induk = p.getProperty('FOLDER_INDUK_ID');
  if (!induk) throw new Error('Script Property FOLDER_INDUK_ID belum ditetapkan (lihat README).');
  return {
    folderInduk: induk,
    modUji: String(p.getProperty('MOD_UJI') || '').toUpperCase() === 'YA',
    emelAdmin: p.getProperty('EMEL_ADMIN') || '',
    emelBalas: p.getProperty('EMEL_BALAS') || '',
    hariIni: Utilities.formatDate(new Date(), ROBOT.ZON, 'yyyy-MM-dd')
  };
}

function tahunIni_(hariIni) { return hariIni.slice(0, 4); }

// ------------------------------------------------------------ Logik ---

function laksana_(t) {
  var log = [];
  var catat = function (m) { log.push(m); };
  var tahun = tahunIni_(t.hariIni);
  var laluan = laluanTugasan_(tahun);
  var hasil = { ringkasan: log, selesai: [], emel: [], ditulis: false };
  try {
    var doc = fsGet_(laluan);
    var stafDoc = fsGet_(laluanTugasan_('staf'));
    var staf = stafDoc && Array.isArray(stafDoc.data.staf) ? stafDoc.data.staf : [];
    var programs = doc && Array.isArray(doc.data.programs) ? doc.data.programs : [];
    if (!programs.length) catat('Tiada program bertugasan bagi tahun ' + tahun + '.');
    // Program yang masih ada dalam senarai KPI (dibaca sahaja). Jika tidak
    // dapat dibaca, fsGet_ membaling ralat dan larian berhenti tanpa emel.
    var aktif = programs.length ? programAktif_(tahun) : {};

    var drive = driveOps_(t, catat);
    var emelBaru = [];
    var berubah = false;
    var folderTahun = null;

    programs.forEach(function (prog) {
      var tasks = Array.isArray(prog.tasks) ? prog.tasks : [];
      if (!tasks.length) return;
      if (!aktif[(prog.kpiId || '') + '|' + prog.key]) {
        catat('Dilangkau: ' + (prog.name || prog.key) + ' (program sudah dipadam daripada senarai KPI).');
        return;
      }
      if (!folderTahun) folderTahun = drive.folderAnak(drive.induk(), tahun);
      var namaFolder = (prog.tarikh ? prog.tarikh + ' ' : '') + (prog.name || 'Program');
      var r = prog.robot || {};
      var fProg = drive.pastikanFolder(folderTahun, r.folderId, namaFolder);
      if (fProg.id && (fProg.id !== r.folderId || fProg.url !== r.folderUrl)) {
        prog.robot = Object.assign({}, r, { folderId: fProg.id, folderUrl: fProg.url });
        berubah = true;
      }
      var namaDipakai = {};
      tasks.forEach(function (task) {
        var tr = task.robot || {};
        var namaSub = namaUnik_(task.jenis || 'Tugasan', namaDipakai);
        var fSub = drive.pastikanFolder(fProg, tr.folderId, namaSub);
        var tr2 = Object.assign({}, tr);
        if (fSub.id) { tr2.folderId = fSub.id; tr2.folderUrl = fSub.url; }

        var pic = cariStaf_(staf, task.pic);
        var emel = pic && pic.emel ? String(pic.emel).toLowerCase() : '';
        // Kongsi subfolder dengan PIC (sekali bagi setiap emel)
        if (emel && fSub.id && tr.dikongsi !== emel) {
          drive.kongsi(fSub, emel);
          tr2.dikongsi = emel;
        }

        // Fail dalam subfolder: tanda selesai dan isi pautan
        if (!task.selesai && fSub.id) {
          var fail = drive.failDalam(fSub);
          if (fail.length) {
            task.selesai = true;
            task.link = fail.length === 1 ? fail[0].url : fSub.url;
            tr2.selesaiAuto = true;
            tr2.selesaiPada = t.hariIni;
            hasil.selesai.push(task.jenis + ', ' + prog.name);
            catat('Selesai: ' + task.jenis + ', ' + prog.name + ' (' + fail.length + ' fail).');
          }
        }

        // Emel kepada PIC
        if (emel && !task.selesai) {
          var jenisEmel = pilihEmel_(task, tr, emel, t.hariIni);
          if (jenisEmel) {
            emelBaru.push({ jenis: jenisEmel, kepada: emel, nama: pic.nama, task: task, prog: prog, folderUrl: tr2.folderUrl || '' });
            if (jenisEmel === 'tugasan') tr2.emelTugasan = { emel: emel, pada: t.hariIni };
            if (jenisEmel === 'peringatan') tr2.peringatan = task.tarikhAkhir;
            if (jenisEmel === 'lewat') tr2.lewat = { tarikhAkhir: task.tarikhAkhir, pada: t.hariIni, kali: lewatKali_(tr, task) + 1 };
          }
        }

        if (JSON.stringify(tr2) !== JSON.stringify(tr)) { task.robot = tr2; berubah = true; }
      });
    });

    // Simpan dahulu, kemudian emel: jika simpanan ditolak (admin sedang
    // menyimpan), tiada emel dihantar dan larian esok mencuba semula
    if (berubah) {
      if (t.modUji) catat('[MOD UJI] Akan menyimpan perubahan ke tugasan/' + tahun + '.');
      else {
        fsPatchPrograms_(laluan, programs, doc ? doc.updateTime : null);
        hasil.ditulis = true;
        catat('Disimpan ke tugasan/' + tahun + '.');
      }
    }
    emelBaru.forEach(function (e) {
      var isi = isiEmel_(e);
      if (t.modUji) { catat('[MOD UJI] Akan emel ' + e.kepada + ': ' + isi.subjek); return; }
      try {
        var mesej = { to: e.kepada, subject: isi.subjek, htmlBody: isi.html, name: ROBOT.NAMA_PENGIRIM };
        if (t.emelBalas) mesej.replyTo = t.emelBalas;
        MailApp.sendEmail(mesej);
        hasil.emel.push(e.jenis + ' ' + e.kepada);
        catat('Emel ' + e.jenis + ': ' + e.kepada + ' (' + e.task.jenis + ', ' + e.prog.name + ').');
      } catch (err) {
        catat('Emel gagal ke ' + e.kepada + ': ' + err.message);
      }
    });
    if (!t.modUji) {
      if (hasil.ditulis && (hasil.selesai.length || hasil.emel.length)) {
        fsAuditLog_(tahun, { selesai: hasil.selesai, emel: hasil.emel });
      }
      fsSetRobotStatus_({ lastRun: new Date().toISOString(), ok: true, mesej: '' });
    }
    catat('Robot selesai: ' + hasil.selesai.length + ' tugasan ditanda selesai, ' + hasil.emel.length + ' emel.');
  } catch (err) {
    catat('RALAT: ' + err.message);
    if (!t.modUji) {
      try { fsSetRobotStatus_({ lastRun: new Date().toISOString(), ok: false, mesej: String(err.message).slice(0, 200) }); } catch (_) {}
      if (t.emelAdmin) {
        try {
          MailApp.sendEmail({ to: t.emelAdmin, subject: 'Robot tugasan dokumen gagal', name: ROBOT.NAMA_PENGIRIM,
            htmlBody: '<p>Robot tugasan dokumen gagal berjalan:</p><p><b>' + esc_(err.message) + '</b></p><p>Larian seterusnya akan mencuba semula.</p>' });
        } catch (_) {}
      }
    }
    hasil.ralat = err.message;
  }
  return hasil;
}

// 'tugasan' | 'peringatan' | 'lewat' | null
function pilihEmel_(task, tr, emel, hariIni) {
  var sudah = tr.emelTugasan && tr.emelTugasan.emel === emel;
  if (!sudah) return 'tugasan';
  var akhir = task.tarikhAkhir;
  if (!akhir) return null;
  if (akhir < hariIni) {
    var kali = lewatKali_(tr, task);
    if (kali >= ROBOT.MAKS_EMEL_LEWAT) return null;
    if (!kali) return 'lewat';
    return bezaHari_(tr.lewat.pada, hariIni) >= ROBOT.SELANG_LEWAT ? 'lewat' : null;
  }
  var baki = bezaHari_(hariIni, akhir);
  if (baki <= ROBOT.HARI_PERINGATAN && tr.peringatan !== akhir) {
    // Ditetapkan baru-baru ini (emel tugasan hari ini): tiada peringatan serentak
    if (tr.emelTugasan.pada === hariIni) return null;
    return 'peringatan';
  }
  return null;
}

// Emel lewat yang sudah dihantar bagi tarikh akhir semasa (dikira semula
// jika admin melanjutkan tarikh akhir)
function lewatKali_(tr, task) {
  return tr.lewat && tr.lewat.tarikhAkhir === task.tarikhAkhir ? (tr.lewat.kali || 0) : 0;
}

function bezaHari_(dari, ke) {
  var a = Date.UTC(+dari.slice(0, 4), +dari.slice(5, 7) - 1, +dari.slice(8, 10));
  var b = Date.UTC(+ke.slice(0, 4), +ke.slice(5, 7) - 1, +ke.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// Sama seperti programKey() dalam js/tugasan.js
function kunciProgram_(item) {
  if (item.id != null && item.id !== '') return 'id:' + item.id;
  return 'n:' + (item.name || '') + '|' + (item.tarikh || '');
}

// { 'kembara|id:it-xxx': true, ... } daripada kpi-{tahun}/q4 (senarai
// terkumpul: q4 memegang semua program tahun itu). Dibaca sahaja.
function programAktif_(tahun) {
  var doc = fsGet_('artifacts/' + ROBOT.APP_ID + '/public/data/kpi-' + tahun + '/q4');
  var out = {};
  var kpis = doc && Array.isArray(doc.data.kpis) ? doc.data.kpis : [];
  kpis.forEach(function (k) {
    var items = k && k.details && Array.isArray(k.details.items) ? k.details.items : [];
    items.forEach(function (it) { if (it) out[k.id + '|' + kunciProgram_(it)] = true; });
  });
  return out;
}

function cariStaf_(staf, id) {
  for (var i = 0; i < staf.length; i++) if (staf[i] && staf[i].id === id) return staf[i];
  return null;
}

function namaUnik_(nama, dipakai) {
  var n = nama, i = 2;
  while (dipakai[n]) n = nama + ' ' + (i++);
  dipakai[n] = true;
  return n;
}

function dmy_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isiEmel_(e) {
  var t = e.task, p = e.prog;
  var tarikhProg = dmy_(p.tarikh) + (p.tarikhTamat && p.tarikhTamat !== p.tarikh ? ' hingga ' + dmy_(p.tarikhTamat) : '');
  var akhir = t.tarikhAkhir ? dmy_(t.tarikhAkhir) : 'belum ditetapkan';
  var subjek, pembuka;
  if (e.jenis === 'tugasan') {
    subjek = 'Tugasan dokumen: ' + t.jenis + ', ' + p.name;
    pembuka = 'Tuan/Puan telah ditetapkan sebagai PIC bagi dokumen berikut.';
  } else if (e.jenis === 'peringatan') {
    subjek = 'Peringatan: ' + t.jenis + ', ' + p.name + ' (tarikh akhir ' + akhir + ')';
    pembuka = 'Ini peringatan mesra bahawa tarikh akhir dokumen berikut semakin hampir.';
  } else {
    subjek = 'Tugasan lewat: ' + t.jenis + ', ' + p.name;
    pembuka = 'Dokumen berikut telah melepasi tarikh akhir dan belum diterima.';
  }
  var folder = e.folderUrl
    ? '<p>Sila muat naik dokumen ke dalam folder ini:<br><a href="' + esc_(e.folderUrl) + '">' + esc_(e.folderUrl) + '</a></p>'
      + '<p>Status tugasan akan dikemas kini secara automatik setelah fail dimuat naik.</p>'
    : '';
  var html = '<p>Assalamualaikum dan salam sejahtera ' + esc_(e.nama || '') + ',</p>'
    + '<p>' + pembuka + '</p>'
    + '<table cellpadding="4" style="border-collapse:collapse">'
    + '<tr><td><b>Dokumen</b></td><td>' + esc_(t.jenis) + '</td></tr>'
    + '<tr><td><b>Program</b></td><td>' + esc_(p.name) + '</td></tr>'
    + '<tr><td><b>Tarikh program</b></td><td>' + esc_(tarikhProg) + '</td></tr>'
    + '<tr><td><b>Tarikh akhir</b></td><td>' + esc_(akhir) + '</td></tr>'
    + '</table>'
    + folder
    + '<p>Sekian, terima kasih.</p>'
    + '<p>' + esc_(ROBOT.NAMA_PENGIRIM) + '<br><small>Emel ini dihantar secara automatik oleh Dashboard KPI Pusat Alumni.</small></p>';
  return { subjek: subjek, html: html };
}

// --------------------------------------------------------------- Drive ---

function driveOps_(t, catat) {
  var uji = t.modUji;
  var bungkus = function (f) { return f ? { id: f.getId(), url: f.getUrl(), _f: f } : { id: null, url: '', _f: null }; };
  var cubaId = function (id) {
    if (!id) return null;
    try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (_) { return null; }
  };
  return {
    induk: function () { return bungkus(DriveApp.getFolderById(t.folderInduk)); },
    folderAnak: function (ibu, nama) {
      if (!ibu._f) return bungkus(null);
      var it = ibu._f.getFoldersByName(nama);
      while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return bungkus(f); }
      if (uji) { catat('[MOD UJI] Akan cipta folder ' + nama); return bungkus(null); }
      catat('Folder dicipta: ' + nama);
      return bungkus(ibu._f.createFolder(nama));
    },
    // Folder yang disimpan (ikut id) jika masih wujud, dinamakan semula jika
    // nama berubah; jika tiada, cipta yang baharu
    pastikanFolder: function (ibu, id, nama) {
      var f = cubaId(id);
      if (f) {
        if (f.getName() !== nama) {
          if (uji) catat('[MOD UJI] Akan namakan semula folder ' + f.getName() + ' kepada ' + nama);
          else { catat('Folder dinamakan semula: ' + f.getName() + ' kepada ' + nama); f.setName(nama); }
        }
        return bungkus(f);
      }
      if (uji) { catat('[MOD UJI] Akan cipta folder ' + nama); return bungkus(null); }
      if (!ibu._f) return bungkus(null);
      catat('Folder dicipta: ' + nama);
      return bungkus(ibu._f.createFolder(nama));
    },
    kongsi: function (folder, emel) {
      if (uji) { catat('[MOD UJI] Akan kongsi folder ' + folder.url + ' dengan ' + emel); return; }
      try { folder._f.addEditor(emel); catat('Folder ' + folder._f.getName() + ' dikongsi dengan ' + emel + '.'); }
      catch (err) { catat('Gagal kongsi folder dengan ' + emel + ': ' + err.message); }
    },
    failDalam: function (folder) {
      var out = [];
      if (!folder._f) return out;
      var it = folder._f.getFiles();
      while (it.hasNext()) {
        var f = it.next();
        if (!f.isTrashed()) out.push({ id: f.getId(), url: f.getUrl(), nama: f.getName() });
      }
      return out;
    }
  };
}

// ----------------------------------------------------------- Firestore ---

var FS_BASE_ = 'https://firestore.googleapis.com/v1/projects/' + ROBOT.PROJECT_ID + '/databases/(default)/documents/';

function laluanTugasan_(docId) {
  return 'artifacts/' + ROBOT.APP_ID + '/public/data/tugasan/' + docId;
}

// Satu-satunya tempat robot boleh menulis: koleksi tugasan dan log audit
function assertLaluanTugasan_(laluan, bolehAudit) {
  var tugasan = new RegExp('^artifacts/' + ROBOT.APP_ID + '/public/data/tugasan/[A-Za-z0-9_-]+$');
  var audit = 'artifacts/' + ROBOT.APP_ID + '/public/data/audit-logs';
  if (tugasan.test(laluan) || (bolehAudit && laluan === audit)) return;
  throw new Error('Robot tidak dibenarkan menulis ke ' + laluan);
}

function fsFetch_(url, opts) {
  opts = opts || {};
  opts.muteHttpExceptions = true;
  // X-Goog-User-Project: kuota dan kebenaran dikira pada projek Firebase,
  // bukan projek tersembunyi Apps Script (yang tidak mengaktifkan Firestore)
  opts.headers = Object.assign({
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Goog-User-Project': ROBOT.PROJECT_ID
  }, opts.headers || {});
  if (opts.payload && typeof opts.payload !== 'string') {
    opts.payload = JSON.stringify(opts.payload);
    opts.contentType = 'application/json';
  }
  return UrlFetchApp.fetch(url, opts);
}

function fsGet_(laluan) {
  var res = fsFetch_(FS_BASE_ + laluan, { method: 'get' });
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('Firestore GET ' + code + ': ' + res.getContentText().slice(0, 200));
  var body = JSON.parse(res.getContentText());
  return { data: fromFsFields_(body.fields || {}), updateTime: body.updateTime };
}

function fsPatchPrograms_(laluan, programs, updateTime) {
  assertLaluanTugasan_(laluan, false);
  var q = '?updateMask.fieldPaths=programs'
    + (updateTime ? '&currentDocument.updateTime=' + encodeURIComponent(updateTime) : '&currentDocument.exists=false');
  var res = fsFetch_(FS_BASE_ + laluan + q, { method: 'patch', payload: { fields: { programs: toFs_(programs) } } });
  var code = res.getResponseCode();
  var status = '';
  try { status = JSON.parse(res.getContentText()).error.status; } catch (_) {}
  if (status === 'FAILED_PRECONDITION' || status === 'ABORTED' || code === 409) {
    throw new Error('Data tugasan diubah semasa robot berjalan; akan dicuba semula pada larian seterusnya.');
  }
  if (code !== 200) throw new Error('Firestore PATCH ' + code + ': ' + res.getContentText().slice(0, 200));
}

function fsSetRobotStatus_(status) {
  var laluan = laluanTugasan_('robot');
  assertLaluanTugasan_(laluan, false);
  var res = fsFetch_(FS_BASE_ + laluan, { method: 'patch', payload: { fields: toFsFields_(status) } });
  if (res.getResponseCode() !== 200) throw new Error('Firestore status ' + res.getResponseCode());
}

function fsAuditLog_(tahun, details) {
  var laluan = 'artifacts/' + ROBOT.APP_ID + '/public/data/audit-logs';
  assertLaluanTugasan_(laluan, true);
  var fields = toFsFields_({ user: 'robot (Apps Script)', action: 'ROBOT_TUGASAN', year: tahun, details: details });
  fields.timestamp = { timestampValue: new Date().toISOString() };
  var res = fsFetch_(FS_BASE_ + laluan, { method: 'post', payload: { fields: fields } });
  if (res.getResponseCode() !== 200) Logger.log('Log audit gagal: ' + res.getResponseCode());
}

// Format nilai Firestore REST <-> objek JavaScript biasa
function toFs_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs_) } };
  return { mapValue: { fields: toFsFields_(v) } };
}

function toFsFields_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) out[k] = toFs_(obj[k]); });
  return out;
}

function fromFs_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs_);
  if ('mapValue' in v) return fromFsFields_(v.mapValue.fields || {});
  return null;
}

function fromFsFields_(fields) {
  var out = {};
  Object.keys(fields).forEach(function (k) { out[k] = fromFs_(fields[k]); });
  return out;
}
