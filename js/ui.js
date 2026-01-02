// --- JS/UI.JS ---
import {
    updateKpiValueInFirestore,
    updateKpiDetailsList,
    updateKpiTargetListItem,
    updateKpiBreakdownList,
    updateKpiProgressListItem,
    kpiDataCache
} from './api.js';

// Global UI State (Exported)
export let isEditMode = false;

// Function to update edit mode
export function setEditMode(mode) {
    isEditMode = mode;

    // Toggle Add Button Container
    const addContainer = document.getElementById('add-kpi-container');
    if (addContainer) addContainer.style.display = mode ? 'block' : 'none';

    // Toggle Empty State Actions
    const adminActions = document.getElementById('admin-setup-actions');
    const guestMsg = document.getElementById('guest-empty-msg');
    if (adminActions) adminActions.style.display = mode ? 'flex' : 'none'; // Flex for layout
    if (guestMsg) guestMsg.style.display = mode ? 'none' : 'block';

    // Toggle Card Buttons
    const cards = document.querySelectorAll('.kpi-card');
    cards.forEach(card => {
        const settingsBtn = card.querySelector('.settings-btn');
        const editValBtn = card.querySelector('.edit-kpi-btn');
        const infoBtn = card.querySelector('.info-btn');

        if (settingsBtn) settingsBtn.style.display = mode ? 'block' : 'none';
        if (editValBtn) editValBtn.style.display = mode ? 'inline-block' : 'none';

        // Update Info Icon
        if (mode) {
            infoBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
            infoBtn.title = "Edit Deskripsi";
        } else {
            infoBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
            infoBtn.title = "Maklumat Lanjut";
        }
    });
}

let lastFocusedElement = null;
let toastTimeout;

// DOM Helpers (Safe Selectors)
const getEl = (id) => document.getElementById(id);

// --- NEW LOADING FUNCTIONS ---
export function showLoading(message = "Memproses...") {
    const overlay = getEl('global-loading-overlay');
    const text = getEl('loading-text');
    if (overlay && text) {
        text.textContent = message;
        overlay.classList.remove('hidden');
    }
}

