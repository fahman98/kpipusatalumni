// --- JS/STATUS.JS ---
// Single source of truth for KPI status tiers, thresholds and screen colours.
// Keeps the good/ok/bad boundaries (75% / 30%) and their colours consistent
// across every module instead of being re-typed inline in a dozen places.

export const STATUS_THRESHOLDS = { good: 75, ok: 30 };

// 'good' | 'ok' | 'bad' for a given percentage.
export function statusTier(percentage) {
    const p = Number(percentage) || 0;
    if (p >= STATUS_THRESHOLDS.good) return 'good';
    if (p >= STATUS_THRESHOLDS.ok) return 'ok';
    return 'bad';
}

// Words for each tier — the colour is never the only signal.
export const STATUS_LABEL = { good: 'Cemerlang', ok: 'Sederhana', bad: 'Perlu Perhatian' };

// Solid hex used on canvas (favicon, gauges), rings and status dots.
export const STATUS_HEX = { good: '#43a047', ok: '#f59e0b', bad: '#e53935' };
export function statusHex(percentage) { return STATUS_HEX[statusTier(percentage)]; }

// Tailwind/CSS background class for progress bars & tinted surfaces.
export const STATUS_BAR_CLASS = { good: 'bg-status-good', ok: 'bg-status-ok', bad: 'bg-status-bad' };
export function statusBarClass(percentage) { return STATUS_BAR_CLASS[statusTier(percentage)]; }

// --- PACE (status ikut suku) ---------------------------------------------
// Quarter documents hold CUMULATIVE year-to-date figures (a value saved in Q2
// is carried into Q3 and Q4), but the target is annual. Judging Q1's 25% of
// the annual target against the 75%/30% thresholds painted every KPI red each
// spring even when it was exactly on schedule. Status is therefore judged
// against the share of the target that should be done by now, while the
// percentage shown stays the honest figure against the full annual target.

// Share (0-1] of the annual target expected by the end of `quarterNum` in
// `year`. In the running year it is capped at the part of the year already
// gone (to the day), so a quarter still under way is judged against today
// rather than its last day.
export function expectedFraction(year, quarterNum, now = new Date()) {
    const q = Math.min(Math.max(parseInt(quarterNum, 10) || 4, 1), 4);
    const quarterEnd = q / 4;
    const y = parseInt(year, 10);
    if (y !== now.getFullYear()) return quarterEnd;
    const start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
    return Math.min(quarterEnd, (now - start) / (end - start));
}

// Has quarter `quarterNum` of `year` begun? Values are carried forward into
// later quarters, so a quarter that hasn't started still shows figures; this
// lets the UI say so instead of presenting them as that quarter's results.
export function quarterStarted(year, quarterNum, now = new Date()) {
    const y = parseInt(year, 10), q = parseInt(quarterNum, 10);
    if (y !== now.getFullYear()) return y < now.getFullYear();
    return now.getMonth() >= (q - 1) * 3;
}

// The dashboard's current year + quarter, set by main.js on every quarter or
// year switch so cards, stats, table and PDF all judge the same way.
let paceFraction = 1;
export function setPaceContext(year, quarterNum) {
    paceFraction = expectedFraction(year, quarterNum);
}
export function getPaceFraction() { return paceFraction; }

// Does this KPI accumulate over the year? Percentage KPIs (e.g. a
// satisfaction index) are a level, not a running total, so they are not
// pro-rated.
export function isPacedKpi(kpi) {
    return !!kpi && !kpi.isPercentage;
}

// The percentage the status tier is judged on: `pct` against the target
// expected by now. 100 means exactly on schedule.
export function paceAdjustedPct(pct, fraction = paceFraction) {
    return fraction > 0 ? (Number(pct) || 0) / fraction : (Number(pct) || 0);
}
export function kpiStatusPct(kpi, pct) {
    return isPacedKpi(kpi) ? paceAdjustedPct(pct) : (Number(pct) || 0);
}
