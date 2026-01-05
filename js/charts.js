// --- JS/CHARTS.JS ---
import { animateValue, getKpiPercentage, calculateKpiValue, openModal, showToastNotification } from './ui.js';
import { kpiDataCache, getKpiDataFromFirestore } from './api.js';

let kpiChartInstance = null;
let gaugeChartInstance = null;


export function renderGaugeChart(value) {
    const overallGaugeCtx = document.getElementById('overall-gauge-chart').getContext('2d');
    const gaugeText = document.getElementById('gauge-value-text');
    animateValue(gaugeText, 0, value, 1500, val => `${val.toFixed(2)}%`);

    if (gaugeChartInstance) {
        gaugeChartInstance.destroy();
    }



    // Create Gradient
    const gradient = overallGaugeCtx.createLinearGradient(0, 0, 300, 0); // Left to Right
    gradient.addColorStop(0, '#ef4444'); // Red
    gradient.addColorStop(0.5, '#eab308'); // Yellow
    gradient.addColorStop(1, '#22c55e'); // Green

    gaugeChartInstance = new Chart(overallGaugeCtx, {
        type: 'doughnut',
        data: {
            labels: ['Score', 'Gray'],
            datasets: [{
                data: [value, 100 - value],
                backgroundColor: [
                    gradient,
                    'rgba(255, 255, 255, 0.1)'
                ],
                borderWidth: 0,
                borderRadius: 10, // Rounded ends
                cutout: '85%', // Thinner arc
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            rotation: -90,
            circumference: 180,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: {
                animateScale: true,
                animateRotate: true
            }
        },
        plugins: []
    });
}



export async function showHistoryChart(kpiId, triggerElement) {
    const kpiHistoryChartCtx = document.getElementById('kpi-history-chart').getContext('2d');
    const chartModalTitle = document.getElementById('chart-modal-title');
    const chartModal = document.getElementById('chart-modal');
    const paginationContainer = document.getElementById('pagination');

    if (kpiChartInstance) {
        kpiChartInstance.destroy();
    }
    Chart.defaults.color = '#6b7280';

    if (kpiId === 'overall') {
        const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
        const quarterData = kpiDataCache[activeQuarterKey];

        if (!quarterData || quarterData.placeholder || !quarterData.processedKpis) {
            showToastNotification('Data untuk suku tahun ini belum tersedia.', 'danger');
            return;
        }

        const chartTitle = `Pecahan Pencapaian ${quarterData.title}`;
        const labels = quarterData.processedKpis.map(kpi => kpi.name);
        const data = quarterData.processedKpis.map(kpi => getKpiPercentage(kpi));

        chartModalTitle.textContent = chartTitle;
        kpiChartInstance = new Chart(kpiHistoryChartCtx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pencapaian (%)',
                    data: data,
                    backgroundColor: ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6'],
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12 } },
                    tooltip: { callbacks: { label: (c) => `${c.label || ''}: ${c.parsed.toFixed(2)}%` } }
                }
            },
        });
    } else {
        const allQuarters = ['q1', 'q2', 'q3', 'q4'];
        const promises = allQuarters.map(q => getKpiDataFromFirestore(q));
        const results = await Promise.all(promises);

        const valueData = [];
        const targetData = [];
        let kpiName = '', isPercentage = false;

        results.forEach(data => {
            if (data && data.kpis) {
                const kpi = data.kpis.find(k => k.id === kpiId);
                if (kpi) {
                    valueData.push(calculateKpiValue(kpi));
                    targetData.push(kpi.target);
                    if (!kpiName) ({ name: kpiName, isPercentage } = kpi);
                } else {
                    valueData.push(null);
                    targetData.push(null);
                }
            } else {
                valueData.push(null);
                targetData.push(null);
            }
        });

        chartModalTitle.textContent = `Analisis Prestasi: ${kpiName}`;
        kpiChartInstance = new Chart(kpiHistoryChartCtx, {
            type: 'bar',
            data: {
                labels: ['Suku 1', 'Suku 2', 'Suku 3', 'Suku 4'],
                datasets: [
                    {
                        type: 'line',
                        label: 'Sasaran',
                        data: targetData,
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointBackgroundColor: '#ef4444',
                        fill: false,
                        tension: 0.1
                    },
                    {
                        type: 'bar',
                        label: 'Pencapaian Sebenar',
                        data: valueData,
                        backgroundColor: 'rgba(13, 71, 161, 0.7)',
                        borderColor: '#0d47a1',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f3f4f6' },
                        ticks: { callback: value => isPercentage ? value.toFixed(2) + '%' : value }
                    },
                    x: {
                        grid: { display: false }
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        titleColor: '#1f2937',
                        bodyColor: '#1f2937',
                        borderColor: '#e5e7eb',
                        borderWidth: 1
                    },
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }
    openModal(chartModal, triggerElement);
}