export function hideLoading() {
    const overlay = getEl('global-loading-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

export function renderSkeletons() {
    const kpiGridContainer = getEl('kpi-grid-container');
    if (!kpiGridContainer) return;

    // Optional: Hide empty state while skeleton is showing
    const emptyState = getEl('empty-state-container');
    if (emptyState) emptyState.classList.add('hidden');

    kpiGridContainer.innerHTML = '';
    const skeletonCount = 6;
    for (let i = 0; i < skeletonCount; i++) {
        const skeletonHTML = `
            <div class="kpi-card bg-white p-6 rounded-2xl shadow-lg border border-gray-100 flex flex-col h-full animate-pulse relative overflow-hidden">
                <!-- Header Icon & Title -->
                <div class="flex items-center mb-6">
                    <div class="w-12 h-12 rounded-full bg-gray-200"></div>
                    <div class="ml-4 flex-1 space-y-2">
                        <div class="h-5 bg-gray-200 rounded w-3/4"></div>
                        <div class="h-3 bg-gray-100 rounded w-1/2"></div>
                    </div>
                </div>
                
                <!-- Center Viz/Text -->
                <div class="my-4 space-y-3">
                    <div class="h-8 bg-gray-200 rounded w-1/3 mx-auto"></div>
                    <div class="h-2 bg-gray-100 rounded w-full"></div>
                    <div class="h-2 bg-gray-100 rounded w-5/6 mx-auto"></div>
                </div>

                <!-- Bottom Footer -->
                <div class="mt-auto pt-4 border-t border-gray-50 flex justify-between items-center">
                    <div class="h-4 bg-gray-200 rounded w-16"></div>
                    <div class="h-8 bg-gray-200 rounded w-8"></div>
                </div>
                
                <!-- Shimmer Effect Overlay -->
                <div class="absolute inset-0 -translate-x-full skeleton-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
            </div>
        `;
        kpiGridContainer.insertAdjacentHTML('beforeend', skeletonHTML);
    }
}

export function createKpiCard(kpi) {
    const template = getEl('kpi-card-template');
    const cardClone = template.content.cloneNode(true);
    const cardElement = cardClone.querySelector('.kpi-card');
    const displayPercentage = getKpiPercentage(kpi);
    const isComplete = displayPercentage >= 100;

    cardElement.querySelector('.show-chart-btn').dataset.kpiId = kpi.id;
    const detailsBtn = cardElement.querySelector('.show-details-btn');

    // Logic Butang Titik Tiga
    if (kpi.details) {
        detailsBtn.dataset.kpiId = kpi.id;
        detailsBtn.classList.remove('hidden');
        detailsBtn.classList.add('flex');
    }

    cardElement.querySelector('.kpi-icon').classList.add(kpi.icon);
    cardElement.querySelector('.kpi-name').textContent = kpi.name;

    // --- SETTINGS BUTTON (NEW) ---
    const settingsBtn = cardElement.querySelector('.settings-btn');
    if (settingsBtn) {
        settingsBtn.dataset.kpiId = kpi.id; // Store ID for click handler in main.js
        settingsBtn.style.display = isEditMode ? 'block' : 'none';
    }

    // --- LOGIC DESKRIPSI/INFO BUTTON ---
    const infoBtn = cardElement.querySelector('.info-btn');
    const popover = cardElement.querySelector('.desc-popover');
    const popoverText = cardElement.querySelector('.desc-text');
    const editDescModal = getEl('edit-desc-modal');
    const descInput = getEl('desc-input');

    popoverText.textContent = kpi.description || "Tiada maklumat lanjut disediakan oleh admin.";

    if (isEditMode) {
        infoBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
        infoBtn.title = "Edit Deskripsi KPI";
        infoBtn.onclick = (e) => {
            e.stopPropagation();
            editDescModal.dataset.kpiId = kpi.id;
            descInput.value = kpi.description || "";
            openModal(editDescModal, infoBtn);
        };
        popover.remove();
    } else {
        infoBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
        infoBtn.title = "Lihat Info Lanjut";
        infoBtn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.desc-popover').forEach(p => {
                if (p !== popover) p.classList.add('hidden');
            });
            popover.classList.toggle('hidden');
        };
        cardElement.addEventListener('mouseleave', () => {
            popover.classList.add('hidden');
        });
    }

    const statusDot = cardElement.querySelector('.status-dot');
    if (isComplete) {
        statusDot.classList.remove('hidden');
    } else {
        statusDot.classList.add('hidden');
    }

    const trendElement = cardElement.querySelector('.kpi-trend');
    if (kpi.trend) {
        trendElement.innerHTML = `<i class="fas ${kpi.trendIcon} mr-1"></i> ${kpi.trend}`;
        trendElement.className = `kpi-trend flex items-center font-semibold text-sm sm:text-base ${kpi.trendColor}`;
        if (isComplete) {
            cardElement.querySelector('.trend-wrapper-complete').appendChild(trendElement);
        }
    } else {
        trendElement.remove();
    }

    cardElement.querySelector('.progress-bar').classList.add(getStatusColor(displayPercentage));
    cardElement.querySelector('.progress-bar').dataset.targetWidth = `${Math.min(displayPercentage, 100)}%`;

    const targetDisplay = cardElement.querySelector('.kpi-target-display');
    if (kpi.isPercentage) {
        targetDisplay.remove();
    } else {
        const displayTarget = kpi.target;
        if (typeof displayTarget === 'number') {
            const formattedTarget = displayTarget > 9999 ? `${(displayTarget / 1000).toLocaleString()}k` : displayTarget.toLocaleString();
            targetDisplay.textContent = ` / ${formattedTarget}`;
        } else {
            targetDisplay.remove();
        }
    }

    const editBtn = cardElement.querySelector('.edit-kpi-btn');
    if (isEditMode && kpi.hasOwnProperty('value')) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleEditKpi(cardElement, kpi);
        });
    } else {
        editBtn.remove();
    }

    return cardElement;
}

export function animateCardElements(card, kpi) {
    const displayPercentage = getKpiPercentage(kpi);
    const valueToAnimate = calculateKpiValue(kpi);

    const bar = card.querySelector('.progress-bar');
    if (bar) bar.style.width = bar.dataset.targetWidth;

    const animatedValueEl = card.querySelector('.animated-value');
    if (animatedValueEl) {
        let formatter = kpi.isPercentage ? val => `${val.toFixed(2)}%` :
            kpi.isCurrency ? val => `RM ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` :
                val => Math.floor(val).toLocaleString();
        animateValue(animatedValueEl, 0, valueToAnimate, 1500, formatter);
    }

    const percentageDisplayEl = card.querySelector('.kpi-percentage-display');
    if (percentageDisplayEl) {
        animateValue(percentageDisplayEl, 0, displayPercentage, 1500, val => `${val.toFixed(2)}%`);
    }
}

