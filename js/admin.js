// --- JS/ADMIN.JS ---
import { closeModal, showLoading, showToastNotification } from './ui.js';
import { isAdminUser } from './auth.js';

let failedAttempts = 0;
let isLocked = false;
let lockCountdown = null;

const MAX_ATTEMPTS = 3;
const LOCK_SECONDS = 10;
const SS_LOCK_UNTIL = 'kpi_admin_lock_until';
const SS_ATTEMPTS = 'kpi_admin_attempts';

// Helper to get element safely
const getEl = (id) => document.getElementById(id);

// sessionStorage can throw (private mode, blocked site data) — a lockout that
// can't be persisted still works for this page, it just won't survive a reload.
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
const ssDel = (k) => { try { sessionStorage.removeItem(k); } catch (_) {} };

// Plain-language reasons for the Firebase error codes an admin can actually hit.
// Wrong email and wrong password share one message on purpose: telling them
// apart would confirm which addresses have an account.
const AUTH_ERRORS = {
    'auth/invalid-email': 'Format emel tidak sah.',
    'auth/user-not-found': 'Emel atau kata laluan tidak sah.',
    'auth/wrong-password': 'Emel atau kata laluan tidak sah.',
    'auth/invalid-credential': 'Emel atau kata laluan tidak sah.',
    'auth/invalid-login-credentials': 'Emel atau kata laluan tidak sah.',
    'auth/user-disabled': 'Akaun ini telah dinyahaktifkan.',
    'auth/too-many-requests': 'Terlalu banyak cubaan. Sila cuba sebentar lagi.',
    'auth/network-request-failed': 'Tiada sambungan internet. Sila cuba lagi.',
};

// type: 'error' | 'success' | 'info'
function setFeedback(message, type = 'info') {
    const feedback = getEl('login-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.classList.toggle('hidden', !message);
    feedback.classList.remove('is-error', 'is-success', 'is-info');
    if (message) feedback.classList.add(`is-${type}`);
}

function setFormDisabled(disabled) {
    ['email-input', 'password-input', 'password-submit-btn'].forEach(id => {
        const el = getEl(id);
        if (el) el.disabled = disabled;
    });
}

function setSubmitting(submitting) {
    const label = getEl('login-submit-label');
    if (label) label.textContent = submitting ? 'Menyemak...' : 'Log Masuk';
    setFormDisabled(submitting);
}

// Return the modal to a clean state. Called on open and on close.
export function resetLoginModal() {
    const passwordInput = getEl('password-input');
    const emailInput = getEl('email-input');
    const toggle = getEl('password-toggle');

    setFeedback('');
    setSubmitting(false);
    if (emailInput) emailInput.value = '';
    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.type = 'password';
    }
    if (toggle) {
        toggle.setAttribute('aria-pressed', 'false');
        toggle.setAttribute('aria-label', 'Tunjuk kata laluan');
        toggle.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i>';
    }

    // A lockout outlives the modal: closing and reopening it must not reset
    // the countdown, so pick it back up from sessionStorage.
    const lockUntil = parseInt(ssGet(SS_LOCK_UNTIL) || '0', 10);
    if (Date.now() < lockUntil) {
        failedAttempts = parseInt(ssGet(SS_ATTEMPTS) || String(MAX_ATTEMPTS), 10);
        startLockCountdown(lockUntil);
    } else if (!isLocked) {
        failedAttempts = 0;
        ssDel(SS_LOCK_UNTIL);
        ssDel(SS_ATTEMPTS);
    }
}

// Add event listener for custom modal-close event from UI
document.addEventListener('modal-closed', (e) => {
    if (e.detail && e.detail.modalId === 'password-modal') {
        resetLoginModal();
    }
});

// Show / hide the password so a long password can be checked before sending.
document.addEventListener('click', (e) => {
    const toggle = e.target.closest('#password-toggle');
    if (!toggle) return;
    const input = getEl('password-input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Sembunyi kata laluan' : 'Tunjuk kata laluan');
    toggle.innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
    input.focus();
});

function startLockCountdown(lockUntil) {
    isLocked = true;
    setSubmitting(false);
    setFormDisabled(true);
    clearInterval(lockCountdown);

    const tick = () => {
        const left = Math.ceil((lockUntil - Date.now()) / 1000);
        if (left > 0) {
            setFeedback(`Terlalu banyak cubaan gagal. Cuba lagi dalam ${left} saat.`, 'error');
            return;
        }
        clearInterval(lockCountdown);
        isLocked = false;
        failedAttempts = 0;
        ssDel(SS_LOCK_UNTIL);
        ssDel(SS_ATTEMPTS);
        setFormDisabled(false);
        setFeedback('Anda boleh cuba log masuk semula.', 'info');
        const emailInput = getEl('email-input');
        if (emailInput) emailInput.focus();
    };
    tick();
    lockCountdown = setInterval(tick, 1000);
}

