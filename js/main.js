// --- JS/MAIN.JS ---
import {
    renderSkeletons,
    createKpiCard,
    animateCardElements,
    getKpiPercentage,
    showToastNotification,
    openModal,
    closeModal,
    setEditMode,
    isEditMode,
    calculateKpiValue,
    filterDashboardCards,
    showDetailsModal,
    showConfirmModal,
    showInputModal,
    getPhosphorIcon,
} from './ui.js';

import {
    subscribeToQuarterData,
    setApiYear,
    selectedYear,
    kpiDataCache,
    addNewKpi,
    updateKpiStructure,
    deleteKpi,
    cloneFromYear,
    updateKpiValueInFirestore,
    updateKpiDescriptionInFirestore,
    getKpiDataFromFirestore,
    saveBulkKpiValues,
    subscribeLastUpdated
} from './api.js';

import { renderGaugeChart, showHistoryChart, destroyKpiChart } from './charts.js';
import { handleAdminLogin, resetTerminalModal, runBootSequence, randomGlitch, runLogoutSequence } from './admin.js';
import { initTakwim } from './takwim.js';
import { initPenjanaan } from './penjanaan.js';
import { statusTier, statusHex } from './status.js';

document.addEventListener('DOMContentLoaded', () => {

    // Helper for Selectors
    const getEl = (id) => document.getElementById(id);

    // DOM Elements
    const mainTitle = getEl('main-title');
    const subTitle = getEl('sub-title');
    const footerNote = getEl('footer-note');
    const mainContentWrapper = getEl('main-content-wrapper');
    const topAchiever = getEl('top-achiever');
    const mainFocus = getEl('main-focus');
    const modeIndicator = getEl('mode-indicator');

    const adminLoginBtn = getEl('admin-login-btn');
    const adminLogoutBtn = getEl('admin-logout-btn');
    const passwordModal = getEl('password-modal');
    const passwordModalClose = getEl('password-modal-close');
    const passwordSubmitBtn = getEl('password-submit-btn');
    const emailInput = getEl('email-input');
    const passwordInput = getEl('password-input');



    const editDescModal = getEl('edit-desc-modal');
    const editDescModalClose = getEl('edit-desc-modal-close');
    const saveDescBtn = getEl('save-desc-btn');
    const cancelDescBtn = getEl('cancel-desc-btn');
    const descInput = getEl('desc-input');

    const kpiGridContainer = getEl('kpi-grid-container');
    const paginationContainer = getEl('pagination');
    const chartModal = getEl('chart-modal');
    const detailsModal = getEl('details-modal');
    const emptyStateContainer = getEl('empty-state-container');
    const adminSetupActions = getEl('admin-setup-actions');
    const yearSelector = getEl('year-selector');

    const addKpiModal = getEl('add-kpi-modal');
    const editStructureModal = getEl('edit-structure-modal');
    const inputModal = getEl('input-modal');
    const confirmModal = getEl('confirm-modal');

    const searchInput = getEl('dashboard-search-input');
    const statusFilter = getEl('dashboard-status-filter');

    const statsBar = getEl('stats-bar');

    const mainNav = getEl('main-nav');
    const viewDashboard = getEl('view-dashboard');
    const viewTakwim = getEl('view-takwim');
    const viewPenjanaan = getEl('view-penjanaan');
    let currentView = 'dashboard';

    const bulkEditModal = getEl('bulk-edit-modal');
    const exportPdfBtn = getEl('export-pdf-btn');
    const notifyBtn = getEl('notify-btn');
    const offlineBanner = getEl('offline-banner');
    const adminRibbon = getEl('admin-mode-ribbon');
    const achieverPanel = getEl('achiever-panel');

    // CRUD Forms
    const addKpiForm = getEl('add-kpi-form');
    const openAddKpiBtn = getEl('open-add-kpi-modal-btn');
    const startFreshBtn = getEl('start-fresh-btn');
    const cloneBtn = getEl('clone-prev-year-btn');
    const editStructureForm = getEl('edit-structure-form');
    const deleteKpiBtn = getEl('delete-kpi-btn');
    const addKpiClose = getEl('add-kpi-modal-close');
    const editStructClose = getEl('edit-structure-modal-close');

    // Chart & Toast
    const overallChartBtn = getEl('show-overall-chart-btn');
    const toastCloseBtn = getEl('toast-close-btn');

    let currentQuarter = 'q1';
    let quarterSwitchTimeout = null;

    // --- GLOBAL "DATA DIKEMASKINI" FOOTER ---
    // Driven by a single per-year marker bumped by ANY write (KPI / Penjanaan /
    // Takwim). Falls back to the viewed quarter's footerDate until that marker
    // exists for the year.
    let lastUpdatedLabel = null;
    let quarterFooterDate = '';
    let unsubLastUpdated = null;

    function renderFooter() {
        if (!footerNote) return;
        const label = lastUpdatedLabel || quarterFooterDate;
        footerNote.textContent = label ? `Data dikemaskini pada ${label}.` : '';
    }

    function subscribeFooter(year) {
        if (unsubLastUpdated) { unsubLastUpdated(); unsubLastUpdated = null; }
        lastUpdatedLabel = null;
        renderFooter();
        unsubLastUpdated = subscribeLastUpdated(year, (label) => {
            lastUpdatedLabel = label;
            renderFooter();
        });
    }

    // --- INITIALIZE YEAR (DYNAMIC) ---
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;

    if (yearSelector) {
        for (let y = prevYear; y <= currentYear + 1; y++) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            if (y === currentYear) opt.selected = true;
            yearSelector.appendChild(opt);
        }
        setApiYear(String(currentYear));
    }
    // NOTE: footer subscription is started inside initializeApp() once Firebase
    // auth has settled, so every Firestore listener (KPI + footer) is created
    // AFTER anonymous sign-in. Subscribing here (pre-auth) caused listener churn
    // that left Suku 1 blank on first load.

    // Update admin action button labels with dynamic years
    const cloneBtnLabel = document.getElementById('clone-btn-label');
    if (cloneBtnLabel) cloneBtnLabel.textContent = `Copy Struktur ${prevYear}`;
    const reCloneBtnLabel = document.getElementById('reclone-btn-label');
    if (reCloneBtnLabel) reCloneBtnLabel.textContent = `Fix/Reset ${prevYear}`;

    const initiallyLoadedQuarters = new Set();

    // --- MAIN FUNCTION: UPDATE DASHBOARD ---
    window.updateDashboard = function (quarterKey) {
        currentQuarter = quarterKey;
        initiallyLoadedQuarters.delete(quarterKey);

        // Quarter transition: fade out existing grid
        if (kpiGridContainer && kpiGridContainer.children.length > 0) {
            kpiGridContainer.classList.add('grid-exit');
        }

        // 1. Set Title Serta-merta
        if (mainTitle) {
            const qMap = { 'q1': 'Suku Pertama', 'q2': 'Suku Kedua', 'q3': 'Suku Ketiga', 'q4': 'Suku Keempat' };
            mainTitle.innerHTML = `Dashboard KPI ${selectedYear} <br> ${qMap[quarterKey]}`;
        }

        // 2. Reset View states
        if (mainContentWrapper) mainContentWrapper.classList.add('hidden');
        if (emptyStateContainer) emptyStateContainer.classList.add('hidden');

        // 3. Show skeletons only if cache is empty
        if (!kpiDataCache[quarterKey]) {
            renderSkeletons();
        }

        // 4. Subscribe to Real-time Data
        subscribeToQuarterData(quarterKey, (currentData, previousData, isEmpty, error) => {

            // Handle Load Error State — show a clear retry panel, never leave the
            // skeletons spinning forever.
            if (error) {
                if (kpiGridContainer) {
                    kpiGridContainer.classList.remove('grid-exit');
                    kpiGridContainer.innerHTML = `
                    <div class="col-span-full flex flex-col items-center justify-center text-center p-10 bg-white rounded-xl shadow-sm border-2 border-dashed border-red-200">
                        <div class="bg-red-50 p-4 rounded-full mb-4">
                            <i class="ph-duotone ph-wifi-slash text-red-500 text-4xl"></i>
                        </div>
                        <h3 class="text-lg font-bold text-gray-700 mb-1">Gagal Memuatkan Data</h3>
                        <p class="text-gray-500 text-sm mb-4">${error.code === 'permission-denied' ? 'Tiada kebenaran membaca data.' : 'Semak sambungan internet anda dan cuba lagi.'}</p>
                        <button id="kpi-error-retry" class="bg-brand-primary text-white px-5 py-2 rounded-lg font-bold hover:bg-blue-800 transition-all text-sm flex items-center gap-2">
                            <i class="fas fa-sync-alt"></i><span>Cuba Lagi</span>
                        </button>
                    </div>`;
                    const retryBtn = getEl('kpi-error-retry');
                    if (retryBtn) retryBtn.addEventListener('click', () => window.updateDashboard(quarterKey));
                }
                if (mainContentWrapper) mainContentWrapper.classList.remove('hidden');
                if (emptyStateContainer) emptyStateContainer.classList.add('hidden');
                if (statsBar) statsBar.classList.add('hidden');
                if (achieverPanel) achieverPanel.classList.add('hidden');
                if (adminSetupActions) adminSetupActions.classList.add('hidden');
                if (mainTitle) mainTitle.innerHTML = `Dashboard KPI ${selectedYear} <br> Ralat Sambungan`;
                return;
            }

            // Handle Empty Year State
            if (isEmpty) {
                if (kpiGridContainer) kpiGridContainer.innerHTML = '';
                if (emptyStateContainer) emptyStateContainer.classList.remove('hidden');
                if (statsBar) statsBar.classList.add('hidden');
                if (achieverPanel) achieverPanel.classList.add('hidden');

                if (isEditMode) {
                    if (adminSetupActions) adminSetupActions.classList.remove('hidden');
                } else {
                    if (adminSetupActions) adminSetupActions.classList.add('hidden');
                }

                if (mainTitle) mainTitle.innerHTML = `Dashboard KPI ${selectedYear} <br> Tiada Data`;
                return;
            }

            // Handle Data Exists State
            if (emptyStateContainer) emptyStateContainer.classList.add('hidden');
            if (mainContentWrapper) mainContentWrapper.classList.remove('hidden');

            // Update Title
            if (mainTitle) mainTitle.innerHTML = `Dashboard KPI ${selectedYear} <br> ${currentData.title || quarterKey.toUpperCase()}`;
            if (subTitle) subTitle.textContent = (currentData.subtitle || '').replace(/[()]/g, '');
            if (currentData.footerDate) quarterFooterDate = currentData.footerDate;
            renderFooter();

            // Process KPIs
            const processedKpis = processKpisWithTrends(currentData.kpis, previousData ? previousData.kpis : null);

            // Buang Bicara Ramadan dari Penerbitan untuk tahun 2026 dan seterusnya
            if (parseInt(selectedYear) >= 2026) {
                processedKpis.forEach(kpi => {
                    if (kpi.id === 'penerbitan' && kpi.details && kpi.details.items) {
                        const filteredItems = kpi.details.items.filter(item => item.name !== 'Bicara Ramadan');
                        kpi.details = { ...kpi.details, items: filteredItems };
                        if (kpi.isPercentage && filteredItems.length > 0) {
                            let totalScore = 0;
                            filteredItems.forEach(item => {
                                if (item.subItems && item.subItems.length > 0) {
                                    totalScore += item.subItems.reduce((acc, sub) => acc + sub.value, 0) / item.subItems.length;
                                } else {
                                    totalScore += item.value;
                                }
                            });
                            kpi.value = totalScore / filteredItems.length;
                        }
                    }
                });
            }

            kpiDataCache[quarterKey].processedKpis = processedKpis;

            // Push notification on real-time updates (not on first load)
            if (!initiallyLoadedQuarters.has(quarterKey)) {
                initiallyLoadedQuarters.add(quarterKey);
            } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification('KPI Dikemaskini', {
                    body: `Data ${selectedYear} ${currentData.title || quarterKey.toUpperCase()} telah dikemaskini.`,
                    icon: 'https://cdn-icons-png.flaticon.com/512/8921/8921024.png'
                });
            }

            let totalPct = 0;
            let count = 0;
            let topKpi = null;
            let bottomKpi = null;
            let maxPercentage = -1;
            let minPercentage = 999999;
            let goodCount = 0, okCount = 0, badCount = 0;

            if (kpiGridContainer) {
                kpiGridContainer.classList.remove('grid-exit');
                kpiGridContainer.innerHTML = '';
            }

            processedKpis.forEach((kpi, index) => {
                const card = createKpiCard(kpi);
                if (kpiGridContainer) kpiGridContainer.appendChild(card);

                card.style.animationDelay = `${index * 50}ms`;
                animateCardElements(card, kpi);

                // Attach Listeners
                const editValBtn = card.querySelector('.edit-kpi-btn');
                if (editValBtn) {
                    editValBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (kpi.details && (kpi.details.items || (kpi.details.targetList && kpi.details.targetList.length > 0))) return;
                        const currentVal = calculateKpiValue(kpi);

                        // Month selector — only for 2026 and beyond
                        const showMonth = parseInt(selectedYear) >= 2026;
                        const qNum = parseInt(quarterKey.replace('q', ''));
                        const monthStart = (qNum - 1) * 3 + 1;
                        const monthEnd = qNum * 3;
                        const currentMonth = new Date().getMonth() + 1;
                        const defaultMonth = kpi.bulan
                            ? kpi.bulan
                            : (currentMonth >= monthStart && currentMonth <= monthEnd ? currentMonth : monthStart);

                        showInputModal(
                            `Kemaskini Nilai: ${kpi.name}`,
                            "Masukkan nilai pencapaian terkini:",
                            currentVal,
                            (newVal, bulan) => {
                                if (newVal !== null && String(newVal).trim() !== "") {
                                    const parsed = parseFloat(newVal);
                                    if (isNaN(parsed) || parsed < 0) {
                                        showToastNotification("Nilai tidak sah. Sila masukkan angka positif.", "danger");
                                        return;
                                    }
                                    if (kpi.isPercentage && parsed > 100) {
                                        showToastNotification("Nilai peratusan tidak boleh melebihi 100%.", "danger");
                                        return;
                                    }
                                    updateKpiValueInFirestore(quarterKey, kpi.id, parsed, showMonth ? bulan : null);
                                }
                            },
                            showMonth ? { showMonth: true, defaultMonth, monthRange: [monthStart, monthEnd] } : {}
                        );
                    });
                }

                const settingsBtn = card.querySelector('.settings-btn');
                if (settingsBtn) {
                    settingsBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openEditStructureModal(kpi);
                    });
                }

                const chartBtn = card.querySelector('.show-chart-btn');
                if (chartBtn) {
                    chartBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showHistoryChart(kpi.id, chartBtn);
                    });
                }

                const detailsBtn = card.querySelector('.show-details-btn');
                if (detailsBtn && kpi.details) {
                    detailsBtn.dataset.kpiId = kpi.id;
                    detailsBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showDetailsModal(kpi.id, detailsBtn);
                    });
                }

                const pct = getKpiPercentage(kpi);
                const cappedPct = Math.min(pct, 100);
                totalPct += cappedPct;
                count++;

                const tier = statusTier(pct);
                if (tier === 'good') goodCount++;
                else if (tier === 'ok') okCount++;
                else badCount++;

                if (pct > maxPercentage) {
                    maxPercentage = pct;
                    topKpi = kpi;
                }
                if (pct < minPercentage) {
                    minPercentage = pct;
                    bottomKpi = kpi;
                }
            });

            const overall = count > 0 ? totalPct / count : 0;
            renderGaugeChart(overall);
            updateFavicon(overall);
            document.title = `KPI ${overall.toFixed(0)}% · Pusat Alumni UPSI`;

            // Achiever Panel (#7)
            if (achieverPanel && count > 1 && topKpi && bottomKpi && topKpi.id !== bottomKpi.id) {
                achieverPanel.classList.remove('hidden');
                const topName = getEl('top-kpi-name');
                const topPct = getEl('top-kpi-pct');
                const bottomName = getEl('bottom-kpi-name');
                const bottomPct = getEl('bottom-kpi-pct');
                if (topName) topName.textContent = topKpi.name;
                if (topPct) topPct.textContent = `${getKpiPercentage(topKpi).toFixed(1)}%`;
                if (bottomName) bottomName.textContent = bottomKpi.name;
                if (bottomPct) bottomPct.textContent = `${getKpiPercentage(bottomKpi).toFixed(1)}%`;
            } else if (achieverPanel) {
                achieverPanel.classList.add('hidden');
            }

            // Update stats bar
            if (statsBar) {
                statsBar.classList.remove('hidden');
                const el = (id) => document.getElementById(id);
                if (el('stat-total')) el('stat-total').textContent = count;
                if (el('stat-good')) el('stat-good').textContent = goodCount;
                if (el('stat-ok')) el('stat-ok').textContent = okCount;
                if (el('stat-bad')) el('stat-bad').textContent = badCount;

                const goodPct = count > 0 ? (goodCount / count) * 100 : 0;
                const okPct   = count > 0 ? (okCount   / count) * 100 : 0;
                const badPct  = count > 0 ? (badCount  / count) * 100 : 0;
                if (el('stat-good-bar')) el('stat-good-bar').style.width = `${goodPct}%`;
                if (el('stat-ok-bar'))   el('stat-ok-bar').style.width   = `${okPct}%`;
                if (el('stat-bad-bar'))  el('stat-bad-bar').style.width  = `${badPct}%`;
                if (el('stat-all-good-bar')) el('stat-all-good-bar').style.width = `${goodPct}%`;
                if (el('stat-all-ok-bar'))   el('stat-all-ok-bar').style.width   = `${okPct}%`;
                if (el('stat-all-bad-bar'))  el('stat-all-bad-bar').style.width  = `${badPct}%`;
            }

            setEditMode(isEditMode);

            if (searchInput && statusFilter) {
                filterDashboardCards(searchInput.value, statusFilter.value);
            }

            // Show live indicator on first successful data load
            const liveIndicator = getEl('live-indicator');
            if (liveIndicator) liveIndicator.classList.replace('hidden', 'flex');

            // Quarter transition: fade in new grid
            if (kpiGridContainer) {
                kpiGridContainer.classList.add('grid-enter');
                setTimeout(() => kpiGridContainer.classList.remove('grid-enter'), 400);
            }

            // Refresh table view if active
            if (isTableView) renderTableView();
        });
    };

    // --- LOGIC HELPER ---
    function processKpisWithTrends(currentKpis, previousKpis) {
        if (!currentKpis) return [];
        return currentKpis.map(currentKpi => {
            const processedKpi = { ...currentKpi };
            if (previousKpis) {
                const previousKpi = previousKpis.find(p => p.id === currentKpi.id);
                if (previousKpi) {
                    const currentPercentage = getKpiPercentage(currentKpi);
                    const previousPercentage = getKpiPercentage(previousKpi);
                    const difference = currentPercentage - previousPercentage;
                    if (Math.abs(difference) < 0.01) {
                        processedKpi.trend = "Kekal";
                        processedKpi.trendColor = "text-gray-500";
                        processedKpi.trendIcon = "fa-minus";
                    } else if (difference > 0) {
                        processedKpi.trend = `+${difference.toFixed(2)}%`;
                        processedKpi.trendColor = "text-green-600";
                        processedKpi.trendIcon = "fa-arrow-up";
                    } else {
                        processedKpi.trend = `${difference.toFixed(2)}%`;
                        processedKpi.trendColor = "text-red-600";
                        processedKpi.trendIcon = "fa-arrow-down";
                    }
                }
            }
            return processedKpi;
        });
    }

    // --- AUTHENTICATION INIT ---
    function initializeApp() {
        firebase.auth().onAuthStateChanged(async (user) => {
            // FIRST-LOAD GUARD:
            // On a brand-new visit Firebase fires this twice — once with `null`,
            // then again with the anonymous user after sign-in completes. If we
            // loaded the dashboard on BOTH, two subscribeToQuarterData('q1') calls
            // would subscribe→kill→re-subscribe the SAME Firestore doc within a
            // few microtasks, and Firestore can drop the initial snapshot of the
            // relisten — leaving Suku 1 blank until the user switches quarters.
            //
            // So when nobody is signed in yet, kick off anonymous sign-in and
            // RETURN. The resulting auth-state change re-enters this handler with
            // the anonymous user and performs a single, clean load.
            if (!user) {
                try {
                    await firebase.auth().signInAnonymously();
                    return; // success → the anon auth-change will drive the load
                } catch (error) {
                    console.error("Anonymous auth error:", error);
                    // Sign-in failed (e.g. offline) — fall through and try to
                    // render anyway so the user is never stuck on a blank page.
                }
            }

            // Get active quarter from DOM
            const activeBtn = paginationContainer ? paginationContainer.querySelector('.active') : null;
            const activeQuarterKey = activeBtn ? `q${activeBtn.dataset.quarter}` : 'q1';

            // Force Sync API Year
            if (yearSelector) {
                setApiYear(yearSelector.value);
            }

            if (user && !user.isAnonymous) {
                // ADMIN MODE
                setEditMode(true);
                if (modeIndicator) modeIndicator.innerHTML = '<span class="inline-block bg-green-200 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-green-300">Mod Admin</span>';
                if (adminLogoutBtn) adminLogoutBtn.classList.remove('hidden');
                if (adminLoginBtn) adminLoginBtn.classList.add('hidden');
                if (adminRibbon) adminRibbon.classList.remove('hidden');

                showToastNotification(`Selamat datang, Admin (${user.email})`, "success");
            } else {
                // GUEST MODE (anonymous, or signed-out fallback)
                setEditMode(false);
                if (modeIndicator) modeIndicator.innerHTML = '<span class="inline-flex items-center bg-blue-100 text-blue-800 text-xs font-semibold px-2 md:px-2.5 py-1 rounded-full border border-blue-200 whitespace-nowrap"><i class="fas fa-eye md:mr-1"></i><span class="hidden md:inline">Paparan Awam</span></span>';
                if (adminLogoutBtn) adminLogoutBtn.classList.add('hidden');
                if (adminLoginBtn) adminLoginBtn.classList.remove('hidden');
                if (adminRibbon) adminRibbon.classList.add('hidden');

                // Hide admin specific elements immediately
                if (adminSetupActions) adminSetupActions.classList.add('hidden');
            }

            // Trigger Load (single, after auth has settled)
            window.updateDashboard(activeQuarterKey);
            subscribeFooter(selectedYear);
            renderCurrentView();
        });
    }



    // --- VIEW SWITCHING (Dashboard / Takwim / Penjanaan) ---
    function renderCurrentView() {
        if (currentView === 'takwim' && viewTakwim) {
            initTakwim(viewTakwim, isEditMode, selectedYear);
        } else if (currentView === 'penjanaan' && viewPenjanaan) {
            initPenjanaan(viewPenjanaan, isEditMode, selectedYear);
        }
    }

    function switchView(view) {
        if (!['dashboard', 'takwim', 'penjanaan'].includes(view)) view = 'dashboard';
        currentView = view;

        if (viewDashboard) viewDashboard.classList.toggle('hidden', view !== 'dashboard');
        if (viewTakwim) viewTakwim.classList.toggle('hidden', view !== 'takwim');
        if (viewPenjanaan) viewPenjanaan.classList.toggle('hidden', view !== 'penjanaan');

        if (mainNav) {
            mainNav.querySelectorAll('.main-nav-tab').forEach(tab => {
                const active = tab.dataset.view === view;
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }

        if (view === 'takwim' && viewTakwim) {
            initTakwim(viewTakwim, isEditMode, selectedYear);
        } else if (view === 'penjanaan' && viewPenjanaan) {
            initPenjanaan(viewPenjanaan, isEditMode, selectedYear);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.switchView = switchView;

    if (mainNav) {
        mainNav.addEventListener('click', (e) => {
            const tab = e.target.closest('.main-nav-tab');
            if (tab && tab.dataset.view) switchView(tab.dataset.view);
        });
    }

    // --- EVENT LISTENERS ---

    // Year Change — with page transition veil
    if (yearSelector) {
        yearSelector.addEventListener('change', (e) => {
            const year = e.target.value;
            const veil = getEl('year-veil');
            const veilText = getEl('year-veil-text');
            if (veil) {
                if (veilText) veilText.textContent = `Memuatkan ${year}...`;
                veil.classList.add('active');
                setTimeout(() => {
                    setApiYear(year);
                    subscribeFooter(year);
                    initiallyLoadedQuarters.clear();
                    updateDashboard(currentQuarter);
                    renderCurrentView();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    setTimeout(() => veil.classList.remove('active'), 320);
                }, 280);
            } else {
                setApiYear(year);
                subscribeFooter(year);
                initiallyLoadedQuarters.clear();
                updateDashboard(currentQuarter);
                renderCurrentView();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    // Pagination — debounce 150ms untuk elak multiple Firestore reads
    if (paginationContainer) {
        paginationContainer.addEventListener('click', (e) => {
            if (e.target.matches('.quarter-btn')) {
                const prevActive = document.querySelector('.quarter-btn.active');
                if (prevActive) { prevActive.classList.remove('active'); prevActive.setAttribute('aria-selected', 'false'); }
                e.target.classList.add('active');
                e.target.setAttribute('aria-selected', 'true');
                clearTimeout(quarterSwitchTimeout);
                quarterSwitchTimeout = setTimeout(() => {
                    updateDashboard(`q${e.target.dataset.quarter}`);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }, 150);
            }
        });
    }

    // ===== FOCUS MODE =====
    let focusGaugeChart = null;
    const focusModal = getEl('focus-modal');
    const focusModalClose = getEl('focus-modal-close');

    function openFocusMode(kpiId) {
        const data = kpiDataCache[currentQuarter];
        if (!data || !data.processedKpis) return;
        const kpi = data.processedKpis.find(k => k.id === kpiId);
        if (!kpi) return;

        const pct = getKpiPercentage(kpi);
        const cappedPct = Math.min(pct, 100);
        const val = calculateKpiValue(kpi);
        const valStr = kpi.isCurrency ? 'RM ' + Math.floor(val).toLocaleString()
                     : kpi.isPercentage ? val.toFixed(1) + '%'
                     : Math.floor(val).toLocaleString();
        const color = statusHex(pct);

        getEl('focus-kpi-name').textContent = kpi.name;
        getEl('focus-kpi-pct').textContent = cappedPct.toFixed(1) + '%';
        getEl('focus-kpi-pct').style.color = color;
        getEl('focus-kpi-value').textContent = valStr;
        getEl('focus-kpi-target').textContent = kpi.target;

        const trendRow = getEl('focus-trend-row');
        if (kpi.trend && trendRow) {
            const chipClass = kpi.trendColor && kpi.trendColor.includes('green') ? 'kpi-trend-chip-up' :
                              kpi.trendColor && kpi.trendColor.includes('red')   ? 'kpi-trend-chip-down' : 'kpi-trend-chip-flat';
            trendRow.innerHTML = `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${chipClass}"><i class="fas ${kpi.trendIcon} mr-1.5 text-xs"></i>${kpi.trend} vs suku lepas</span>`;
        } else if (trendRow) {
            trendRow.innerHTML = '';
        }

        // Draw focus gauge
        const canvas = getEl('focus-gauge-canvas');
        if (focusGaugeChart) { focusGaugeChart.destroy(); focusGaugeChart = null; }
        if (canvas) {
            focusGaugeChart = new Chart(canvas, {
                type: 'doughnut',
                data: { datasets: [{ data: [cappedPct, 100 - cappedPct],
                    backgroundColor: [color, document.body.classList.contains('dark-mode') ? '#374151' : '#e5e7eb'],
                    borderWidth: 0, circumference: 270, rotation: 225 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '80%',
                    plugins: { legend: { display: false }, tooltip: { enabled: false } },
                    animation: { duration: 700, easing: 'easeOutQuart' } }
            });
        }
        openModal(focusModal);
    }

    if (focusModalClose) focusModalClose.addEventListener('click', () => closeModal(focusModal));
    if (focusModal) focusModal.addEventListener('click', (e) => { if (e.target === focusModal) closeModal(focusModal); });

    // ===== TOOLTIP ON RING HOVER =====
    const tooltip = getEl('kpi-tooltip');
    if (kpiGridContainer && tooltip) {
        kpiGridContainer.addEventListener('mouseover', (e) => {
            const ring = e.target.closest('.kpi-ring-wrap');
            if (!ring) return;
            const card = ring.closest('.kpi-card');
            if (!card) return;
            const name  = card.querySelector('.kpi-name')?.textContent || '';
            const value = card.querySelector('.animated-value')?.textContent || '—';
            const target = card.querySelector('.kpi-target-display')?.textContent?.replace(/\D*$/,'').trim() || '—';
            const pct   = card.querySelector('.kpi-percentage-display')?.textContent || '—';
            const trend = card.querySelector('.kpi-trend');
            const trendTxt = trend ? trend.textContent.trim() : '—';
            const trendClr = trend && trend.classList.contains('kpi-trend-chip-up') ? '#4ade80'
                           : trend && trend.classList.contains('kpi-trend-chip-down') ? '#f87171' : '#9ca3af';

            getEl('tooltip-name').textContent   = name;
            getEl('tooltip-value').textContent  = value;
            getEl('tooltip-target').textContent = target;
            const pctEl = getEl('tooltip-pct');
            pctEl.textContent = pct;
            const pctNum = parseFloat(pct);
            pctEl.style.color = pctNum >= 75 ? '#4ade80' : pctNum >= 30 ? '#fbbf24' : '#f87171';
            getEl('tooltip-trend').textContent = trendTxt || '—';
            getEl('tooltip-trend').style.color = trendClr;

            tooltip.classList.remove('hidden');
        });

        kpiGridContainer.addEventListener('mousemove', (e) => {
            if (tooltip.classList.contains('hidden')) return;
            const ring = e.target.closest('.kpi-ring-wrap');
            if (!ring) { tooltip.classList.add('hidden'); return; }
            const x = e.clientX + 18;
            const y = e.clientY - 80;
            const tw = tooltip.offsetWidth || 200;
            tooltip.style.left = (x + tw > window.innerWidth ? e.clientX - tw - 12 : x) + 'px';
            tooltip.style.top  = Math.max(8, y) + 'px';
        });

        kpiGridContainer.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
    }

    // ===== KEYBOARD SHORTCUTS =====
    const kbHint = getEl('kb-hint');
    let kbHintTimeout;
    function showKbHint(msg) {
        if (!kbHint) return;
        kbHint.textContent = msg;
        kbHint.classList.remove('hidden');
        kbHint.style.opacity = '1';
        clearTimeout(kbHintTimeout);
        kbHintTimeout = setTimeout(() => { kbHint.style.opacity = '0'; setTimeout(() => kbHint.classList.add('hidden'), 300); }, 1200);
    }

    document.addEventListener('keydown', (e) => {
        if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key >= '1' && e.key <= '4') {
            const qBtn = document.querySelector(`.quarter-btn[data-quarter="${e.key}"]`);
            if (qBtn) { qBtn.click(); showKbHint(`Suku ${e.key}`); }
        }
        if (e.key === '/') {
            e.preventDefault();
            const si = getEl('dashboard-search-input');
            if (si) { si.focus(); si.select(); showKbHint('/ Cari KPI...'); }
        }
        // Escape-to-close is handled centrally in ui.js (covers all modals).
    });

    // ===== RIPPLE EFFECT =====
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.quarter-btn, .footer-action-btn, .kpi-action-btn, #theme-toggle, #view-toggle-btn');
        if (!btn) return;
        const wave = document.createElement('span');
        wave.className = 'ripple-wave';
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2.2;
        wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
        btn.appendChild(wave);
        wave.addEventListener('animationend', () => wave.remove());
    }, true);

    // Grid Interaction
    if (kpiGridContainer) {
        kpiGridContainer.addEventListener('click', (e) => {
            const chartBtn = e.target.closest('.show-chart-btn');
            const detailsBtn = e.target.closest('.show-details-btn');
            const kpiNameEl = e.target.closest('.kpi-name');
            if (chartBtn) showHistoryChart(chartBtn.dataset.kpiId, chartBtn);
            if (detailsBtn) {
                const kpiId = detailsBtn.dataset.kpiId;
                if (kpiId) showDetailsModal(kpiId, detailsBtn);
            }
            if (kpiNameEl && kpiNameEl.dataset.kpiId) openFocusMode(kpiNameEl.dataset.kpiId);
        });

        // #5: Swipe gesture — tukar suku dengan swipe kiri/kanan pada grid (mobile)
        let swipeTouchStartX = 0;
        kpiGridContainer.addEventListener('touchstart', (e) => {
            swipeTouchStartX = e.changedTouches[0].clientX;
        }, { passive: true });
        kpiGridContainer.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - swipeTouchStartX;
            if (Math.abs(dx) < 60) return; // abaikan swipe terlalu kecil
            const activeBtn = document.querySelector('.quarter-btn.active');
            if (!activeBtn) return;
            const currentQ = parseInt(activeBtn.dataset.quarter);
            const targetQ = dx < 0 ? Math.min(currentQ + 1, 4) : Math.max(currentQ - 1, 1);
            if (targetQ === currentQ) return;
            const targetBtn = document.querySelector(`.quarter-btn[data-quarter="${targetQ}"]`);
            if (targetBtn) targetBtn.click(); // guna logik quarter switch sedia ada
        }, { passive: true });
    }

    // #2: Stats bar clickable — klik stat card untuk filter grid
    if (statsBar) {
        statsBar.addEventListener('click', (e) => {
            const card = e.target.closest('.stat-card');
            if (!card) return;
            const filter = card.dataset.filter; // 'all' | 'good' | 'ok' | 'bad'
            const statusFilterEl = getEl('dashboard-status-filter');
            if (!statusFilterEl) return;

            // Toggle: klik semula kad yang sama → reset ke all
            const isActive = card.classList.contains('stat-card-active');
            document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('stat-card-active'));
            if (isActive) {
                statusFilterEl.value = 'all';
            } else {
                card.classList.add('stat-card-active');
                statusFilterEl.value = filter;
            }
            statusFilterEl.dispatchEvent(new Event('change')); // trigger filter logic
        });
    }

    if (overallChartBtn) overallChartBtn.addEventListener('click', (e) => showHistoryChart('overall', e.currentTarget));
    if (toastCloseBtn) toastCloseBtn.addEventListener('click', () => getEl('toast-notification').classList.remove('show'));

    // Modals — klik luar untuk tutup, dan destroy chart bila chartModal ditutup
    [chartModal, detailsModal, editDescModal, addKpiModal, editStructureModal, inputModal].forEach(modal => {
        if (!modal) return;
        const closeBtn = modal.querySelector('button[aria-label="Tutup modal"]') || modal.querySelector('.text-2xl');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal === chartModal) destroyKpiChart();
                closeModal(modal);
            }
        });
        if (closeBtn) closeBtn.addEventListener('click', () => {
            if (modal === chartModal) destroyKpiChart();
            closeModal(modal);
        });
    });

    // confirmModal — klik luar tutup (guna hidden class, bukan is-open)
    if (confirmModal) {
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) confirmModal.classList.add('hidden');
        });
    }

    // Admin & Auth
    if (adminLoginBtn) adminLoginBtn.addEventListener('click', () => { resetTerminalModal(); openModal(passwordModal, adminLoginBtn); runBootSequence(); randomGlitch(); });
    if (passwordModalClose) passwordModalClose.addEventListener('click', () => closeModal(passwordModal));
    if (passwordSubmitBtn) passwordSubmitBtn.addEventListener('click', handleAdminLogin);
    if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdminLogin(); } });
    if (emailInput) emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); } });

    // Logout with custom sequence
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            // Import logout function from admin.js
            runLogoutSequence();
        });
    }

    // Admin Forms
    if (saveDescBtn) saveDescBtn.addEventListener('click', async () => {
        const id = editDescModal.dataset.kpiId;
        if (id) {
            const text = descInput.value.trim();
            closeModal(editDescModal);
            await updateKpiDescriptionInFirestore(id, text);
        }
    });
    if (cancelDescBtn) cancelDescBtn.addEventListener('click', () => closeModal(editDescModal));
    if (editDescModalClose) editDescModalClose.addEventListener('click', () => closeModal(editDescModal));

    if (cloneBtn) cloneBtn.addEventListener('click', () => cloneFromYear(String(prevYear)));
    if (startFreshBtn) startFreshBtn.addEventListener('click', () => openModal(addKpiModal));
    if (openAddKpiBtn) openAddKpiBtn.addEventListener('click', () => { getEl('add-kpi-form').reset(); openModal(addKpiModal); });

    // Re-Clone Button with Custom Modal
    const reCloneBtn = document.getElementById('re-clone-btn');
    if (reCloneBtn) {
        reCloneBtn.addEventListener('click', () => {
            showConfirmModal(
                `Reset Data ${currentYear}?`,
                `AMARAN: Ini akan memadam SEMUA data ${currentYear} dan menyalin semula struktur asal dari ${prevYear}. Data ${currentYear} yang sedia ada akan hilang kekal. Teruskan?`,
                () => cloneFromYear(String(prevYear))
            );
        });
    }

    if (addKpiForm) {
        addKpiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const typeRadio = document.querySelector('input[name="kpi-type"]:checked');
            const newKpi = {
                id: 'kpi-' + Date.now(),
                name: getEl('new-kpi-name').value,
                target: parseFloat(getEl('new-kpi-target').value),
                icon: getEl('new-kpi-icon').value,
                isPercentage: typeRadio.value === 'percentage',
                isCurrency: typeRadio.value === 'currency',
                value: 0,
                description: "KPI baru ditambah.",
                details: { type: 'breakdownList', items: [] }
            };
            addNewKpi(newKpi);
            closeModal(addKpiModal);
        });
    }

    function openEditStructureModal(kpi) {
        getEl('edit-structure-id').value = kpi.id;
        getEl('edit-structure-name').value = kpi.name;
        getEl('edit-structure-target').value = kpi.target;
        openModal(editStructureModal);
    }

    if (editStructureForm) {
        editStructureForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = getEl('edit-structure-id').value;
            const name = getEl('edit-structure-name').value;
            const target = getEl('edit-structure-target').value;
            updateKpiStructure(id, name, target);
            closeModal(editStructureModal);
        });
    }

    if (deleteKpiBtn) {
        deleteKpiBtn.addEventListener('click', () => {
            const id = getEl('edit-structure-id').value;
            deleteKpi(id);
            closeModal(editStructureModal);
        });
    }

    if (addKpiClose) addKpiClose.addEventListener('click', () => closeModal(addKpiModal));
    if (editStructClose) editStructClose.addEventListener('click', () => closeModal(editStructureModal));

    // --- DARK MODE LOGIC ---
    const themeToggleBtn = getEl('theme-toggle');
    const themeIcon = themeToggleBtn.querySelector('i');

    // Check local storage or system preference
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
        document.body.classList.add('dark-mode');
        themeIcon.classList.remove('fa-moon');
        themeIcon.classList.add('fa-sun');
    }

    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');

        // Update Icon
        if (isDark) {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
            localStorage.setItem('theme', 'dark');
        } else {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
            localStorage.setItem('theme', 'light');
        }
    });

    // Filters
    if (searchInput) searchInput.addEventListener('input', (e) => filterDashboardCards(e.target.value, statusFilter.value));
    if (statusFilter) statusFilter.addEventListener('change', (e) => {
        // Reset stat card active state bila dropdown digunakan secara manual
        document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('stat-card-active'));
        const matchingCard = document.querySelector(`.stat-card[data-filter="${e.target.value}"]`);
        if (matchingCard && e.target.value !== 'all') matchingCard.classList.add('stat-card-active');
        filterDashboardCards(searchInput.value, e.target.value);
    });



    // PWA & Install Prompt
    let deferredPrompt;
    const installPrompt = getEl('install-prompt');
    const installBtn = getEl('install-app-btn');
    const closeInstallBtn = getEl('install-close-btn');
    const iosModal = getEl('ios-install-modal');
    const closeIosBtn = getEl('close-ios-modal');

    // Helper: Detect iOS
    const isIOS = () => {
        return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
    };

    // Helper: Detect Standalone (Already Installed)
    const isInStandaloneMode = () => {
        return ('standalone' in window.navigator) && (window.navigator.standalone);
    };

    if ('serviceWorker' in navigator) {
        // Reload once when a new SW takes control (a fresh deploy activated).
        // Guarded so it never loops and never fires on the very first install.
        let swRefreshing = false;
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (swRefreshing) return;
                swRefreshing = true;
                sessionStorage.setItem('kpi_sw_updated', '1');
                window.location.reload();
            });
        }

        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then((registration) => { registration.update(); })
                .catch(() => { /* registration failed — app still works online */ });
        });

        // 1. Android / Desktop (Chrome) - Auto Trigger
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            showInstallBanner();
        });

        // 2. iOS - Manual Trigger
        if (isIOS() && !isInStandaloneMode()) {
            // Wait a bit to emulate "app-like" delay
            setTimeout(() => {
                showInstallBanner(true); // true = isIOS
            }, 3000);
        }

        function showInstallBanner(isIOSDevice = false) {
            if (sessionStorage.getItem('pwa_banner_dismissed')) return;
            if (installPrompt) {
                installPrompt.classList.remove('hidden');

                // Customize text for iOS
                if (isIOSDevice) {
                    installBtn.textContent = "Cara Install";
                    const titleText = installPrompt.querySelector('h4');
                    if (titleText) titleText.textContent = "Install App KPI (iOS)";
                }

                setTimeout(() => installPrompt.classList.add('slide-up-show'), 100);
            }
        }

        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                // Scenario A: Android/Chrome (Auto)
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    console.log(`User response: ${outcome}`);
                    deferredPrompt = null;
                    hideInstallBanner();
                }
                // Scenario B: iOS (Manual Guide)
                else if (isIOS()) {
                    if (iosModal) {
                        iosModal.classList.remove('hidden');
                        hideInstallBanner(); // Hide banner to clear view
                    }
                }
            });
        }

        function hideInstallBanner() {
            if (installPrompt) installPrompt.classList.remove('slide-up-show');
        }

        if (closeInstallBtn && installPrompt) {
            closeInstallBtn.addEventListener('click', () => {
                sessionStorage.setItem('pwa_banner_dismissed', '1');
                hideInstallBanner();
            });
        }

        // Close iOS Modal
        if (closeIosBtn) {
            closeIosBtn.addEventListener('click', () => {
                iosModal.classList.add('hidden');
            });
        }

        // Close iOS Modal on BG click
        if (iosModal) {
            iosModal.addEventListener('click', (e) => {
                if (e.target === iosModal) iosModal.classList.add('hidden');
            });
        }
    }

    // --- EXPORT CSV ---
    const exportCsvBtn = getEl('export-csv-btn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            const data = kpiDataCache[currentQuarter];
            if (!data || !data.processedKpis) {
                showToastNotification('Tiada data untuk dieksport.', 'danger');
                return;
            }
            const rows = [['Nama KPI', 'Nilai', 'Sasaran', 'Peratus (%)']];
            data.processedKpis.forEach(kpi => {
                const value = calculateKpiValue(kpi);
                const pct = getKpiPercentage(kpi);
                rows.push([kpi.name, value.toFixed(2), kpi.target, pct.toFixed(2) + '%']);
            });
            const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `KPI_${selectedYear}_${currentQuarter.toUpperCase()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // --- PRINT ---
    const printBtn = getEl('print-btn');
    if (printBtn) {
        printBtn.addEventListener('click', () => window.print());
    }

    // --- EXPORT PDF (BRANDED) ---
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', () => {
            const data = kpiDataCache[currentQuarter];
            if (!data || !data.processedKpis) { showToastNotification('Tiada data untuk dieksport.', 'danger'); return; }
            const jsPDFLib = window.jspdf && window.jspdf.jsPDF;
            if (!jsPDFLib) { showToastNotification('PDF library tidak tersedia.', 'danger'); return; }

            const doc = new jsPDFLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageW = 210;
            const quarterTitle = data.title || currentQuarter.toUpperCase();
            const genDate = new Date().toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });

            // Compute summary stats
            let totalPctPdf = 0, goodCnt = 0, okCnt = 0, badCnt = 0;
            data.processedKpis.forEach(kpi => {
                const p = getKpiPercentage(kpi);
                totalPctPdf += Math.min(p, 100);
                const t = statusTier(p);
                if (t === 'good') goodCnt++; else if (t === 'ok') okCnt++; else badCnt++;
            });
            const kpiCnt = data.processedKpis.length;
            const overallPdf = kpiCnt > 0 ? totalPctPdf / kpiCnt : 0;

            // ── HEADER BAND ──
            doc.setFillColor(13, 71, 161);
            doc.rect(0, 0, pageW, 38, 'F');
            doc.setFillColor(21, 101, 192);
            doc.rect(0, 34, pageW, 4, 'F');

            // Try to embed logo from page
            try {
                const logoEl = document.querySelector('img[alt="Logo Utama"]');
                if (logoEl && logoEl.complete && logoEl.naturalWidth > 0) {
                    const c = document.createElement('canvas');
                    c.width = logoEl.naturalWidth; c.height = logoEl.naturalHeight;
                    c.getContext('2d').drawImage(logoEl, 0, 0);
                    doc.addImage(c.toDataURL('image/png'), 'PNG', pageW - 42, 4, 28, 28);
                }
            } catch(e) {}

            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
            doc.text('PUSAT ALUMNI UPSI', 14, 13);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
            doc.text('Laporan Prestasi Petunjuk Utama Prestasi (KPI) Suku Tahunan', 14, 20);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
            doc.text(`${selectedYear}  ·  ${quarterTitle}`, 14, 29);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
            doc.setTextColor(180, 210, 255);
            doc.text(`Dijana: ${genDate}`, pageW - 14, 29, { align: 'right' });

            // ── SUMMARY BOX ──
            const sumY = 42;
            doc.setFillColor(247, 250, 255); doc.setDrawColor(220, 230, 255);
            doc.roundedRect(14, sumY, pageW - 28, 22, 2, 2, 'FD');

            const summaryStats = [
                { label: 'Jumlah KPI',      value: String(kpiCnt),            rgb: [13, 71, 161] },
                { label: 'Cemerlang',        value: String(goodCnt),           rgb: [22, 163, 74] },
                { label: 'Sederhana',        value: String(okCnt),             rgb: [161, 98, 7] },
                { label: 'Perlu Perhatian',  value: String(badCnt),            rgb: [185, 28, 28] },
                { label: 'Pencapaian',       value: `${overallPdf.toFixed(1)}%`, rgb: [13, 71, 161] },
            ];
            const sColW = (pageW - 28) / summaryStats.length;
            summaryStats.forEach((s, i) => {
                const sx = 14 + sColW * i + sColW / 2;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
                doc.setTextColor(...s.rgb);
                doc.text(s.value, sx, sumY + 10, { align: 'center' });
                doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
                doc.setTextColor(100, 100, 100);
                doc.text(s.label, sx, sumY + 17, { align: 'center' });
            });

            // ── DATA TABLE ──
            doc.autoTable({
                startY: sumY + 26,
                head: [['#', 'Nama KPI', 'Nilai', 'Sasaran', 'Peratus', 'Trend', 'Status']],
                body: data.processedKpis.map((kpi, idx) => {
                    const val = calculateKpiValue(kpi);
                    const pct = getKpiPercentage(kpi);
                    const valStr = kpi.isCurrency ? `RM ${Math.floor(val).toLocaleString()}`
                                 : kpi.isPercentage ? `${val.toFixed(1)}%`
                                 : Math.floor(val).toLocaleString();
                    const status = pct >= 75 ? 'Cemerlang' : pct >= 30 ? 'Sederhana' : 'Perlu Perhatian';
                    return [idx + 1, kpi.name, valStr, kpi.target, `${pct.toFixed(1)}%`, kpi.trend || '—', status];
                }),
                styles: { fontSize: 8.5, cellPadding: 2.8, font: 'helvetica' },
                headStyles: { fillColor: [13, 71, 161], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
                columnStyles: {
                    0: { cellWidth: 8,  halign: 'center' },
                    1: { cellWidth: 58 },
                    2: { cellWidth: 26, halign: 'right' },
                    3: { cellWidth: 22, halign: 'right' },
                    4: { cellWidth: 20, halign: 'center' },
                    5: { cellWidth: 24, halign: 'center' },
                    6: { cellWidth: 28, halign: 'center' },
                },
                didParseCell: function(hookData) {
                    if (hookData.section !== 'body') return;
                    const pctVal = parseFloat(hookData.row.raw[4]);
                    const isStatus = hookData.column.index === 6;
                    if (pctVal >= 75) {
                        hookData.cell.styles.fillColor = [220, 252, 231];
                        if (isStatus) { hookData.cell.styles.textColor = [22, 163, 74]; hookData.cell.styles.fontStyle = 'bold'; }
                    } else if (pctVal >= 30) {
                        hookData.cell.styles.fillColor = [254, 249, 195];
                        if (isStatus) { hookData.cell.styles.textColor = [161, 98, 7]; hookData.cell.styles.fontStyle = 'bold'; }
                    } else {
                        hookData.cell.styles.fillColor = [254, 226, 226];
                        if (isStatus) { hookData.cell.styles.textColor = [185, 28, 28]; hookData.cell.styles.fontStyle = 'bold'; }
                    }
                },
                margin: { left: 14, right: 14 },
            });

            // ── FOOTER ON EACH PAGE ──
            const totalPages = doc.internal.getNumberOfPages();
            for (let p = 1; p <= totalPages; p++) {
                doc.setPage(p);
                doc.setDrawColor(210, 220, 240);
                doc.line(14, 285, pageW - 14, 285);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 150, 150);
                doc.text('Pusat Alumni UPSI  ·  Dokumen Sulit Dalaman', 14, 290);
                doc.text(`Halaman ${p} / ${totalPages}`, pageW - 14, 290, { align: 'right' });
            }

            const filename = `Laporan_KPI_${selectedYear}_${currentQuarter.toUpperCase()}_${new Date().toISOString().slice(0,10)}.pdf`;
            doc.save(filename);
            showToastNotification('PDF berjaya dijana!', 'success');
        });
    }

    // --- PUSH NOTIFICATIONS ---
    if (notifyBtn) {
        notifyBtn.addEventListener('click', async () => {
            if (!('Notification' in window)) {
                showToastNotification('Browser anda tidak menyokong notifikasi.', 'danger');
                return;
            }
            if (Notification.permission === 'granted') {
                showToastNotification('Notifikasi sudah diaktifkan.', 'success');
            } else if (Notification.permission === 'denied') {
                showToastNotification('Notifikasi disekat. Sila benarkan dalam tetapan browser.', 'danger');
            } else {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    showToastNotification('Notifikasi diaktifkan!', 'success');
                    notifyBtn.innerHTML = '<i class="fas fa-bell mr-2"></i>Notifikasi Aktif';
                } else {
                    showToastNotification('Kebenaran notifikasi ditolak.', 'danger');
                }
            }
        });
    }

    // --- BULK EDIT ---
    const openBulkEditBtn = getEl('open-bulk-edit-btn');
    if (openBulkEditBtn) {
        openBulkEditBtn.addEventListener('click', async () => {
            const kpiId = getEl('edit-structure-id').value;
            if (!kpiId) return;
            const kpiName = getEl('edit-structure-name').value;
            const nameEl = getEl('bulk-edit-kpi-name');
            if (nameEl) nameEl.textContent = `KPI: ${kpiName}`;

            for (let i = 1; i <= 4; i++) {
                const qKey = `q${i}`;
                const input = getEl(`bulk-q${i}-input`);
                if (!input) continue;
                let val = '';
                const cached = kpiDataCache[qKey];
                if (cached && cached.kpis) {
                    const kpi = cached.kpis.find(k => k.id === kpiId);
                    if (kpi) val = kpi.value ?? '';
                } else {
                    try {
                        const fetched = await getKpiDataFromFirestore(qKey);
                        if (fetched && fetched.kpis) {
                            const kpi = fetched.kpis.find(k => k.id === kpiId);
                            if (kpi) val = kpi.value ?? '';
                        }
                    } catch (e) { /* leave blank */ }
                }
                input.value = val;
            }

            closeModal(editStructureModal);
            if (bulkEditModal) bulkEditModal.classList.remove('hidden');
        });
    }

    const bulkEditSaveBtn = getEl('bulk-edit-save-btn');
    if (bulkEditSaveBtn) {
        bulkEditSaveBtn.addEventListener('click', async () => {
            const kpiId = getEl('edit-structure-id').value;
            if (!kpiId) return;
            const valuesObj = {};
            let hasError = false;
            for (let i = 1; i <= 4; i++) {
                const input = getEl(`bulk-q${i}-input`);
                if (!input || input.value === '') continue;
                const parsed = parseFloat(input.value);
                if (isNaN(parsed) || parsed < 0) {
                    showToastNotification(`Nilai Suku ${i} tidak sah.`, 'danger');
                    hasError = true;
                    break;
                }
                valuesObj[`q${i}`] = parsed;
            }
            if (hasError) return;
            await saveBulkKpiValues(kpiId, valuesObj);
            if (bulkEditModal) bulkEditModal.classList.add('hidden');
        });
    }

    const bulkEditCancelBtn = getEl('bulk-edit-cancel-btn');
    const bulkEditCloseBtn = getEl('bulk-edit-modal-close');
    if (bulkEditCancelBtn) bulkEditCancelBtn.addEventListener('click', () => { if (bulkEditModal) bulkEditModal.classList.add('hidden'); });
    if (bulkEditCloseBtn) bulkEditCloseBtn.addEventListener('click', () => { if (bulkEditModal) bulkEditModal.classList.add('hidden'); });
    if (bulkEditModal) {
        bulkEditModal.addEventListener('click', (e) => {
            if (e.target === bulkEditModal) bulkEditModal.classList.add('hidden');
        });
    }

    // --- OFFLINE PERSISTENCE & INDICATOR ---
    if (typeof db !== 'undefined') {
        db.enablePersistence({ synchronizeTabs: false }).catch(err => {
            if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
                console.error('Persistence error:', err);
            }
        });
    }

    window.addEventListener('online', () => {
        if (offlineBanner) offlineBanner.classList.add('hidden');
    });
    window.addEventListener('offline', () => {
        if (offlineBanner) offlineBanner.classList.remove('hidden');
    });

    // Set dynamic copyright year
    const footerYearEl = getEl('footer-year');
    if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

    // --- STICKY HEADER SHRINK ---
    const headerInner = getEl('header-inner');
    window.addEventListener('scroll', () => {
        if (!headerInner) return;
        headerInner.classList.toggle('header-compact', window.scrollY > 70);
    }, { passive: true });

    // --- EXECUTIVE TABLE VIEW ---
    let isTableView = false;
    const viewToggleBtn = getEl('view-toggle-btn');
    const kpiTableContainer = getEl('kpi-table-container');

    function renderTableView() {
        const tbody = getEl('kpi-table-body');
        if (!tbody) return;
        const data = kpiDataCache[currentQuarter];
        if (!data || !data.processedKpis) return;

        tbody.innerHTML = '';
        data.processedKpis.forEach(kpi => {
            const pct = getKpiPercentage(kpi);
            const cappedPct = Math.min(pct, 100);
            const val = calculateKpiValue(kpi);
            const valStr = kpi.isCurrency
                ? 'RM ' + val.toLocaleString('en-US', { minimumFractionDigits: 0 })
                : kpi.isPercentage ? val.toFixed(1) + '%'
                : Math.floor(val).toLocaleString();
            const dotColor  = statusHex(pct);
            const badge     = pct >= 75 ? 'bg-green-100 text-green-700'
                            : pct >= 30 ? 'bg-amber-100 text-amber-700'
                            :             'bg-red-100 text-red-600';
            const iconBg    = pct >= 75 ? 'bg-green-50'   : pct >= 30 ? 'bg-amber-50'   : 'bg-red-50';
            const iconClr   = pct >= 75 ? 'text-green-600': pct >= 30 ? 'text-amber-600': 'text-red-600';
            const trendTxt  = kpi.trend || '—';
            const trendClr  = kpi.trendColor || 'text-gray-400';

            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-50 hover:bg-blue-50/30 transition-colors';
            tr.innerHTML = `
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0">
                            <i class="ph-duotone ${getPhosphorIcon(kpi.icon)} ${iconClr} text-xs"></i>
                        </div>
                        <span class="font-semibold text-gray-800 text-sm">${kpi.name}</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-right font-bold text-gray-800 text-sm">${valStr}</td>
                <td class="px-4 py-3 text-right text-gray-400 text-sm">${kpi.target}</td>
                <td class="px-4 py-3 text-right">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${badge}">${cappedPct.toFixed(1)}%</span>
                </td>
                <td class="px-4 py-3 text-center text-sm font-bold ${trendClr} hidden sm:table-cell">${trendTxt}</td>
                <td class="px-4 py-3 text-center hidden sm:table-cell">
                    <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${dotColor}"></span>
                </td>`;
            tbody.appendChild(tr);
        });
    }

    if (viewToggleBtn) {
        viewToggleBtn.addEventListener('click', () => {
            isTableView = !isTableView;
            if (isTableView) {
                kpiGridContainer.classList.add('hidden');
                if (kpiTableContainer) kpiTableContainer.classList.remove('hidden');
                viewToggleBtn.innerHTML = '<i class="fas fa-th-large mr-1.5"></i>Grid';
                renderTableView();
            } else {
                kpiGridContainer.classList.remove('hidden');
                if (kpiTableContainer) kpiTableContainer.classList.add('hidden');
                viewToggleBtn.innerHTML = '<i class="fas fa-list mr-1.5"></i>Jadual';
            }
        });
    }

    // ===== ANIMATED FAVICON =====
    function updateFavicon(pct) {
        try {
            const size = 64, cx = 32, cy = 32, r = 27;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            const color = statusHex(pct);

            // Coloured background circle
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

            // Track ring
            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.lineWidth = 6;
            ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI * 2); ctx.stroke();

            // Progress arc
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 6; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(cx, cy, r - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(pct, 100) / 100);
            ctx.stroke();

            // Percentage text
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${pct >= 100 ? 11 : 13}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(Math.round(pct) + '%', cx, cy);

            let link = document.querySelector('link[rel="icon"]');
            if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
            link.type = 'image/png';
            link.href = canvas.toDataURL();
        } catch(e) {}
    }

    // After an automatic SW update + reload, let the user know once.
    if (sessionStorage.getItem('kpi_sw_updated')) {
        sessionStorage.removeItem('kpi_sw_updated');
        setTimeout(() => showToastNotification('Aplikasi dikemas kini ke versi terbaharu.', 'success'), 800);
    }

    // Start App
    initializeApp();
});