function handleEditKpi(cardElement, kpi) {
    if (!isEditMode) return;
    const valueWrapper = cardElement.querySelector('.value-wrapper');
    const originalValue = calculateKpiValue(kpi);
    const editBtn = cardElement.querySelector('.edit-kpi-btn');
    const paginationContainer = getEl('pagination');

    if (editBtn) editBtn.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'w-32 bg-gray-100 border-2 border-brand-primary rounded-lg text-center font-bold text-brand-primary text-2xl sm:text-3xl md:text-4xl p-1';
    input.value = originalValue;

    valueWrapper.innerHTML = '';
    valueWrapper.appendChild(input);
    input.focus();
    input.select();

    const saveChanges = async () => {
        const newValue = parseFloat(input.value);

        input.removeEventListener('blur', saveChanges);
        input.removeEventListener('keydown', handleKeydown);

        if (isNaN(newValue) || newValue === originalValue) {
            valueWrapper.innerHTML = `<span class="animated-value">${originalValue.toLocaleString()}</span>`;
            if (editBtn) editBtn.style.display = 'inline-block';
            return;
        }

        valueWrapper.innerHTML = `<i class="fas fa-spinner fa-spin text-brand-primary"></i>`;

        const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
        await updateKpiValueInFirestore(activeQuarterKey, kpi.id, newValue);
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            input.removeEventListener('blur', saveChanges);
            input.removeEventListener('keydown', handleKeydown);
            valueWrapper.innerHTML = `<span class="animated-value">${originalValue.toLocaleString()}</span>`;
            if (editBtn) editBtn.style.display = 'inline-block';
        }
    };

    input.addEventListener('blur', saveChanges);
    input.addEventListener('keydown', handleKeydown);
}

