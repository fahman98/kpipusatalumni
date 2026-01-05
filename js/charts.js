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

    // Needle Plugin
    const needlePlugin = {
        id: 'needle',
        afterDatasetDraw(chart, args, options) {
            const { ctx, config, data, chartArea: { top, bottom, left, right, width, height } } = chart;
            ctx.save();

            const dataTotal = 100; // Fixed total for percentage
            const needleValue = value;
            const needleAngle = Math.PI + (1 / dataTotal * needleValue * Math.PI); // Map 0-100 to PI-2PI (though rotation handles the offset)

            // Center of chart
            const cx = width / 2;
            const cy = chart._metasets[0].data[0].y; // Approximate center Y based on arc

            // Translate to center
            ctx.translate(cx, cy);

            // Calculate rotation. 
            // -90deg rotation in config means 0 is at top? No.
            // Config: rotation: -90, circumference: 180.
            // This means the arc goes from -PI to 0 (top-left to top-right visually if not rotated? Wait.)
            // ChartJS standard: 0 is right (3 o'clock). 
            // Rotation -90 (or 270) brings 0 to top (12 o'clock).
            // Circumference 180 means it draws half circle.
            // We want 0% at left (9 o'clock) and 100% at right (3 o'clock).
            // Standard Doughnut: Start at 12. 
            // Rotation -90 -> Start at 9. 
            // So 0 degrees = 9 o'clock. 180 degrees = 3 o'clock.

            // Mapping Value (0-100) to Radians (0 - PI)
            // But we rotated -90deg (which is -PI/2). 
            // Let's use simple math: 0% = -PI (points left), 50% = -PI/2 (up), 100% = 0 (right).

            // Correct approach for Needle Angle:
            // 0%  -> Angle -PI
            // 100% -> Angle 0
            const angle = Math.PI + ((value / 100) * Math.PI);

            ctx.rotate(angle);

            // Draw Needle
            ctx.beginPath();
            ctx.moveTo(0, -2);
            ctx.lineTo(height / 2 - 10, 0); // Restore Length of needle to overlap text
            ctx.lineTo(0, 2);
            ctx.fillStyle = '#fff';
            ctx.fill();

            // Needle Dot
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();

            ctx.restore();
        }
    };

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
        plugins: [needlePlugin]
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