function registerFailure(message) {
    failedAttempts++;
    if (failedAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + LOCK_SECONDS * 1000;
        ssSet(SS_LOCK_UNTIL, String(lockUntil));
        ssSet(SS_ATTEMPTS, String(failedAttempts));
        startLockCountdown(lockUntil);
        return;
    }
    setSubmitting(false);
    setFeedback(message, 'error');
    const passwordInput = getEl('password-input');
    if (passwordInput) { passwordInput.value = ''; passwordInput.focus(); }
}

export function handleAdminLogin() {
    // Sync dari sessionStorage — tangani kes modal ditutup & dibuka semula semasa lockout
    const storedLockUntil = parseInt(ssGet(SS_LOCK_UNTIL) || '0', 10);
    if (Date.now() < storedLockUntil) {
        startLockCountdown(storedLockUntil);
        return;
    }
    if (isLocked) return;

    const emailInput = getEl('email-input');
    const passwordInput = getEl('password-input');
    const passwordModal = getEl('password-modal');

    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) {
        setFeedback('Sila isi emel dan kata laluan.', 'error');
        (email ? passwordInput : emailInput)?.focus();
        return;
    }

    setFeedback('');
    setSubmitting(true);

    // SESSION persistence: the admin login ends when the browser (or tab) is
    // closed instead of staying signed in on that computer indefinitely. If
    // the browser refuses (storage blocked), sign in anyway rather than lock
    // the admin out; the idle logout below still applies.
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION)
        .catch((err) => console.warn('setPersistence(SESSION) failed:', err))
        .then(() => firebase.auth().signInWithEmailAndPassword(email, password))
        .then((userCredential) => {
            // Firebase menerima MANA-MANA akaun sah dalam projek ini. Hanya
            // email admin yang layak — tolak yang lain di sini supaya pengguna
            // dapat sebab yang jelas, bukan ditendang senyap oleh main.js.
            if (!isAdminUser(userCredential.user)) {
                firebase.auth().signOut().catch(() => {});
                registerFailure('Akaun ini tiada kebenaran admin.');
                return;
            }

            // Clear lockout state on successful login
            ssDel(SS_LOCK_UNTIL);
            ssDel(SS_ATTEMPTS);
            failedAttempts = 0;

            // main.js shows the welcome toast once the auth state flips.
            closeModal(passwordModal);
        })
        .catch((error) => {
            console.error("Login failed:", error);
            registerFailure(AUTH_ERRORS[error && error.code] || 'Log masuk gagal. Sila cuba lagi.');
        });
}

// Sign out, then reload so every view falls back to Guest Mode cleanly.
export function runLogoutSequence() {
    showLoading('Log keluar...');
    firebase.auth().signOut()
        .catch((error) => {
            console.error("Logout error:", error);
            showToastNotification('Log keluar gagal, memuat semula halaman.', 'danger');
        })
        .finally(() => window.location.reload());
}

// --- IDLE LOGOUT -----------------------------------------------------------
// An admin left signed in on a shared office PC or an event-counter laptop
// could have their data changed by whoever sat down next. After 30 minutes
// with no pointer / key / scroll activity the admin is signed out, with a
// warning 2 minutes before. Runs only while signed in as admin.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const IDLE_WARN_MS = 2 * 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
export const IDLE_LOGOUT_FLAG = 'kpi_idle_logout';

let idleWatching = false;
let lastActivity = 0;
let idleTimer = null;
let warnTimer = null;

function scheduleIdleTimers() {
    clearTimeout(idleTimer);
    clearTimeout(warnTimer);
    warnTimer = setTimeout(() => {
        showToastNotification('Tiada aktiviti dikesan. Anda akan dilog keluar dalam 2 minit.', 'info');
    }, IDLE_LIMIT_MS - IDLE_WARN_MS);
    idleTimer = setTimeout(idleLogout, IDLE_LIMIT_MS);
}

function onActivity() {
    const now = Date.now();
    if (now - lastActivity < 5000) return;   // rescheduling on every scroll frame is wasteful
    lastActivity = now;
    scheduleIdleTimers();
}

// Background tabs and a sleeping laptop can delay timers well past 30
// minutes, so check the elapsed time directly when the page comes back.
function onVisibility() {
    if (document.visibilityState === 'visible' && Date.now() - lastActivity >= IDLE_LIMIT_MS) {
        idleLogout();
    }
}

function idleLogout() {
    if (!idleWatching) return;
    stopIdleLogout();
    ssSet(IDLE_LOGOUT_FLAG, '1');   // main.js explains it after the reload
    runLogoutSequence();
}

export function startIdleLogout() {
    if (idleWatching) return;
    idleWatching = true;
    lastActivity = Date.now();
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    scheduleIdleTimers();
}

export function stopIdleLogout() {
    if (!idleWatching) return;
    idleWatching = false;
    clearTimeout(idleTimer);
    clearTimeout(warnTimer);
    ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity, { capture: true }));
    document.removeEventListener('visibilitychange', onVisibility);
}
