# Ujian pelayar (browser tests)

Ujian ini menjalankan app dalam Chromium dengan **Firebase palsu**
(`mock-firebase.js`). Tiada data Firestore sebenar dibaca atau ditulis.
Setiap tulisan direkod supaya ujian boleh semak apa yang *akan* ditulis.

## Cara jalankan

```bash
cd tests
npm install                 # sekali sahaja: Chart.js, Font Awesome, jsPDF, dll.
node run.js                 # semua senario
node run.js reset history   # senario yang namanya mengandungi perkataan itu
node run.js --shots         # simpan screenshot ke tests/shots/
```

Perlu Node 18+ dan Playwright dengan Chromium. Dalam sesi Claude Code di
cloud, Playwright sudah dipasang. Di komputer sendiri:
`npm i -g playwright && npx playwright install chromium`.

## Nota
- Jam pelayar dikunci pada 29/10/2026 10:00, supaya keputusan sama setiap
  kali dijalankan. Data contoh dan jangkaan dalam `run.js` bergantung pada
  tarikh ini.
- Data contoh: 6 KPI tahun 2026 (nilai terkumpul), Takwim campuran format
  lama dan baharu, dan 36 rekod log audit.
- Folder ini tidak di-deploy ke Vercel (lihat `.vercelignore`).
