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
- Test with `tests/` (see `tests/README.md`): `cd tests && npm install`
  once, then `node run.js` (21 scenarios, ~3 min) against `mock-firebase.js`,
  which records every write instead of sending it. Clock pinned to
  29/10/2026. Add a scenario to `tests/run.js` for each behaviour change;
  extend the mock's seed data rather than touching live data. The proxy
  blocks Firebase/CDNs from the container anyway.
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
  logout, idle logout. `js/history.js` audit log viewer. `js/todo.js` admin
  "Perlu tindakan" panel (read-only). `js/auth.js` admin
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
- Logos are 240px-tall 256-colour PNGs. App icon (since 01/11/2026): three
  rising white bars + gold target line (`#FFC24B`) on `#1747A6`, drawn as SVG
  and rendered to every PNG size; maskable keeps all marks inside the 80%
  safe circle, apple-touch-icon is full-bleed.
- PWA layer: offline notice shows the last server sync time (`getLastServerSync`
  in api.js); a new service worker shows "Versi baharu tersedia" and still
  auto-reloads only while the tab is hidden; install sheet / iOS guide once
  per session; manifest `id` is pinned to `./index.html` (changing
  `start_url` without it would orphan installed apps); shortcuts open
  `?tab=takwim|penjanaan`. `theme_color` stays `#0d47a1` until the colour
  redesign lands.
- Design source: claude.ai canvas "Redesign KPI Pusat Alumni" (owner's).
  Built: phase 1 (PWA layer + icon), phase 2 (phone dashboard), phase 3
  (Takwim chips + "Hari ini", Penjanaan balance + quarter summary, Butiran
  overview + full page on phones), phase 5 stage 1 (admin: value editor,
  delete preview, "Perlu tindakan", Takwim chip/section "Selesai"). Not
  yet: phase 4 (desktop + global colour #1747A6 / white phone header);
  phase 5 stage 2 (full-screen add forms: Penjanaan "Sumber kerap" chips,
  Kembara, Takwim status cards) and stage 3 (admin desktop table, with
  phase 4). Agreed for admin: "Salin struktur" stays on the empty-year
  screen only; native date pickers stay; the design's "Akan datang (Lalai)"
  status = empty status (follows the date); Sandaran / Sejarah / Zon Bahaya
  blocks stay; "Tambah ke takwim" from Kembara deferred.
- Admin value editor (`showInputModal` options icon / eyebrow / note /
  step / target): stepper, live "pencapaian selepas simpan" preview, note
  that the figure is the running total since January.
- Delete dialogs (`showConfirmModal` options `preview {title, meta}` and
  `impact {text, strong}`) show the record and the new total, and say a
  copy stays in Sejarah Perubahan (true since the audit snapshots).
- "Perlu tindakan" (admin, dashboard, hidden when empty): Kembara ended
  with no `hadir`; current year only: no Penjanaan record in the current
  quarter (from day 15 of it), no upcoming Takwim activity (next year's
  takwim counts). Reads q4 + takwim with one-off gets (`getQuarterOnce`,
  `getTakwimEvents`); buttons only open Butiran / the add forms. Mock flag
  `todos` (harness) raises all three.
- Butiran on phones is the same details modal styled as a full page (all
  admin add/edit/delete logic untouched). Opening it pushes one history
  entry so Android Back closes it; close/back/backdrop/Escape go through
  `dismissDetails()`. `openModal` fires a `modal-opened` event for this.
- Phone dashboard (<640px): quarter tabs above the hero, hero holds the
  status counts (they click the hidden `.stat-card`s, one filter path),
  KPI cards hidden and replaced by `.kpi-row`s built in `mobileListHtml()`.
  A row opens the focus modal as a "KPI sheet" whose actions click the
  hidden card's own buttons (details, chart, admin edit / settings /
  description), so every handler keeps one implementation. Cards carry
  `data-kpi-id`. Kept the blue app bar (design's white header waits for
  phase 4 so the status-bar colour stays matched).

## Before every push
1. Rebuild Tailwind when any class changes in `index.html` or `js/`:
   `npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.src.css -o tailwind.css --minify`
2. Bump the `?v=` on whichever of `style.css`, `tailwind.css`, `js/main.js`
   changed in `index.html`. Bump `CACHE_VERSION` in `sw.js` when its precache
   list changes (add new JS files there).
3. Run what CI runs: `node --check` on each JS file (copy to `.mjs` first),
   `node .github/scripts/check-refs.mjs`, `node .github/scripts/check-rules.mjs`,
   and confirm the Tailwind output matches.
4. `node tests/run.js` passes; `--shots` for desktop / phone screenshots.

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
