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
    initWhatIfCalculator
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
    updateKpiDescriptionInFirestore
} from './api.js';

import { renderGaugeChart, showHistoryChart, updateWhatIfChart } from './charts.js';
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
    
    const whatIfBtn = getEl('what-if-btn');
    const whatIfCalculateBtn = getEl('what-if-calculate-btn');
    const whatIfResetBtn = getEl('what-if-reset-btn');
    const whatIfModal = getEl('what-if-modal');
    const whatIfModalClose = getEl('what-if-modal-close');
    const whatIfResultDisplay = getEl('what-if-result-display');
    const whatIfDiffDisplay = getEl('what-if-diff-display');
    const whatIfProgressBar = getEl('what-if-progress-bar');
    
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

    const searchInput = getEl('dashboard-search-input');
    const statusFilter = getEl('dashboard-status-filter');

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

    // --- INITIALIZE YEAR ---
    if (yearSelector) {
        setApiYear(yearSelector.value || "2025");
    }

    // --- MAIN FUNCTION: UPDATE DASHBOARD ---
    window.updateDashboard = function(quarterKey) {
        currentQuarter = quarterKey;
        
        // 1. Set Title Serta-merta
        if (mainTitle) {
            const qMap = { 'q1': 'Suku Pertama', 'q2': 'Suku Kedua', 'q3': 'Suku Ketiga', 'q4': 'Suku Keempat' };
            mainTitle.textContent = `Dashboard KPI ${selectedYear} - ${qMap[quarterKey]}`;
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
                
                if(isEditMode) {
                    if (adminSetupActions) adminSetupActions.classList.remove('hidden');
                } else {
                    if (adminSetupActions) adminSetupActions.classList.add('hidden');
                }
                
                if (mainTitle) mainTitle.textContent = `Dashboard KPI ${selectedYear} - Tiada Data`;
                return;
            }

            // Handle Data Exists State
            if (emptyStateContainer) emptyStateContainer.classList.add('hidden');
            if (mainContentWrapper) mainContentWrapper.classList.remove('hidden');
            
            // Update Title
            if (mainTitle) mainTitle.textContent = `Dashboard KPI ${selectedYear} - ${currentData.title || quarterKey.toUpperCase()}`;
            if (subTitle) subTitle.textContent = `Papan Pemuka Prestasi (${currentData.subtitle || ''})`;
            if (footerNote && currentData.footerDate) {
                footerNote.innerHTML = `Data dikemaskini pada ${currentData.footerDate}. Untuk maklumat lanjut, sila hubungi <a href="tel:+60134977187" class="text-brand-primary hover:underline font-semibold">Encik Fahman Mujib Bin Ramli</a>.`;
            }

            // Process KPIs
            const processedKpis = processKpisWithTrends(currentData.kpis, previousData ? previousData.kpis : null);
            kpiDataCache[quarterKey].processedKpis = processedKpis; 

            let totalPct = 0;
            let count = 0;
            let topKpi = null;
            let bottomKpi = null;
            let maxPercentage = -1;
            let minPercentage = 999999;
            
            if (kpiGridContainer) kpiGridContainer.innerHTML = '';
            
            processedKpis.forEach((kpi, index) => {
                const card = createKpiCard(kpi);
                if (kpiGridContainer) kpiGridContainer.appendChild(card);
                
                card.style.animationDelay = `${index * 50}ms`;
                animateCardElements(card, kpi);

                // Attach Listeners
                const editValBtn = card.querySelector('.edit-kpi-btn');
                if(editValBtn) {
                    editValBtn.addEventListener('click', (e) => {
                       e.stopPropagation();
                       const currentVal = calculateKpiValue(kpi);
                       const newVal = prompt(`Masukkan nilai baharu untuk "${kpi.name}":`, currentVal);
                       if(newVal !== null && newVal.trim() !== "") {
                           updateKpiValueInFirestore(quarterKey, kpi.id, parseFloat(newVal));
                       }
                    });
                }

                const settingsBtn = card.querySelector('.settings-btn');
                if(settingsBtn) {
                    settingsBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openEditStructureModal(kpi);
                    });
                }
                
                const chartBtn = card.querySelector('.show-chart-btn');
                if(chartBtn) {
                    chartBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showHistoryChart(kpi.id, chartBtn);
                    });
                }
                
                const detailsBtn = card.querySelector('.show-details-btn');
                if(detailsBtn && kpi.details) {
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

            if (topKpi && topAchiever) topAchiever.textContent = `${topKpi.name} (${maxPercentage.toFixed(2)}%)`;
            if (bottomKpi && mainFocus) mainFocus.textContent = `${bottomKpi.name} (${minPercentage.toFixed(2)}%)`;
            
            setEditMode(isEditMode);

            if(searchInput && statusFilter) {
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
                
                showToastNotification(`Selamat datang, Admin (${user.email})`, "success");
            } else {
                // GUEST MODE
                setEditMode(false);
                if (modeIndicator) modeIndicator.innerHTML = '<span class="inline-block bg-yellow-100 text-yellow-800 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-yellow-200">Mod Lihat Sahaja</span>';
                if (adminLogoutBtn) adminLogoutBtn.classList.add('hidden');
                if (adminLoginBtn) adminLoginBtn.classList.remove('hidden');
                
                // Hide admin specific elements immediately
                if(adminSetupActions) adminSetupActions.classList.add('hidden');

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

    // --- WHAT-IF LOGIC ---
    window.calculateWhatIf = function() {
        const inputs = document.querySelectorAll('.what-if-input');
        let totalCappedPct = 0;
        let count = 0;

        inputs.forEach(input => {
            const val = parseFloat(input.value) || 0;
            const target = parseFloat(input.dataset.target);
            const isPct = input.dataset.isPct === 'true';
            let pct = isPct ? val : (val / target * 100);
            let capped = Math.min(pct, 100); 
            totalCappedPct += capped;
            count++;
        });

        const newOverall = count > 0 ? totalCappedPct / count : 0;
        
        if(whatIfResultDisplay) {
            animateValue(whatIfResultDisplay, parseFloat(whatIfResultDisplay.textContent) || 0, newOverall, 500, val => `${val.toFixed(2)}%`);
            let colorClass = 'text-red-600';
            let barClass = 'bg-red-600';
            if(newOverall >= 75) { colorClass = 'text-green-600'; barClass = 'bg-green-600'; }
            else if(newOverall >= 30) { colorClass = 'text-yellow-500'; barClass = 'bg-yellow-500'; }
            
            whatIfResultDisplay.className = `text-5xl font-bold mb-2 transition-colors duration-500 ${colorClass}`;
            if(whatIfProgressBar) {
                whatIfProgressBar.className = `h-1 rounded-full transition-all duration-500 ${barClass}`;
                whatIfProgressBar.style.width = `${Math.min(newOverall, 100)}%`;
            }
        }

        const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
        const actualOverall = kpiDataCache[activeQuarterKey] ? kpiDataCache[activeQuarterKey].overall : 0;
        const diff = newOverall - actualOverall;
        
        let diffHTML = '';
        if(Math.abs(diff) < 0.01) diffHTML = '<span class="text-gray-400">Tiada perubahan</span>';
        else if(diff > 0) diffHTML = `<span class="text-green-600"><i class="fas fa-arrow-up mr-1"></i>+${diff.toFixed(2)}% dari asal</span>`;
        else diffHTML = `<span class="text-red-500"><i class="fas fa-arrow-down mr-1"></i>${diff.toFixed(2)}% dari asal</span>`;
        
        if(whatIfDiffDisplay) whatIfDiffDisplay.innerHTML = diffHTML;
        updateWhatIfChart(actualOverall, newOverall);
    };

    window.resetWhatIf = function() {
        const inputs = document.querySelectorAll('.what-if-input');
        const sliders = document.querySelectorAll('.range-slider');
        const pctDisplays = document.querySelectorAll('.dynamic-pct');

        inputs.forEach((input, idx) => {
            input.value = input.dataset.original;
            sliders[idx].value = input.dataset.original;
            const target = parseFloat(input.dataset.target);
            const isPct = input.dataset.isPct === 'true';
            let pct = isPct ? parseFloat(input.value) : (parseFloat(input.value) / target * 100);
            if(pctDisplays[idx]) {
                pctDisplays[idx].textContent = `${pct.toFixed(1)}%`;
                pctDisplays[idx].className = `dynamic-pct font-bold ${getStatusColor(pct).replace('bg-', 'text-')}`;
            }
        });
        window.calculateWhatIf();
    };

    // --- EVENT LISTENERS ---
    
    // Year Change
    if (yearSelector) {
        yearSelector.addEventListener('change', (e) => {
            const year = e.target.value;
            setApiYear(year);
            updateDashboard(currentQuarter);
        });
    }

    // Pagination
    if (paginationContainer) {
        paginationContainer.addEventListener('click', async (e) => {
            if (e.target.matches('.quarter-btn')) {
                document.querySelector('.quarter-btn.active').classList.remove('active');
                e.target.classList.add('active');
                updateDashboard(`q${e.target.dataset.quarter}`);
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
                if(kpiId) showDetailsModal(kpiId, detailsBtn);
            }
        });
    }

    if (overallChartBtn) overallChartBtn.addEventListener('click', (e) => showHistoryChart('overall', e.currentTarget));
    if (toastCloseBtn) toastCloseBtn.addEventListener('click', () => getEl('toast-notification').classList.remove('show'));

    // What-If
    if (whatIfBtn) whatIfBtn.addEventListener('click', initWhatIfCalculator);
    if (whatIfCalculateBtn) whatIfCalculateBtn.addEventListener('click', window.calculateWhatIf);
    if (whatIfResetBtn) whatIfResetBtn.addEventListener('click', window.resetWhatIf);
    if (whatIfModalClose) whatIfModalClose.addEventListener('click', () => closeModal(whatIfModal));
    if (whatIfModal) whatIfModal.addEventListener('click', (e) => { if (e.target === whatIfModal) closeModal(whatIfModal); });

    // Modals
    [chartModal, detailsModal, editDescModal, addKpiModal, editStructureModal].forEach(modal => {
        if(!modal) return;
        const closeBtn = modal.querySelector('button[aria-label="Tutup modal"]') || modal.querySelector('.text-2xl');
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
        if(closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
    });

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
        if(id) {
            const text = descInput.value.trim();
            closeModal(editDescModal);
            await updateKpiDescriptionInFirestore(id, text);
        }
    });
    if (cancelDescBtn) cancelDescBtn.addEventListener('click', () => closeModal(editDescModal));
    if (editDescModalClose) editDescModalClose.addEventListener('click', () => closeModal(editDescModal));

    if (cloneBtn) cloneBtn.addEventListener('click', () => cloneFromYear("2025"));
    if (startFreshBtn) startFreshBtn.addEventListener('click', () => openModal(addKpiModal));
    if (openAddKpiBtn) openAddKpiBtn.addEventListener('click', () => { getEl('add-kpi-form').reset(); openModal(addKpiModal); });

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

    if(addKpiClose) addKpiClose.addEventListener('click', () => closeModal(addKpiModal));
    if(editStructClose) editStructClose.addEventListener('click', () => closeModal(editStructureModal));

    // Filters
    if(searchInput) searchInput.addEventListener('input', (e) => filterDashboardCards(e.target.value, statusFilter.value));
    if(statusFilter) statusFilter.addEventListener('change', (e) => filterDashboardCards(searchInput.value, e.target.value));

    // PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(
                registration => console.log('SW Registered'),
                err => console.log('SW Failed')
            );
        });
    }

    // Start App
    initializeApp();
});