export function showDetailsModal(kpiId, triggerElement) {
    const paginationContainer = getEl('pagination');
    const detailsModal = getEl('details-modal');

    if (!paginationContainer || !detailsModal) {
        console.error("Critical elements missing");
        return;
    }

    const activeQuarter = `q${paginationContainer.querySelector('.active').dataset.quarter}`;

    if (!kpiDataCache[activeQuarter] || !kpiDataCache[activeQuarter].processedKpis) {
        console.error("Data cache not ready for", activeQuarter);
        return;
    }

    const kpi = kpiDataCache[activeQuarter].processedKpis.find(k => k.id === kpiId);
    if (!kpi || !kpi.details) {
        console.error("KPI details not found for", kpiId);
        return;
    }

    const detailsModalTitle = getEl('details-modal-title');
    const detailsModalDescription = getEl('details-modal-description');
    const detailsList = getEl('details-list');
    const detailsAddNewWrapper = getEl('details-add-new-wrapper');

    const { type, title, description, achieved, targetList, items } = kpi.details;
    detailsModalTitle.textContent = title;
    detailsModalDescription.textContent = description;
    detailsList.innerHTML = '';
    detailsAddNewWrapper.innerHTML = '';

    if (type === 'list') {
        const allItems = [...new Set([...(targetList || [])])];
        allItems.forEach(item => {
            const isAchieved = (achieved || []).includes(item);
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center p-2 rounded-lg hover:bg-gray-50';
            li.dataset.itemName = item;

            li.innerHTML = `
                <label class="flex items-center flex-grow cursor-pointer">
                    <input type="checkbox" class="form-checkbox h-5 w-5 text-brand-primary rounded focus:ring-brand-primary" ${isAchieved ? 'checked' : ''} ${!isEditMode ? 'disabled' : ''} data-item-name="${item}">
                    <span class="ml-3 font-semibold item-name">${item}</span>
                </label>
                ${isEditMode ? `
                <div class="item-actions flex items-center">
                    <button class="edit-list-item-btn text-gray-400 hover:text-brand-primary mx-2" aria-label="Edit Item"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-list-item-btn text-red-400 hover:text-red-600" aria-label="Delete Item"><i class="fas fa-trash-alt"></i></button>
                </div>` : ''}
            `;
            detailsList.appendChild(li);
        });

        if (isEditMode) {
            detailsAddNewWrapper.innerHTML = `
                <div class="add-new-form-wrapper border-t pt-4 mt-4">
                    <h4 class="font-semibold text-gray-600 mb-2">Tambah Item Baru</h4>
                    <div class="flex gap-2">
                        <input type="text" id="new-list-item-name" placeholder="Nama Item" class="flex-grow p-2 border rounded-lg">
                        <button id="save-new-list-item-btn" class="bg-brand-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-800 transition-all">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>
            `;
            document.getElementById('save-new-list-item-btn').onclick = async () => {
                const nameInput = document.getElementById('new-list-item-name');
                const newItemName = nameInput.value.trim();
                if (newItemName) {
                    await updateKpiTargetListItem(activeQuarter, kpi.id, newItemName, 'add');
                } else {
                    showToastNotification('Sila masukkan nama item.', 'danger');
                }
            };
        }

        if (isEditMode) {
            detailsList.onclick = async (e) => {
                const checkbox = e.target.closest('input[type="checkbox"]');
                const deleteBtn = e.target.closest('.delete-list-item-btn');
                const editBtn = e.target.closest('.edit-list-item-btn');

                if (checkbox) {
                    const itemName = checkbox.dataset.itemName;
                    const isChecked = checkbox.checked;
                    await updateKpiDetailsList(activeQuarter, kpi.id, itemName, isChecked);
                }
                if (deleteBtn) {
                    const li = deleteBtn.closest('li');
                    const itemName = li.dataset.itemName;
                    await updateKpiTargetListItem(activeQuarter, kpi.id, itemName, 'delete');
                }
                if (editBtn) {
                    const li = editBtn.closest('li');
                    const itemName = li.dataset.itemName;
                    handleEditListItem(li, kpi.id, itemName);
                }
            };
        }

    } else if (type === 'progressList') {
        (items || []).forEach(item => {
            const li = document.createElement('li');
            let percentage;
            if (item.subItems) {
                const subTotal = item.subItems.reduce((sum, sub) => sum + sub.value, 0);
                percentage = item.subItems.length > 0 ? subTotal / item.subItems.length : 0;
            } else {
                percentage = item.value;
            }
            const statusBarColor = getStatusColor(percentage);
            li.innerHTML = `<div class="w-full">
                    <div class="flex justify-between mb-1 items-center">
                        <span class="text-base font-medium text-gray-700">${item.name}</span>
                        <span class="text-sm font-medium text-gray-700 value-wrapper flex items-center">
                            <span class="value-text">${percentage.toFixed(2)}%</span>
                            ${isEditMode && item.hasOwnProperty('value') ? `<button class="edit-kpi-btn" data-item-name="${item.name}" aria-label="Edit Nilai"><i class="fas fa-pencil-alt"></i></button>` : ''}
                        </span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2.5">
                        <div class="${statusBarColor} h-2.5 rounded-full" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                </div>`;
            if (item.subItems) {
                const subList = document.createElement('ul');
                subList.className = 'pl-6 mt-3 space-y-3';
                item.subItems.forEach(subItem => {
                    const subLi = document.createElement('li');
                    const subPercentage = subItem.value;
                    const subStatusBarColor = getStatusColor(subPercentage);
                    subLi.innerHTML = `<div class="w-full">
                            <div class="flex justify-between mb-1 items-center">
                                <span class="text-sm font-medium text-gray-600">${subItem.name}</span>
                                <span class="text-xs font-medium text-gray-600 value-wrapper flex items-center">
                                        <span class="value-text">${subPercentage.toFixed(2)}%</span>
                                    ${isEditMode ? `<button class="edit-kpi-btn" data-item-name="${item.name}" data-subitem-name="${subItem.name}" aria-label="Edit Nilai"><i class="fas fa-pencil-alt"></i></button>` : ''}
                                </span>
                            </div>
                            <div class="w-full bg-gray-200 rounded-full h-2">
                                <div class="${subStatusBarColor} h-2 rounded-full" style="width: ${Math.min(subPercentage, 100)}%"></div>
                            </div>
                        </div>`;
                    subList.appendChild(subLi);
                });
                li.querySelector('.w-full').appendChild(subList);
            }
            detailsList.appendChild(li);
        });
        if (isEditMode) {
            detailsList.onclick = (e) => {
                const editBtn = e.target.closest('.edit-kpi-btn');
                if (editBtn) {
                    const itemName = editBtn.dataset.itemName;
                    const subItemName = editBtn.dataset.subitemName;
                    handleModalEdit(editBtn, kpi.id, itemName, subItemName);
                }
            };
        }
    } else if (type === 'breakdownList') {
        (items || []).forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center p-2 rounded-lg hover:bg-gray-50';
            li.innerHTML = `
                <span class="font-semibold flex-1 item-name">${item.name}</span>
                <span class="font-bold text-brand-primary mx-4 item-value">${item.value.toLocaleString()}</span>
                ${isEditMode ? `
                <div class="item-actions flex items-center">
                    <button class="edit-breakdown-item-btn text-gray-400 hover:text-brand-primary" data-index="${index}"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-breakdown-item-btn text-red-400 hover:text-red-600 ml-2" data-index="${index}"><i class="fas fa-trash-alt"></i></button>
                </div>` : ''}
            `;
            detailsList.appendChild(li);
        });

        if (isEditMode) {
            detailsAddNewWrapper.innerHTML = `
                <div class="add-new-form-wrapper border-t pt-4 mt-4">
                    <div class="flex gap-2">
                        <input type="text" id="new-breakdown-name" placeholder="Nama Butiran" class="w-2/3 p-2 border rounded-lg">
                        <input type="number" id="new-breakdown-value" placeholder="Nilai" class="w-1/3 p-2 border rounded-lg">
                    </div>
                    <button id="save-new-breakdown-btn" class="w-full mt-2 bg-brand-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-800 transition-all">
                        Simpan Butiran
                    </button>
                </div>
            `;
            document.getElementById('save-new-breakdown-btn').onclick = async () => {
                const nameInput = document.getElementById('new-breakdown-name');
                const valueInput = document.getElementById('new-breakdown-value');
                const name = nameInput.value.trim();
                const value = parseFloat(valueInput.value);
                if (name && !isNaN(value)) {
                    await updateKpiBreakdownList(activeQuarter, kpi.id, { name, value }, 'add');
                    nameInput.value = '';
                    valueInput.value = '';
                } else {
                    showToastNotification('Sila isi nama dan nilai yang sah.', 'danger');
                }
            };
            detailsList.onclick = async (e) => {
                const deleteBtn = e.target.closest('.delete-breakdown-item-btn');
                const editBtn = e.target.closest('.edit-breakdown-item-btn');
                if (deleteBtn) {
                    const itemIndex = parseInt(deleteBtn.dataset.index, 10);
                    await updateKpiBreakdownList(activeQuarter, kpi.id, itemIndex, 'delete');
                }
                if (editBtn) {
                    const itemIndex = parseInt(editBtn.dataset.index, 10);
                    const li = editBtn.closest('li');
                    const item = kpi.details.items[itemIndex];
                    handleEditBreakdownItem(li, kpi.id, itemIndex, item);
                }
            };
        }
    }
    openModal(detailsModal, triggerElement);
}

