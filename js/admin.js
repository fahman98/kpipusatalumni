// --- JS/ADMIN.JS ---
import { openModal, closeModal, showToastNotification } from './ui.js';

let glitchTimeout;
let bootSequenceTimeouts = [];
let failedAttempts = 0;
let isLocked = false;

// Helper to get element safely
const getEl = (id) => document.getElementById(id);

// Export reset function to allow UI to use it
export function resetTerminalModal() {
    const modal = getEl('password-modal');
    if (!modal) return;

    const inputArea = getEl('terminal-input-area');
    const feedback = getEl('terminal-feedback');
    const body = modal.querySelector('.terminal-body');
    const passwordInput = getEl('password-input');
    const emailInput = getEl('email-input');
    
    // Clear logs but keep structure
    const bootLogs = body.querySelectorAll('.boot-log, .logout-log');
    bootLogs.forEach(log => log.remove());
    
    if(inputArea) inputArea.classList.add('hidden');
    
    if(feedback) {
        feedback.textContent = '';
        feedback.className = 'terminal-text mt-4 h-6 font-bold';
    }
    
    // Clear timeouts
    bootSequenceTimeouts.forEach(timeout => clearTimeout(timeout));
    bootSequenceTimeouts = [];
    
    clearTimeout(glitchTimeout);
    const terminalWindow = getEl('terminal-window');
    if(terminalWindow) terminalWindow.classList.remove('terminal-glitch');

    failedAttempts = 0;
    isLocked = false;
    
    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.disabled = false;
        passwordInput.classList.remove('input-disabled');
    }
    if (emailInput) {
        emailInput.value = '';
        emailInput.disabled = false;
        emailInput.classList.remove('input-disabled');
    }
}

// Add event listener for custom modal-close event from UI
document.addEventListener('modal-closed', (e) => {
    if(e.detail && e.detail.modalId === 'password-modal') {
        resetTerminalModal();
    }
});

// Terminal Effect Functions
export function randomGlitch() {
    const terminalWindow = getEl('terminal-window');
    const modal = getEl('password-modal');
    
    if (!terminalWindow || !modal || !modal.classList.contains('is-open')) return;
    
    terminalWindow.classList.add('terminal-glitch');
    
    setTimeout(() => {
        terminalWindow.classList.remove('terminal-glitch');
    }, 200);
    
    const nextGlitchTime = Math.random() * 4000 + 2000;
    glitchTimeout = setTimeout(randomGlitch, nextGlitchTime);
}

export function runBootSequence() {
    const body = getEl('terminal-body');
    const inputArea = getEl('terminal-input-area');
    
    if (!body || !inputArea) return;

    const bootMessages = [
        "> INITIALIZING KERNEL...",
        "> CHECKING MEMORY MAP: 00000000 - 0009FC00 [OK]",
        "> LOADING DRIVERS...",
        "> MOUNTING FILE SYSTEM (RW)...",
        "> STARTING NETWORKING SERVICE...",
        "> CONNECTING TO SECURE SERVER...",
        "> [ OK ] CONNECTED: 192.168.1.105",
        "> LOADING SECURITY MODULES...",
        "> DECRYPTING LOGIN INTERFACE...",
        "> SYSTEM READY."
    ];

    let delay = 0;
    
    bootMessages.forEach((msg, index) => {
        const timeoutId = setTimeout(() => {
            const p = document.createElement('p');
            p.className = 'terminal-text boot-log';
            p.textContent = msg;
            body.insertBefore(p, inputArea);
            body.scrollTop = body.scrollHeight;
            
            if (index === bootMessages.length - 1) {
                setTimeout(() => {
                    inputArea.classList.remove('hidden');
                    const emailInput = getEl('email-input');
                    if(emailInput) emailInput.focus();
                    body.scrollTop = body.scrollHeight;
                }, 300);
            }
        }, delay);
        
        bootSequenceTimeouts.push(timeoutId);
        delay += Math.floor(Math.random() * 150) + 50; 
    });
}

