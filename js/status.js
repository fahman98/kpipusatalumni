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

// Solid hex used on canvas (favicon, gauges), rings and status dots.
export const STATUS_HEX = { good: '#43a047', ok: '#f59e0b', bad: '#e53935' };
export function statusHex(percentage) { return STATUS_HEX[statusTier(percentage)]; }

// Tailwind/CSS background class for progress bars & tinted surfaces.
export const STATUS_BAR_CLASS = { good: 'bg-status-good', ok: 'bg-status-ok', bad: 'bg-status-bad' };
export function statusBarClass(percentage) { return STATUS_BAR_CLASS[statusTier(percentage)]; }
