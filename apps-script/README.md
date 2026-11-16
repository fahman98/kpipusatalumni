# Robot Tugasan Dokumen (Google Apps Script)

Robot ini berjalan setiap pagi di bawah akaun Google UPSI yang
memasangnya, iaitu `fahman@upsi.edu.my`. Folder dicipta dan emel dihantar
oleh akaun itu (nama pengirim tertera "Pusat Alumni UPSI"). Untuk
setiap program Kembara yang ada tugasan dalam Dashboard KPI, robot:

1. mencipta folder program dalam Google Drive (`Folder induk / 2026 /
   2026-11-28 Kembara Alumni Perak`), dengan satu subfolder bagi setiap
   tugasan, dan berkongsi subfolder itu dengan PIC;
2. mengemel PIC apabila ditetapkan (sekali), 3 hari sebelum tarikh akhir
   (sekali) dan apabila lewat (setiap 7 hari, maksimum 4 kali);
3. menanda tugasan **Selesai** apabila ada fail dalam subfolder PIC, dan
   mengisi pautan fail itu dalam dashboard.

Robot hanya membaca dan menulis koleksi `tugasan` (dan satu log dalam
Sejarah Perubahan). Dokumen KPI tidak pernah disentuh. Kod ini disemak
oleh `node tests/robot.test.js` dengan Google palsu.

## Prasyarat

- Peraturan baharu `firestore.rules` sudah diterbitkan (Firebase Console,
  Firestore Database, Rules, Publish).
- Akaun `fahman@upsi.edu.my` ialah **Owner** atau **Editor** projek
  Firebase `dashboard-alumni-kpi`. Robot menulis ke Firestore menggunakan
  akaun ini. Semak di Firebase Console, Project settings, *Users and
  permissions*. Jika tiada, pemilik projek perlu menambahnya melalui
  *Add member* dengan peranan Editor.
- Setiap staf dalam "Senarai staf" (borang tugasan) ada emel UPSI.

## Pemasangan (sekali sahaja, kira-kira 15 minit)

1. **Folder induk.** Cipta folder `Tugasan Dokumen Pusat Alumni`. Buka
   folder itu dan salin ID daripada URL:
   `https://drive.google.com/drive/folders/`**`ID_INI`**. Tempat folder:
   - **Disyorkan: Drive bersama (Shared drive) unit**, jika UPSI
     membenarkan. Fail dimiliki oleh unit, bukan individu, jadi dokumen
     kekal walaupun akaun staf ditutup (penting untuk rekod ISO).
     `fahman@upsi.edu.my` perlu peranan *Content manager* atau *Manager*.
   - Jika tiada Drive bersama: dalam My Drive `fahman@upsi.edu.my`. Folder
     dimiliki oleh akaun itu, dan fail yang staf muat naik dimiliki oleh
     staf masing-masing. Sebelum akaun ditutup (contoh tamat kontrak),
     pindahkan pemilikan folder kepada akaun unit.
2. **Projek skrip.** Buka <https://script.google.com> sebagai
   `fahman@upsi.edu.my`, pilih *Projek baharu*, namakan
   `Robot Tugasan Dokumen`.
3. **Fail.** Dalam *Project Settings* (ikon gear), tandakan *Show
   "appsscript.json" manifest file in editor*. Kemudian di *Editor*:
   - ganti kandungan `appsscript.json` dengan fail `appsscript.json` di sini;
   - ganti kandungan `Code.gs` dengan `Robot.gs` di sini, kemudian Simpan.
4. **Script Properties** (Project Settings, bahagian bawah):

   | Property | Nilai |
   | --- | --- |
   | `FOLDER_INDUK_ID` | ID folder dari langkah 1 |
   | `MOD_UJI` | `YA` (robot hanya mencatat, tiada perubahan) |
   | `EMEL_ADMIN` | `fahman@upsi.edu.my` (emel jika robot gagal) |
   | `EMEL_BALAS` | Pilihan. Biarkan kosong: balasan staf terus ke `fahman@upsi.edu.my`. Isi jika balasan patut pergi ke alamat lain. |

5. **Semak sambungan.** Pilih fungsi `semakSambungan` dan tekan *Run*.
   Google akan meminta kebenaran: semak senarai dan tekan *Allow*. Log
   sepatutnya menunjukkan akaun yang menjalankan robot, bilangan program,
   bilangan staf, serta nama dan pemilik folder induk.
6. **Larian uji.** Pilih `jalankanRobot` dan tekan *Run*. Dengan
   `MOD_UJI = YA`, log menyenaraikan apa yang *akan* dibuat (folder, emel)
   tanpa membuatnya. Semak senarai itu.
7. **Larian sebenar.** Disyorkan: tetapkan diri sendiri sebagai PIC pada
   satu tugasan dahulu. Tukar `MOD_UJI` kepada `TIDAK`, jalankan
   `jalankanRobot` sekali, dan semak folder dalam Drive serta emel yang
   diterima. Buka borang tugasan dalam dashboard: ia menunjukkan "Robot
   terakhir berjalan pada ...".
8. **Pencetus harian.** Jalankan `pasangPencetus` sekali. Robot akan
   berjalan setiap hari sekitar jam 8 pagi.

## Jika ada masalah

- **`Firestore GET 403` atau "Cloud Firestore API has not been used in
  project ..."**: pastikan prasyarat kedua. Jika masih gagal, dalam
  *Project Settings* skrip, bahagian *Google Cloud Platform (GCP)
  Project*, pilih *Change project* dan masukkan nombor projek Firebase
  `985039765991`.
- **"Data tugasan diubah semasa robot berjalan"**: admin menyimpan borang
  tugasan pada masa yang sama. Tiada apa yang hilang; larian esok
  mencuba semula.
- **Staf tidak menerima emel**: semak emel staf dalam "Senarai staf".
  Staf tanpa emel tidak dikongsi folder dan tidak diemel.
- **Drive bersama tidak membenarkan perkongsian folder**: sesetengah
  tetapan Drive bersama menyekat perkongsian kepada bukan ahli. Tambah
  staf sebagai ahli Drive bersama (*Contributor*), atau minta pentadbir
  Google UPSI membenarkan perkongsian folder.
- **Hentikan robot**: di *Triggers* (ikon jam), padam pencetus
  `jalankanRobot`. Data dalam dashboard kekal.
- Google mungkin juga menghantar emel perkongsian folder sendiri kepada
  staf apabila folder dikongsi. Itu daripada Google Drive, bukan robot.

## Kemas kini kod

Apabila `Robot.gs` dalam repositori berubah, salin semula ke projek skrip
dan Simpan. Pencetus dan Script Properties tidak perlu dipasang semula.
