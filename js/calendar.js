// --- JS/CALENDAR.JS ---
// "Simpan ke kalendar" for a Takwim activity: a Google Calendar link and an
// .ics file (iPhone Calendar, Outlook, Samsung and others open it). Read
// only: nothing is written to Firestore. Activities are whole-day events
// (Takwim stores dates, not times).

const APP_NAME = 'Takwim Aktiviti Pusat Alumni UPSI';

// "2026-11-08" -> "20261108"; with `plusDays`, the day after (end dates in
// both formats are exclusive for whole-day events)
function compactDate(iso, plusDays = 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + plusDays));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function lastDay(ev) {
    return ev.dateTo && String(ev.dateTo) >= String(ev.date) ? ev.dateTo : ev.date;
}

function appLink() {
    try { return `${location.origin}${location.pathname}?tab=takwim`; } catch (_) { return ''; }
}

function descriptionOf(ev, notes) {
    return [notes, `${APP_NAME}: ${appLink()}`].filter(Boolean).join('\n\n');
}

// Only activities that are still ahead (or running today) and not cancelled
export function canAddToCalendar(ev, todayIso, status) {
    if (!ev || !compactDate(ev.date)) return false;
    if (status === 'Dibatalkan') return false;
    return String(lastDay(ev)) >= String(todayIso);
}

export function googleCalendarUrl(ev, notes = '') {
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: ev.title || 'Aktiviti Pusat Alumni UPSI',
        dates: `${compactDate(ev.date)}/${compactDate(lastDay(ev), 1)}`,
        details: descriptionOf(ev, notes),
        location: ev.location || ''
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// RFC 5545 text: escape \ ; , and newlines; fold lines over 75 octets
const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = [];
    let cur = '';
    let curLen = 0;
    for (const ch of line) {
        const len = new TextEncoder().encode(ch).length;
        if (curLen + len > (out.length ? 74 : 75)) { out.push(cur); cur = ''; curLen = 0; }
        cur += ch; curLen += len;
    }
    out.push(cur);
    return out.join('\r\n ');
}

export function icsText(ev, notes = '', now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Pusat Alumni UPSI//Takwim Aktiviti//MS',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${icsEscape(ev.id || compactDate(ev.date))}@kpi-pusat-alumni-upsi`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compactDate(ev.date)}`,
        `DTEND;VALUE=DATE:${compactDate(lastDay(ev), 1)}`,
        `SUMMARY:${icsEscape(ev.title || 'Aktiviti Pusat Alumni UPSI')}`,
        ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
        `DESCRIPTION:${icsEscape(descriptionOf(ev, notes))}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(ev, notes = '') {
    const blob = new Blob([icsText(ev, notes)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = String(ev.title || 'aktiviti').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'aktiviti';
    a.href = url;
    a.download = `${slug}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