function handleEditListItem(liElement, kpiId, oldItemName) {
    const itemNameSpan = liElement.querySelector('.item-name');
    const itemActions = liElement.querySelector('.item-actions');
    const checkbox = liElement.querySelector('input[type="checkbox"]');
    const label = checkbox.parentElement;
    const paginationContainer = getEl('pagination');

    itemNameSpan.style.display = 'none';
    itemActions.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ml-3 p-1 border rounded-lg bg-gray-100 flex-grow';
    input.value = oldItemName;

    label.appendChild(input);
    input.focus();
    input.select();

    const saveChanges = async () => {
        const newItemName = input.value.trim();
        const cleanup = () => {
            input.removeEventListener('blur', saveChanges);
            input.removeEventListener('keydown', handleKeydown);
            input.remove();
            itemNameSpan.style.display = 'inline';
        };

        if (newItemName && newItemName !== oldItemName) {
            itemNameSpan.textContent = 'Menyimpan...';
            itemNameSpan.style.display = 'inline';
            input.remove();
            const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
            await updateKpiTargetListItem(activeQuarterKey, kpi.id, { oldName: oldItemName, newName: newItemName }, 'edit');
        } else {
            cleanup();
        }
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { cleanup(); }
    };

    input.addEventListener('blur', saveChanges);
    input.addEventListener('keydown', handleKeydown);
}

