// --- JS/WELCOME.JS ---
// Poster sambutan shown over the dashboard on set dates (first used for the
// ISO 9001:2015 re-certification audit, 13/11/2026). Read-only: it touches
// no data. The dates stop it showing on their own; after the visit, remove
// the image file too, since a file in images/ stays reachable by its URL.
//
// Shown once per browser tab session, before the dashboard (which keeps
// loading behind it). Add ?sambutan=1 to the URL to show it on any day, for
// checking how it looks or if the visit moves to another date.

import { syncBodyScrollLock } from './ui.js';

const WELCOME = {
    key: 'audit-iso-2026',
    // Device's local day, both ends included (YYYY-MM-DD)
    from: '2026-11-12',
    until: '2026-11-13',
    image: 'images/sambutan-audit-2026.webp',
    // Words around the poster (canvas design "Poster sambutan"). Title and
    // text show beside the poster on wide landscape screens; phones show the
    // kicker and the button only (the title stays for screen readers).
    kicker: 'Lawatan audit · Jumaat, 13/11/2026',
    title: 'Selamat datang ke Pusat Alumni UPSI',
    text: 'Terima kasih atas kunjungan sempena Audit Pensijilan Semula ISO 9001:2015 '
        + 'Universiti Pendidikan Sultan Idris Tahun 2026.',
    note: 'Prestasi KPI Pusat Alumni 2026',
    // The poster's words are part of the image, so screen readers get them here
    alt: 'Selamat Datang Puan Sarasvathy a/p Sundara Pathar, Juruaudit SIRIM QAS '
        + 'International Sdn. Bhd., ke Pusat Alumni, Universiti Pendidikan Sultan Idris, '
        + 'pada 13 November 2026 (Jumaat) bagi Audit Pensijilan Semula ISO 9001:2015 '
        + 'Universiti Pendidikan Sultan Idris Tahun 2026.'
};

const SEEN_KEY = 'welcome_seen_' + WELCOME.key;

// sessionStorage can throw (private mode, blocked site data); then the poster
// simply shows on each load during the window.
const seen = () => { try { return !!sessionStorage.getItem(SEEN_KEY); } catch (_) { return false; } };
const rememberSeen = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (_) {} };

const localDay = (d) => d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');

function forcedByUrl() {
    try { return new URLSearchParams(location.search).get('sambutan') === '1'; } catch (_) { return false; }
}

export function initWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    const poster = document.getElementById('welcome-poster');
    const enterBtn = document.getElementById('welcome-enter-btn');
    if (!overlay || !poster || !enterBtn) return;

    const today = localDay(new Date());
    const inWindow = today >= WELCOME.from && today <= WELCOME.until;
    if (!forcedByUrl() && (!inWindow || seen())) return;

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('welcome-kicker', WELCOME.kicker);
    setText('welcome-title', WELCOME.title);
    setText('welcome-text', WELCOME.text);
    setText('welcome-note', WELCOME.note);

    // The image is only requested when the poster is due, never on other days
    poster.alt = WELCOME.alt;
    poster.src = WELCOME.image;
    const backdrop = overlay.querySelector('.welcome-backdrop');
    if (backdrop) backdrop.style.backgroundImage = `url("${WELCOME.image}")`;

    // Counted as seen once shown, so every way of closing it (button, a click
    // beside the poster, or Escape via the shared handler in ui.js) holds
    // for the rest of the session.
    rememberSeen();
    overlay.classList.remove('hidden');
    syncBodyScrollLock();
    enterBtn.focus({ preventScroll: true });

    const close = () => {
        overlay.classList.add('hidden');
        syncBodyScrollLock();
    };
    enterBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        // Empty space only: the poster and the words do not close it
        if (e.target === overlay || e.target.classList.contains('welcome-stage')
            || e.target.classList.contains('welcome-backdrop')) close();
    });
}
