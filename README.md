# Dashboard KPI Pusat Alumni UPSI

Papan pemuka pemantauan prestasi KPI suku tahunan bagi Pusat Alumni,
Universiti Pendidikan Sultan Idris.

- **Langsung:** https://kpipusatalumni.vercel.app
- **Paparan awam:** sesiapa sahaja boleh melihat data tanpa log masuk.
- **Mod admin:** satu akaun sahaja yang boleh mengubah data (lihat
  [Akaun admin](#akaun-admin)).

---

## Kandungan

- [Gambaran seni bina](#gambaran-seni-bina)
- [Struktur fail](#struktur-fail)
- [Model data Firestore](#model-data-firestore)
- [Akaun admin](#akaun-admin)
- [Pembangunan setempat](#pembangunan-setempat)
- [Deploy](#deploy)
- [Menjana semula aset imej](#menjana-semula-aset-imej)
- [Perkara yang perlu diberi perhatian](#perkara-yang-perlu-diberi-perhatian)

---

## Gambaran seni bina

Aplikasi ini ialah **laman statik tanpa langkah build**. Tiada `npm install`,
tiada bundler, tiada proses kompilasi. Fail yang berada dalam repo inilah fail
yang dihidangkan kepada pelayar.

| Lapisan | Teknologi |
|---|---|
| Frontend | HTML + modul ES (`type="module"`), tiada framework |
| Gaya | Tailwind melalui Play CDN + `style.css` tersuai |
| Data & auth | Firebase 8.10.1 (Firestore + Authentication) |
| Carta | Chart.js 4.4.1 |
| PDF | jsPDF + AutoTable, dimuat atas permintaan sahaja |
| Luar talian | Service worker (`sw.js`) + kegigihan luar talian Firestore |
| Hosting | Vercel |

Tiga paparan utama dikendalikan oleh `switchView()` dalam `js/main.js`:
**Dashboard** (kad KPI), **Takwim** (kalendar aktiviti), dan **Penjanaan**
(rekod penjanaan dana, tersedia dari tahun 2026).

---

## Struktur fail

```
index.html              Semua markup: header, kad, dan setiap modal
config.js               Inisialisasi Firebase; mendedahkan `auth` dan `db` global
style.css               Gaya tersuai, termasuk keseluruhan tema mod gelap
sw.js                   Service worker (network-first untuk shell aplikasi)
manifest.json           Manifest PWA
firestore.rules         Peraturan keselamatan sebelah pelayan

js/
  main.js               Titik masuk: auth, kitaran hidup dashboard, eksport,
                        PWA, pintasan papan kekunci, paparan jadual
  api.js                Setiap bacaan/tulisan Firestore; cache; log audit
  ui.js                 Pembinaan kad, modal, perangkap fokus, toast, pengiraan
  auth.js               Satu-satunya sumber kebenaran untuk email admin
  status.js             Ambang status KPI (75% / 30%) dan warnanya
  charts.js             Tolok keseluruhan dan carta sejarah KPI
  admin.js              Modal log masuk gaya terminal + lockout
  takwim.js             Paparan kalendar aktiviti
  penjanaan.js          Paparan rekod penjanaan dana

images/
  source/               Logo resolusi penuh (sumber, tidak dihidangkan)
  *.png                 Aset web yang dijana (lihat tools/build-assets.py)

tools/
  build-assets.py       Menjana logo, ikon PWA dan kad pratonton OG
```

### Cache busting

`index.html` merujuk `style.css?v=4.3` dan `js/main.js?v=4.3`. **Naikkan nombor
versi ini setiap kali anda mengubah CSS atau JS**, jika tidak pelawat berulang
mungkin masih mendapat fail lama daripada cache pelayar. Naikkan juga
`CACHE_VERSION` dalam `sw.js` apabila senarai `PRECACHE_ASSETS` berubah.

---

## Model data Firestore

Semua data berada di bawah satu laluan awam:

```
artifacts/dashboard-alumni-kpi/public/data/
  ├─ kpi-{tahun}/{q1|q2|q3|q4}   Dokumen KPI suku tahunan
  ├─ takwim-{tahun}/main         Kalendar aktiviti bagi tahun tersebut
  ├─ meta/{tahun}                Penanda "Data dikemaskini pada ..."
  └─ audit-logs/{autoId}         Jejak tindakan admin (tambah sahaja)
```

Setiap dokumen suku tahun mempunyai bentuk seperti berikut:

```jsonc
{
  "title": "Suku Pertama",
  "subtitle": "(Januari - Mac 2026)",
  "footerDate": "8 September 2026, 09:15",
  "kpis": [
    {
      "id": "pendanaan",           // stabil; jangan tukar selepas data wujud
      "name": "Pendanaan & Penjanaan",
      "icon": "fa-money-bill-wave",
      "target": 70000,
      "value": 0,                  // digunakan bila tiada `details.items`
      "isCurrency": true,          // ATAU isPercentage: true, ATAU kiraan biasa
      "details": {
        "type": "breakdownList",   // breakdownList | progressList | list
        "items": [ { "id": "it-...", "name": "...", "value": 4049, "bulan": 2 } ]
      }
    }
  ]
}
```

**Tiga jenis `details`:**

| Jenis | Cara nilai KPI dikira |
|---|---|
| `breakdownList` | Jumlah `items[].value` |
| `progressList` | Purata `items[].value`; item dengan `subItems` menggunakan purata sub-itemnya |
| `list` | Bilangan `achieved` daripada `targetList` |

Jika KPI tiada `details`, `value` digunakan terus. Logik ini berada dalam
`calculateKpiValue()` di `js/ui.js`.

**Data suku tahun bersifat kumulatif.** Suku 2 mengandungi semua rekod Suku 1
ditambah rekod baharu. Sebab itulah `js/api.js` menulis kepada suku semasa
*dan semua suku selepasnya* apabila item ditambah.

### Kenapa tulisan menggunakan transaksi

Setiap penulis dalam `api.js` menulis semula keseluruhan tatasusunan `kpis`.
Dengan `WriteBatch` biasa, dua tab yang mengedit KPI berbeza dalam suku yang
sama akan saling menimpa secara senyap. `runQuarterTransaction()` membaca semula
di bawah snapshot dan mencuba semula apabila berlaku pertembungan, jadi keadaan
itu tidak boleh berlaku. **Kekalkan corak ini** untuk sebarang penulis baharu.

---

## Akaun admin

Email admin ditakrifkan di **dua tempat, dan kedua-duanya mesti sepadan**:

1. `js/auth.js` &rarr; pemalar `ADMIN_EMAIL` (gate UI)
2. `firestore.rules` &rarr; fungsi `isAdmin()` (penguatkuasaan sebenar)

```js
// js/auth.js
export const ADMIN_EMAIL = 'alumni@upsi.edu.my';
```

```
// firestore.rules
request.auth.token.email == 'alumni@upsi.edu.my'
```

Semakan dalam `auth.js` hanyalah gate **UI**: ia menentukan butang yang
dipaparkan. Sesiapa boleh mengubahnya daripada konsol pelayar. Keselamatan
sebenar terletak sepenuhnya pada `firestore.rules`.

Jika anda menukar email admin, kemas kini kedua-duanya, kemudian deploy semula
peraturan Firestore (lihat [Deploy](#deploy)). Menukar satu sahaja akan
menghasilkan sistem yang tidak selari: sama ada UI membuka butang yang setiap
penulisannya ditolak, atau akaun yang sah tidak dapat melihat butang langsung.

Pelawat biasa log masuk secara **anonymous** secara automatik. Mereka tiada
claim email, jadi mereka tidak akan sesekali memenuhi `isAdmin()`.

---

## Pembangunan setempat

Fail-fail ini adalah modul ES, jadi ia **tidak boleh** dibuka terus melalui
`file://` (CORS akan menyekatnya). Hidangkan direktori tersebut:

```bash
python3 -m http.server 8000
# kemudian buka http://localhost:8000
```

Domain `localhost` perlu berada dalam senarai domain yang dibenarkan Firebase
Authentication (Firebase Console &rarr; Authentication &rarr; Settings &rarr;
Authorized domains) supaya log masuk berfungsi semasa pembangunan.

Aplikasi ini menulis ke pangkalan data Firestore **produksi** yang sama semasa
pembangunan setempat. Berhati-hati semasa menguji tindakan admin, terutamanya
"Fix/Reset" yang memadam data satu tahun penuh.

---

## Deploy

**Aplikasi.** Vercel menyambung terus kepada repo ini. Push ke `main` akan
melakukan deploy secara automatik. Tiada langkah build untuk dikonfigurasi.

**Peraturan Firestore.** Ini *tidak* di-deploy oleh Vercel. Ia perlu
di-deploy secara berasingan selepas sebarang perubahan pada `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

Atau tampal kandungan fail tersebut melalui Firebase Console &rarr; Firestore
Database &rarr; Rules &rarr; Publish.

---

## Menjana semula aset imej

Logo dalam `images/` dijana daripada fail resolusi penuh dalam
`images/source/`. Ikon PWA dan kad pratonton OG turut dijana daripada sumber
yang sama.

```bash
pip install Pillow
python3 tools/build-assets.py
```

Skrip ini menulis semula `images/logo-1.png`, `logo-2.png`, `icon-192.png`,
`icon-512.png`, `apple-touch-icon.png`, `favicon-64.png` dan `og-preview.png`.
Semua fail keluaran dikomit ke dalam repo, tiada apa-apa yang dijana semasa
deploy. Jalankan skrip ini hanya apabila logo sumber atau reka bentuk kad
berubah.

---

## Perkara yang perlu diberi perhatian

**Kunci API Firebase dalam `config.js` memang sepatutnya terdedah.** Ia
pengenal pasti projek, bukan rahsia. Yang melindungi data anda ialah
`firestore.rules`, bukan menyembunyikan kunci tersebut.

**Sekatan bagi tahun sebelum 2026.** Tab Penjanaan, pemilih bulan bagi item,
dan penapis "Bicara Ramadan" kesemuanya bersyarat pada `selectedYear >= 2026`.
Cari `2026` dalam `js/` untuk melihat semua tempatnya.

**Penapis Bicara Ramadan.** `js/main.js` membuang item bernama
`Bicara Ramadan` daripada KPI Penerbitan bagi tahun 2026 ke atas, dan mengira
semula peratusan KPI tersebut. Ini adalah tampalan sebelah paparan terhadap
data yang masih wujud dalam Firestore. Pembetulan yang lebih baik ialah
membersihkan data tersebut sekali sahaja, kemudian membuang tampalan ini.

**Notifikasi.** Setiap kemas kini masa nyata mencetuskan notifikasi pelayar
bagi pengguna yang telah memberi kebenaran, termasuk admin yang membuat
suntingan tersebut.

**Tailwind Play CDN.** `index.html` memuatkan `cdn.tailwindcss.com`, yang
menyusun CSS dalam pelayar pada setiap muatan halaman dan memaparkan amaran
konsol bahawa ia bukan untuk produksi. Menggantikannya memerlukan langkah
build: pertukaran yang berbaloi, tetapi ia mengubah cara kerja repo ini.