function handleEditBreakdownItem(liElement, kpiId, itemIndex, item) {
    const originalHTML = liElement.innerHTML;
    const paginationContainer = getEl('pagination');

    liElement.innerHTML = `
        <input type="text" class="flex-1 p-1 border rounded-lg bg-gray-100 edit-name" value="${item.name}">
        <input type="number" class="w-24 p-1 border rounded-lg bg-gray-100 mx-4 edit-value" value="${item.value}">
        <div class="flex items-center">
            <button class="save-breakdown-item-btn text-green-500 hover:text-green-700"><i class="fas fa-check"></i></button>
            <button class="cancel-breakdown-edit-btn text-red-500 hover:text-red-700 ml-2"><i class="fas fa-times"></i></button>
        </div>
    `;

    const nameInput = liElement.querySelector('.edit-name');
    nameInput.focus();
    nameInput.select();

    liElement.querySelector('.save-breakdown-item-btn').onclick = async () => {
        const newName = nameInput.value.trim();
        const newValue = parseFloat(liElement.querySelector('.edit-value').value);

        if (newName && !isNaN(newValue)) {
            const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
            await updateKpiBreakdownList(activeQuarterKey, kpi.id, { index: itemIndex, data: { name: newName, value: newValue } }, 'edit');
        } else {
            showToastNotification('Nama dan nilai tidak sah.', 'danger');
            liElement.innerHTML = originalHTML;
        }
    };

    liElement.querySelector('.cancel-breakdown-edit-btn').onclick = () => {
        liElement.innerHTML = originalHTML;
    };
}

function handleModalEdit(editBtn, kpiId, itemName, subItemName = null) {
    if (!isEditMode) return;
    const valueWrapper = editBtn.closest('.value-wrapper');
    const valueTextElement = valueWrapper.querySelector('.value-text');
    const originalText = valueTextElement.textContent;
    const originalValue = parseFloat(originalText);
    const paginationContainer = getEl('pagination');

    editBtn.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'w-20 bg-gray-100 border border-brand-primary rounded text-center font-bold text-gray-700 p-0.5';
    input.value = originalValue;

    valueTextElement.style.display = 'none';
    valueWrapper.insertBefore(input, editBtn);
    input.focus();
    input.select();

    const saveChanges = async () => {
        const newValue = parseFloat(input.value);
        input.removeEventListener('blur', saveChanges);
        input.removeEventListener('keydown', handleKeydown);

        valueTextElement.style.display = 'inline';
        editBtn.style.display = 'inline-block';
        input.remove();

        if (isNaN(newValue) || newValue === originalValue) return;

        valueTextElement.innerHTML = `<i class="fas fa-spinner fa-spin text-brand-primary"></i>`;
        const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
        await updateKpiProgressListItem(activeQuarterKey, kpiId, itemName, subItemName, newValue);
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') {
            input.removeEventListener('blur', saveChanges);
            input.removeEventListener('keydown', handleKeydown);
            valueTextElement.style.display = 'inline';
            editBtn.style.display = 'inline-block';
            input.remove();
        }
    };

    input.addEventListener('blur', saveChanges);
    input.addEventListener('keydown', handleKeydown);
}

// --- NEW FILTER FUNCTION ---
export function filterDashboardCards(searchTerm, statusFilter) {
    const cards = document.querySelectorAll('.kpi-card');
    const term = searchTerm.toLowerCase();

    cards.forEach(card => {
        const name = card.querySelector('.kpi-name').textContent.toLowerCase();
        const progressBar = card.querySelector('.progress-bar');

        let status = 'all';
        if (progressBar.classList.contains('bg-status-good')) status = 'good';
        else if (progressBar.classList.contains('bg-status-ok')) status = 'ok';
        else if (progressBar.classList.contains('bg-status-bad')) status = 'bad';

        const matchesSearch = name.includes(term);
        const matchesStatus = statusFilter === 'all' || status === statusFilter;

        if (matchesSearch && matchesStatus) {
            card.classList.remove('hidden');
            card.classList.add('flex'); // Restore flex
        } else {
            card.classList.add('hidden');
            card.classList.remove('flex');
        }
    });
}



// --- HELPER FUNCTIONS (Exported) ---