function triggerLockdown() {
    const passwordInput = getEl('password-input');
    const emailInput = getEl('email-input');
    const feedback = getEl('terminal-feedback');
    
    isLocked = true;
    
    if(passwordInput) {
        passwordInput.disabled = true;
        passwordInput.classList.add('input-disabled');
    }
    if(emailInput) {
        emailInput.disabled = true;
        emailInput.classList.add('input-disabled');
    }

    let timeLeft = 10;
    
    if(feedback) {
        feedback.textContent = `> SYSTEM LOCKDOWN INITIATED. COOLDOWN: ${timeLeft}s`;
        feedback.className = "terminal-text mt-4 h-6 terminal-lockout";
    }

    const countdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            if(feedback) feedback.textContent = `> SYSTEM LOCKDOWN INITIATED. COOLDOWN: ${timeLeft}s`;
        } else {
            clearInterval(countdownInterval);
            isLocked = false;
            failedAttempts = 0;
            
            if(passwordInput) {
                passwordInput.disabled = false;
                passwordInput.classList.remove('input-disabled');
            }
            if(emailInput) {
                emailInput.disabled = false;
                emailInput.classList.remove('input-disabled');
                emailInput.focus();
            }
            
            if(feedback) {
                feedback.textContent = "> COOLDOWN COMPLETE. RETRY AUTHORIZED.";
                feedback.className = "terminal-text mt-4 h-6 font-bold";
            }
        }
    }, 1000);
}

export function handleAdminLogin() {
    if (isLocked) return; 
    
    const emailInput = getEl('email-input');
    const passwordInput = getEl('password-input');
    const feedback = getEl('terminal-feedback');
    const passwordModal = getEl('password-modal');
    
    const email = emailInput ? emailInput.value : '';
    const password = passwordInput ? passwordInput.value : '';
    
    if(!email || !password) {
         if(feedback) {
             feedback.textContent = "> ERROR: MISSING CREDENTIALS.";
             feedback.classList.add('access-denied');
         }
         return;
    }

    if(feedback) {
        feedback.textContent = "> VERIFYING ENCRYPTED KEYS...";
        feedback.className = "terminal-text mt-4 h-6 font-bold";
    }
    
    firebase.auth().signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
             if(feedback) {
                 feedback.textContent = "> [ACCESS GRANTED] PERMISSIONS UPDATED.";
                 feedback.classList.add('access-granted');
             }
             
             setTimeout(() => {
                 closeModal(passwordModal);
                 if(emailInput) emailInput.value = '';
                 if(passwordInput) passwordInput.value = '';
             }, 1000);
        })
        .catch((error) => {
            console.error("Login failed:", error);
            failedAttempts++;
            if (failedAttempts >= 3) {
                triggerLockdown();
            } else {
                if(feedback) {
                    feedback.textContent = `> [ACCESS DENIED] ${error.code.replace('auth/', '').toUpperCase()}`;
                    feedback.classList.add('access-denied');
                }
            }
        });
}

// --- NEW LOGOUT SEQUENCE FUNCTION (FIXED) ---
export function runLogoutSequence() {
    resetTerminalModal();
    const modal = getEl('password-modal');
    openModal(modal); // Show terminal
    randomGlitch();
    
    const body = getEl('terminal-body');
    const inputArea = getEl('terminal-input-area');
    
    if(inputArea) inputArea.classList.add('hidden'); // Hide inputs for logout

    const logs = [
        "> INITIATING LOGOUT SEQUENCE...",
        "> REVOKING ADMIN PRIVILEGES...",
        "> CLOSING SECURE CONNECTION...",
        "> [SESSION TERMINATED] GOODBYE."
    ];

    let delay = 0;
    logs.forEach((log, index) => {
        setTimeout(() => {
            const p = document.createElement('p');
            p.className = 'terminal-text logout-log';
            p.textContent = log;
            if(body) {
                body.insertBefore(p, inputArea);
                body.scrollTop = body.scrollHeight;
            }
            if (index === logs.length - 1) {
                p.classList.add('access-denied'); 
            }
        }, delay);
        delay += 600;
    });

    // Actual Sign Out after animation
    setTimeout(() => {
        firebase.auth().signOut().then(() => {
            closeModal(modal); // Close terminal first
            // FORCE RELOAD to clear state and return to Guest Mode
            window.location.reload(); 
        }).catch((error) => {
            console.error("Logout error:", error);
            closeModal(modal);
            window.location.reload(); // Reload anyway to be safe
        });
    }, delay + 800);
}