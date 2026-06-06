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
    saveBulkKpiValues
} from './api.js';

import { renderGaugeChart, showHistoryChart, destroyKpiChart } from './charts.js';
import { handleAdminLogin, resetTerminalModal, runBootSequence, randomGlitch, runLogoutSequence } from './admin.js';

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
        subscribeToQuarterData(quarterKey, (currentData, previousData, isEmpty) => {

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
            if (footerNote && currentData.footerDate) {
                footerNote.textContent = `Data dikemaskini pada ${currentData.footerDate}.`;
            }

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

            if (kpiGridContainer) kpiGridContainer.innerHTML = '';

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
                        // prevent edit if has details
                        if (kpi.details && (kpi.details.items || (kpi.details.targetList && kpi.details.targetList.length > 0))) {
                            return; // Validation handled by disabling button logic in UI, but double check
                        }
                        const currentVal = calculateKpiValue(kpi);

                        showInputModal(
                            `Kemaskini Nilai: ${kpi.name}`,
                            "Masukkan nilai pencapaian terkini:",
                            currentVal,
                            (newVal) => {
                                if (newVal !== null && newVal.trim() !== "") {
                                    const parsed = parseFloat(newVal);
                                    if (isNaN(parsed) || parsed < 0) {
                                        showToastNotification("Nilai tidak sah. Sila masukkan angka positif.", "danger");
                                        return;
                                    }
                                    if (kpi.isPercentage && parsed > 100) {
                                        showToastNotification("Nilai peratusan tidak boleh melebihi 100%.", "danger");
                                        return;
                                    }
                                    updateKpiValueInFirestore(quarterKey, kpi.id, parsed);
                                }
                            }
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

                if (pct >= 75) goodCount++;
                else if (pct >= 30) okCount++;
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
                // GUEST MODE
                setEditMode(false);
                if (modeIndicator) modeIndicator.innerHTML = '<span class="inline-flex items-center bg-blue-100 text-blue-800 text-xs font-semibold px-2 md:px-2.5 py-1 rounded-full border border-blue-200 whitespace-nowrap"><i class="fas fa-eye md:mr-1"></i><span class="hidden md:inline">Paparan Awam</span></span>';
                if (adminLogoutBtn) adminLogoutBtn.classList.add('hidden');
                if (adminLoginBtn) adminLoginBtn.classList.remove('hidden');
                if (adminRibbon) adminRibbon.classList.add('hidden');

                // Hide admin specific elements immediately
                if (adminSetupActions) adminSetupActions.classList.add('hidden');

                // If not logged in at all, login anonymously
                if (!user) {
                    try { await firebase.auth().signInAnonymously(); }
                    catch (error) { console.error("Anonymous auth error:", error); }
                }
            }

            // Trigger Load
            window.updateDashboard(activeQuarterKey);
        });
    }



    // --- EVENT LISTENERS ---

    // Year Change
    if (yearSelector) {
        yearSelector.addEventListener('change', (e) => {
            const year = e.target.value;
            setApiYear(year);
            initiallyLoadedQuarters.clear();
            updateDashboard(currentQuarter);
            window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // Grid Interaction
    if (kpiGridContainer) {
        kpiGridContainer.addEventListener('click', (e) => {
            const chartBtn = e.target.closest('.show-chart-btn');
            const detailsBtn = e.target.closest('.show-details-btn');
            if (chartBtn) showHistoryChart(chartBtn.dataset.kpiId, chartBtn);
            if (detailsBtn) {
                const kpiId = detailsBtn.dataset.kpiId;
                if (kpiId) showDetailsModal(kpiId, detailsBtn);
            }
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

    // What-If


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
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(
                registration => console.log('SW Registered'),
                err => console.log('SW Failed')
            );
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

    // --- EXPORT PDF ---
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', () => {
            const data = kpiDataCache[currentQuarter];
            if (!data || !data.processedKpis) {
                showToastNotification('Tiada data untuk dieksport.', 'danger');
                return;
            }
            const jsPDFLib = window.jspdf && window.jspdf.jsPDF;
            if (!jsPDFLib) {
                showToastNotification('PDF library tidak tersedia.', 'danger');
                return;
            }
            const doc = new jsPDFLib();
            const quarterTitle = data.title || currentQuarter.toUpperCase();
            doc.setFontSize(14);
            doc.setTextColor(13, 71, 161);
            doc.text('Laporan KPI Pusat Alumni UPSI', 14, 15);
            doc.setFontSize(11);
            doc.setTextColor(60, 60, 60);
            doc.text(`Tahun: ${selectedYear}   |   ${quarterTitle}`, 14, 23);
            doc.autoTable({
                startY: 30,
                head: [['Nama KPI', 'Nilai', 'Sasaran', 'Peratus (%)']],
                body: data.processedKpis.map(kpi => [
                    kpi.name,
                    calculateKpiValue(kpi).toFixed(2),
                    kpi.target,
                    getKpiPercentage(kpi).toFixed(2) + '%'
                ]),
                styles: { fontSize: 10, cellPadding: 4 },
                headStyles: { fillColor: [13, 71, 161], textColor: [255, 255, 255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [240, 244, 252] }
            });
            doc.save(`KPI_${selectedYear}_${currentQuarter.toUpperCase()}.pdf`);
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

    // Start App
    initializeApp();
});