// --- JS/ADMIN-TABLE.JS ---
// Admin desktop layout (redesign canvas, Admin-Main): from 1024px wide an
// admin sees the KPIs as a management table, with "Perlu tindakan" and a
// short save-status box beside it, instead of the card grid.
//
// The cards stay in the DOM (hidden by CSS) and every button in the table
// clicks the matching button on its card, the same way the phone KPI sheet
// does, so each action keeps exactly one implementation and this module
// never writes anything itself.

import { escapeHtml, kpiIcon, getKpiPercentage, calculateKpiValue } from './ui.js';
import { statusTier, statusHex, kpiStatusPct, STATUS_LABEL } from './status.js';

const DESK_QUERY = window.matchMedia('(min-width: 1024px)');
let adminOn = false;
let todoHome = null;   // where #admin-todo sits outside the admin layout

function valueText(kpi) {
    const v = calculateKpiValue(kpi);
    if (kpi.isPercentage) return `${v.toFixed(1)}%`;
    if (kpi.isCurrency) return `RM ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return Math.floor(v).toLocaleString('en-US');
}

function targetText(kpi) {
    if (kpi.isPercentage) return '100%';
    return typeof kpi.target === 'number'
        ? (kpi.isCurrency ? 'RM ' : '') + kpi.target.toLocaleString('en-US')
        : '-';
}

// What kind of data sits behind the KPI, so the admin knows what the main
// button will open
function kindText(kpi) {
    const d = kpi.details;
    if (!d) return kpi.isPercentage ? 'Skor peratus' : 'Nilai terus';
    if (d.type === 'breakdownList') {
        const items = Array.isArray(d.items) ? d.items : [];
        const label = kpi.isCurrency ? 'Rekod RM'
            : items.some(it => it && it.tarikh) ? 'Program bertarikh' : 'Senarai butiran';
        return `${label} · ${items.length}`;
    }
    if (d.type === 'list') return `Senarai sasaran · ${(d.targetList || []).length}`;
    if (d.type === 'progressList') return `Skor peratus · ${(d.items || []).length}`;
    return 'Butiran';
}

function cardOf(kpiId) {
    const grid = document.getElementById('kpi-grid-container');
    return grid ? grid.querySelector(`.kpi-card[data-kpi-id="${CSS.escape(kpiId)}"]`) : null;
}

// A card button the table may borrow: present and not switched off
function cardButton(kpiId, selector) {
    const card = cardOf(kpiId);
    const btn = card && card.querySelector(selector);
    if (!btn || btn.style.display === 'none') return null;
    return btn;
}

function primaryAction(kpi) {
    if (kpi.details && cardButton(kpi.id, '.show-details-btn')) {
        return { selector: '.show-details-btn', label: kpi.isCurrency ? 'Urus rekod' : 'Urus butiran' };
    }
    if (cardButton(kpi.id, '.edit-kpi-btn')) {
        return { selector: '.edit-kpi-btn', label: kpi.isPercentage ? 'Kemas kini skor' : 'Kemas kini nilai' };
    }
    return null;
}

export function renderAdminTable(kpis, overall) {
    const body = document.getElementById('admin-table-body');
    if (!body) return;
    const avg = document.getElementById('admin-table-avg');
    if (avg) avg.textContent = `${overall.toFixed(1)}%`;
    const count = document.getElementById('admin-table-count');
    if (count) count.textContent = `${kpis.length} KPI`;

    body.innerHTML = kpis.map(kpi => {
        const pct = getKpiPercentage(kpi);
        const sPct = kpiStatusPct(kpi, pct);
        const tier = statusTier(sPct);
        const primary = primaryAction(kpi);
        const iconBtn = (selector, icon, label) => cardButton(kpi.id, selector)
            ? `<button type="button" class="admin-icon-btn" data-click="${selector}" aria-label="${label}" title="${label}"><i class="fas ${icon}" aria-hidden="true"></i></button>`
            : '';
        return `
        <tr class="admin-row" data-kpi-id="${escapeHtml(kpi.id)}" data-tier="${tier}">
            <td class="c-name">
                <div class="admin-kpi">
                    <span class="admin-kpi-icon" aria-hidden="true"><i class="ph-duotone ${kpiIcon(kpi)}"></i></span>
                    <span class="admin-kpi-text">
                        <span class="admin-kpi-name">${escapeHtml(kpi.name)}</span>
                        <span class="admin-kpi-kind">${escapeHtml(kindText(kpi))}</span>
                    </span>
                </div>
            </td>
            <td class="c-val"><strong>${escapeHtml(valueText(kpi))}</strong> <span>/ ${escapeHtml(targetText(kpi))}</span></td>
            <td class="c-pct">
                <div class="admin-pct">
                    <span class="admin-bar" aria-hidden="true"><span style="width:${Math.min(pct, 100).toFixed(2)}%;background:${statusHex(sPct)}"></span></span>
                    <span class="admin-pct-num">${Math.min(pct, 999).toFixed(1)}%</span>
                </div>
                <span class="admin-tier admin-tier-${tier}">${STATUS_LABEL[tier]}</span>
            </td>
            <td class="c-act">
                <div class="admin-actions">
                    ${primary ? `<button type="button" class="admin-primary-btn" data-click="${primary.selector}">${primary.label}</button>` : ''}
                    ${iconBtn('.show-chart-btn', 'fa-chart-line', 'Sejarah prestasi')}
                    ${iconBtn('.info-btn', 'fa-align-left', 'Edit deskripsi')}
                    ${iconBtn('.settings-btn', 'fa-cog', 'Tetapan KPI')}
                </div>
            </td>
        </tr>`;
    }).join('');
}

// Table buttons: click the same button on the hidden card
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#admin-table-body [data-click]');
    if (!btn) return;
    const row = btn.closest('.admin-row');
    const target = row && cardButton(row.dataset.kpiId, btn.dataset.click);
    if (target) target.click();
});

// Online state for the "Simpanan" box. It says only what the app knows:
// whether changes can reach the server right now.
function renderSaveStatus() {
    const el = document.getElementById('admin-save-status');
    if (!el) return;
    const online = navigator.onLine;
    el.className = `admin-save-status ${online ? 'is-online' : 'is-offline'}`;
    el.textContent = online
        ? 'Disambungkan ke pelayan. Perubahan disimpan serta-merta.'
        : 'Luar talian. Perubahan tidak dapat disimpan sehingga sambungan pulih.';
}
window.addEventListener('online', renderSaveStatus);
window.addEventListener('offline', renderSaveStatus);

// Switches between the admin table and the normal card layout. `#admin-todo`
// moves into the side column while the table shows and back afterwards.
export function syncAdminLayout(isAdmin) {
    adminOn = !!isAdmin;
    const on = adminOn && DESK_QUERY.matches;
    document.body.classList.toggle('admin-desk-on', on);
    const todo = document.getElementById('admin-todo');
    const aside = document.getElementById('admin-aside');
    if (todo && aside) {
        if (!todoHome) todoHome = { parent: todo.parentNode, next: todo.nextSibling };
        if (on && todo.parentNode !== aside) aside.insertBefore(todo, aside.firstChild);
        else if (!on && todo.parentNode === aside) todoHome.parent.insertBefore(todo, todoHome.next);
    }
    if (on) renderSaveStatus();
}
DESK_QUERY.addEventListener('change', () => syncAdminLayout(adminOn));

// Header shortcuts reuse the existing buttons further down the page
document.addEventListener('click', (e) => {
    if (e.target.closest('#admin-add-kpi-btn')) document.getElementById('open-add-kpi-modal-btn')?.click();
    if (e.target.closest('#admin-history-btn')) document.getElementById('history-open-btn')?.click();
});