export function animateValue(element, start, end, duration, formatter) {
    let startTime = null;
    // Add distinct style during animation
    element.style.fontFamily = "'Courier New', monospace"; // Monospace for stability

    const step = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);

        // DECODING EFFECT
        // Instead of smooth scroll, we add random "noise" that decreases over time.
        // Noise factor shrinks as progress approaches 1.

        if (progress < 1) {
            // Factor: How much noise? 
            // We want it to look like it's "searching". 
            // Range: 0 to 99 roughly.

            // Phase 1: High noise (0% - 60%)
            // Phase 2: Converging (60% - 100%)

            let displayVal;

            if (progress < 0.6) {
                // Pure random chaos
                displayVal = Math.random() * 100;
            } else {
                // Converging to strict value
                // Interpolate from a Random point towards End
                const subProgress = (progress - 0.6) / 0.4; // 0 to 1
                const noise = (Math.random() - 0.5) * 20 * (1 - subProgress); // +/- 10 noise fading to 0
                displayVal = end + noise;
            }

            // Prevent negative layout shifts if possible, but random is random.
            element.innerHTML = formatter(Math.abs(displayVal));

            // Visual glitch color
            element.style.color = (Math.random() > 0.8) ? '#22c55e' : ''; // Occasional green flash

            window.requestAnimationFrame(step);
        } else {
            // Final Frame
            element.innerHTML = formatter(end);
            element.style.fontFamily = ""; // Reset font
            element.style.color = ""; // Reset color
        }
    };
    window.requestAnimationFrame(step);
}

export function getStatusColor(percentage) {
    if (percentage >= 75) return 'bg-status-good';
    if (percentage >= 30) return 'bg-status-ok';
    return 'bg-status-bad';
}

export function showToastNotification(message, type = 'info') {
    if (toastTimeout) clearTimeout(toastTimeout);

    const toast = getEl('toast-notification');
    const toastMessage = getEl('toast-message');
    const toastIcon = getEl('toast-icon');

    const types = {
        success: { class: 'text-green-500', icon: 'fa-check-circle', border: 'border-green-500' },
        danger: { class: 'text-red-500', icon: 'fa-exclamation-triangle', border: 'border-red-500' },
        info: { class: 'text-blue-500', icon: 'fa-info-circle', border: 'border-blue-500' }
    };

    const config = types[type];

    toast.className = `fixed right-4 top-4 bg-white rounded-lg shadow-xl border-l-4 overflow-hidden z-50 ${config.border}`;
    toastIcon.className = `fas ${config.icon} text-xl ${config.class}`;
    toastMessage.textContent = message;

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

export function openModal(modalElement, triggerElement) {
    if (!modalElement) return;
    lastFocusedElement = triggerElement || document.activeElement;
    modalElement.classList.add('is-open');
    const firstFocusableElement = modalElement.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstFocusableElement) firstFocusableElement.focus();

    if (modalElement.id === 'password-modal') {
        const inputArea = document.getElementById('terminal-input-area');
        if (inputArea && !inputArea.classList.contains('hidden')) {
            const terminalInput = document.getElementById('email-input');
            if (terminalInput && !terminalInput.classList.contains('input-disabled')) terminalInput.focus();
        }
    }
}

export function closeModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.remove('is-open');
    if (lastFocusedElement) lastFocusedElement.focus();

    if (modalElement.id === 'password-modal') {
        const event = new CustomEvent('modal-closed', { detail: { modalId: 'password-modal' } });
        document.dispatchEvent(event);
    }
}

// Helper Calculation for Cards (Exported)
export function calculateKpiValue(kpi) {
    if (kpi.details && kpi.details.type === 'breakdownList' && kpi.details.items) {
        return kpi.details.items.reduce((sum, item) => sum + (item.value || 0), 0);
    }
    if (typeof kpi.value === 'number') {
        return kpi.value;
    }
    if (kpi.details) {
        if (kpi.details.type === 'progressList' && kpi.details.items) {
            const total = kpi.details.items.reduce((sum, item) => {
                if (item.subItems) {
                    const subTotal = item.subItems.reduce((subSum, sub) => subSum + sub.value, 0);
                    return sum + (item.subItems.length > 0 ? subTotal / item.subItems.length : 0);
                }
                return sum + item.value;
            }, 0);
            return kpi.details.items.length > 0 ? total / kpi.details.items.length : 0;
        }
        if (kpi.details.type === 'list' && kpi.details.achieved) {
            return kpi.details.achieved.length;
        }
    }
    return 0;
}

export function getKpiPercentage(kpi) {
    const value = calculateKpiValue(kpi);
    if (kpi.isPercentage) return value;
    return kpi.target > 0 ? (value / kpi.target) * 100 : 0;
}