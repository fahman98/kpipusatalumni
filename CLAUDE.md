# KPI Dashboard · Pusat Alumni UPSI

Static PWA on Vercel (auto-deploys `main`), data in Firebase Firestore (SDK 8,
CDN). No build step except Tailwind. Maintained by one contract staff member
at Pusat Alumni (Komunikasi & ICT). Full change history: `git log` and the
descriptions of PR #2 to #8.

## Working with the owner
- Chat in Manglish ("aku"/"kau"). UI text, toasts and official copy: formal
  Bahasa Melayu (DBP spelling), friendly not stiff. No Indonesian words.
- Never use em dashes (—) in anything you write; a hyphen is fine.
- Dates DD/MM/YYYY (`toLocaleDateString('en-GB')`), money `RM 1,234.00`.
- When there are options, recommend one and say why. Ask with clickable
  buttons. Say plainly when unsure or when the owner's idea has a better way.
- Explain code changes in plain language.

## Data safety (top priority)
- The owner cannot easily re-enter lost data. Never write to live Firestore
  from a session, and never press reset / delete in a live app.
- Test against a mocked Firebase in Playwright: route `firebase-app.js` to a
  mock defining `window.firebase` (auth, firestore with doc get/onSnapshot,
  batch and runTransaction that record writes), strip `integrity=` from
  `index.html`, serve CDN libs from local npm packages, and assert what would
  be written. The proxy blocks Firebase/CDNs from the container anyway.
- Changing a stored data shape: stay backward compatible, never migrate
  existing docs in bulk; convert a record only when the admin next saves it
  (see Takwim `status` below).
- `firestore.rules` deploys manually (Firebase Console). Code must not rely
  on a rules change unless the owner deploys it.

## Files
- `index.html` all markup and modals; `style.css` custom CSS; `tailwind.css`
  generated (never hand-edit); `sw.js` service worker.
- `js/main.js` boot, auth flow, dashboard render, PDF report, table view.
- `js/api.js` every Firestore read/write, audit log, clone/reset, backup.
- `js/ui.js` cards, details modal, confirm/input modals, formatting.
- `js/status.js` status tiers and pace logic. `js/charts.js` Chart.js.
- `js/takwim.js`, `js/penjanaan.js` the two other tabs. `js/admin.js` login,
  logout, idle logout. `js/history.js` audit log viewer. `js/auth.js` admin
  allow-list (`alumni@upsi.edu.my`, mirrored in `firestore.rules`).

## Data model (`artifacts/{appId}/public/data/...`)
- `kpi-{year}/q1..q4` `{ title, subtitle, kpis: [...], footerDate }`. Values
  are CUMULATIVE year-to-date: saving Qn carries the value to later quarters
  that still hold the inherited value. Targets are annual.
- KPI: `{ id, name, icon, target, value, isPercentage, isCurrency,
  description, updatedAt, details? }`; `details.type` is `breakdownList`
  (items `{id?, name, value, bulan?, tarikh?, tarikhTamat?, hadir?}`),
  `list` or `progressList`. Penjanaan = KPI id `pendanaan`, read from `q4`.
- `takwim-{year}/main` `{ events: [{ id, title, date, dateTo, location,
  status, notes, createdAt }] }`. Events without a `status` key are legacy:
  the status word lives in `notes` (read via `eventStatus()/eventNotes()`).
- `meta/{year}` `{ label }` last-updated footer. `audit-logs/{auto}` admin
  read-only, append-only. Since 29/10/2026 entries carry `deleted` / `before`
  snapshots and `oldValue`; older ones only ids.

## Key behaviour (decided with the owner)
- Status colour = pace-adjusted: `pct / expectedFraction` where expected is
  quarter/4, capped at the share of the year elapsed. Thresholds stay 75/30
  (`STATUS_THRESHOLDS`) so a finished Q4 matches the old meaning.
  `isPercentage` KPIs are not pro-rated. Shown % stays vs annual target.
- Quarters not yet begun: tabs muted, history chart leaves them empty.
- Reset / Salin Struktur act on the SELECTED year from the year before;
  reset needs the year typed and downloads a JSON backup first.
- Admin session: SESSION persistence + idle logout after 30 min (warn at 28).
- Full backup button reads years from `BACKUP_FIRST_YEAR` (2020) to next year.
- Logos are 240px-tall 256-colour PNGs. App icons: lossless only (palette
  reduction showed dithering on the gold gradient, rejected).

## Before every push
1. Rebuild Tailwind when any class changes in `index.html` or `js/`:
   `npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.src.css -o tailwind.css --minify`
2. Bump the `?v=` on whichever of `style.css`, `tailwind.css`, `js/main.js`
   changed in `index.html`. Bump `CACHE_VERSION` in `sw.js` when its precache
   list changes (add new JS files there).
3. Run what CI runs: `node --check` on each JS file (copy to `.mjs` first),
   `node .github/scripts/check-refs.mjs`, `node .github/scripts/check-rules.mjs`,
   and confirm the Tailwind output matches.
4. Screenshot desktop (1366px) and phone (390px) against the mock.

## Git workflow
- Work on the session's branch, open a PR only when asked. On "merge bro":
  open the PR, wait for CI `smoke` green, merge with `expectedHeadSha`, then
  reset the branch to `origin/main` and push it.
- Commit messages: imperative subject with a type prefix (`ui:`, `fix:`,
  `feat:`), body explains why.

## Ideas not done yet
- Restore-from-backup button (needs careful design, it writes).
- Two icon libraries load in full (Font Awesome + Phosphor).
- Audit log filter by year would need a Firestore composite index.
