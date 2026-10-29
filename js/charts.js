// --- JS/CHARTS.JS ---
import { animateValue, getKpiPercentage, calculateKpiValue, openModal, showToastNotification } from './ui.js';
import { kpiDataCache, getKpiDataFromFirestore, selectedYear } from './api.js';
import { statusHex, statusTier, kpiStatusPct, isPacedKpi, getPaceFraction, expectedFraction,
         paceAdjustedPct, quarterStarted, STATUS_LABEL } from './status.js';

const QUARTER_TITLES = { q1: 'Suku Pertama', q2: 'Suku Kedua', q3: 'Suku Ketiga', q4: 'Suku Keempat' };

// Chart.js wraps a label given as an array, one entry per line. Long KPI
// names otherwise squeeze the bars to nothing on a phone.
function wrapLabel(text, max = 22) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    words.forEach(w => {
        if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; }
        else line = line ? `${line} ${w}` : w;
    });
    if (line) lines.push(line);
    return lines;
}

// Dashed vertical marker at the expected-by-now percentage on the breakdown
// chart — the same marker the KPI cards draw on their bars.
const paceLinePlugin = {
    id: 'paceLine',
    afterDatasetsDraw(chart, _args, opts) {
        if (opts == null || opts.value == null) return;
        const { ctx, chartArea, scales } = chart;
        const x = scales.x.getPixelForValue(opts.value);
        ctx.save();
        ctx.strokeStyle = opts.color || '#1f2937';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
    }
};

let kpiChartInstance = null;
let gaugeChartInstance = null;

export function destroyKpiChart() {
    if (kpiChartInstance) {
        kpiChartInstance.destroy();
        kpiChartInstance = null;
    }
}


// `value` is the overall achievement drawn on the arc; `statusPct` is the
// pace-adjusted figure that picks its colour, so the gauge agrees with the
// cards (a red-to-green gradient painted every early quarter red).
export function renderGaugeChart(value, statusPct = value) {
    const canvas = document.getElementById('overall-gauge-chart');
    if (!canvas) return;
    const overallGaugeCtx = canvas.getContext('2d');
    const gaugeText = document.getElementById('gauge-value-text');
    animateValue(gaugeText, 0, value, 1500, val => `${val.toFixed(1)}%`);

    if (gaugeChartInstance) {
        gaugeChartInstance.destroy();
    }



    gaugeChartInstance = new Chart(overallGaugeCtx, {
        type: 'doughnut',
        data: {
            labels: ['Score', 'Gray'],
            datasets: [{
                data: [value, 100 - value],
                backgroundColor: [
                    statusHex(statusPct),
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
    const chartModalNote = document.getElementById('chart-modal-note');
    const chartModal = document.getElementById('chart-modal');
    const paginationContainer = document.getElementById('pagination');
    const isDark = document.body.classList.contains('dark-mode');

    const setNote = (text) => {
        if (!chartModalNote) return;
        chartModalNote.textContent = text || '';
        chartModalNote.classList.toggle('hidden', !text);
    };

    if (kpiChartInstance) {
        kpiChartInstance.destroy();
    }
    Chart.defaults.color = isDark ? '#9ca3af' : '#6b7280';
    const gridColor = isDark ? '#374151' : '#f3f4f6';

    if (kpiId === 'overall') {
        // Breakdown of the active quarter: one horizontal bar per KPI. This was
        // a pie, but the slices were percentages of different KPIs, which don't
        // add up to any whole, so slice sizes meant nothing.
        const activeQuarterKey = `q${paginationContainer.querySelector('.active').dataset.quarter}`;
        const quarterData = kpiDataCache[activeQuarterKey];

        if (!quarterData || quarterData.placeholder || !quarterData.processedKpis) {
            showToastNotification('Data untuk suku tahun ini belum tersedia.', 'danger');
            return;
        }

        const kpis = quarterData.processedKpis;
        const pcts = kpis.map(kpi => getKpiPercentage(kpi));
        const tiers = kpis.map((kpi, i) => statusTier(kpiStatusPct(kpi, pcts[i])));
        const fraction = getPaceFraction();
        const expectedPct = fraction < 1 && kpis.some(isPacedKpi) ? fraction * 100 : null;
        const quarterTitle = quarterData.title || QUARTER_TITLES[activeQuarterKey];

        chartModalTitle.textContent = `Pecahan Pencapaian ${quarterTitle}`;
        setNote(expectedPct != null
            ? `Garis putus-putus: jangkaan setakat ini (${Math.round(expectedPct)}% daripada sasaran tahunan). Warna bar mengikut status.`
            : 'Warna bar mengikut status.');

        kpiChartInstance = new Chart(kpiHistoryChartCtx, {
            type: 'bar',
            data: {
                labels: kpis.map(kpi => wrapLabel(kpi.name)),
                datasets: [{
                    label: 'Pencapaian (%)',
                    data: pcts,
                    backgroundColor: kpis.map((kpi, i) => statusHex(kpiStatusPct(kpi, pcts[i]))),
                    borderRadius: 6,
                    maxBarThickness: 26
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        suggestedMax: 100,
                        grid: { color: gridColor },
                        ticks: { callback: v => `${v}%` }
                    },
                    y: { grid: { display: false }, ticks: { autoSkip: false } }
                },
                plugins: {
                    legend: { display: false },
                    paceLine: { value: expectedPct, color: isDark ? '#e5e7eb' : '#1f2937' },
                    tooltip: {
                        callbacks: {
                            title: (items) => kpis[items[0].dataIndex].name,
                            label: (c) => `${c.parsed.x.toFixed(1)}% · ${STATUS_LABEL[tiers[c.dataIndex]]}`
                        }
                    }
                }
            },
            plugins: [paceLinePlugin]
        });
    } else {
        const allQuarters = ['q1', 'q2', 'q3', 'q4'];
        const promises = allQuarters.map(q => getKpiDataFromFirestore(q));
        const results = await Promise.all(promises);
        const year = selectedYear;

        // Values are carried forward into later quarters, so a quarter that
        // hasn't begun would otherwise show a full bar it never earned.
        const started = allQuarters.map((_, i) => quarterStarted(year, i + 1));

        const valueData = [];
        const targetData = [];
        const expectedData = [];
        const barColors = [];
        let kpiName = '', isPercentage = false, isCurrency = false, paced = false;

        results.forEach((data, i) => {
            const kpi = data && data.kpis ? data.kpis.find(k => k.id === kpiId) : null;
            if (!kpi || !started[i]) {
                valueData.push(null);
                targetData.push(kpi ? kpi.target : null);
                expectedData.push(null);
                barColors.push('#9ca3af');
                if (kpi && !kpiName) ({ name: kpiName, isPercentage, isCurrency } = kpi);
                return;
            }
            if (!kpiName) ({ name: kpiName, isPercentage, isCurrency } = kpi);
            paced = isPacedKpi(kpi);
            const fraction = expectedFraction(year, i + 1);
            const pct = getKpiPercentage(kpi);
            const statusPct = paced ? paceAdjustedPct(pct, fraction) : pct;
            valueData.push(calculateKpiValue(kpi));
            targetData.push(kpi.target);
            expectedData.push(paced && typeof kpi.target === 'number' ? kpi.target * fraction : null);
            barColors.push(statusHex(statusPct));
        });

        const fmt = (v) => v == null ? '—'
            : isPercentage ? `${Number(v).toFixed(1)}%`
            : isCurrency ? `RM ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });

        const labels = allQuarters.map((_, i) => started[i] ? `Suku ${i + 1}` : [`Suku ${i + 1}`, '(belum bermula)']);
        const datasets = [
            {
                type: 'line',
                label: 'Sasaran tahunan',
                data: targetData,
                borderColor: '#ef4444',
                borderWidth: 2,
                borderDash: [5, 5],
                pointBackgroundColor: '#ef4444',
                pointRadius: 2,
                fill: false,
                tension: 0
            },
            {
                type: 'bar',
                label: 'Pencapaian',
                data: valueData,
                backgroundColor: barColors,
                borderRadius: 6,
                maxBarThickness: 56
            }
        ];
        if (paced && expectedData.some(v => v != null)) {
            datasets.splice(1, 0, {
                type: 'line',
                label: 'Jangkaan setakat suku',
                data: expectedData,
                borderColor: isDark ? '#e5e7eb' : '#1f2937',
                borderWidth: 1.5,
                pointRadius: 3,
                pointBackgroundColor: isDark ? '#e5e7eb' : '#1f2937',
                fill: false,
                tension: 0,
                spanGaps: false
            });
        }

        chartModalTitle.textContent = `Analisis Prestasi: ${kpiName}`;
        const notStarted = started.filter(s => !s).length;
        setNote([
            paced ? 'Warna bar dinilai berbanding jangkaan setakat suku tersebut.' : 'Warna bar mengikut status.',
            notStarted ? 'Suku yang belum bermula tidak dipaparkan.' : ''
        ].filter(Boolean).join(' '));

        kpiChartInstance = new Chart(kpiHistoryChartCtx, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        ticks: { callback: value => fmt(value) }
                    },
                    x: {
                        grid: { display: false }
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1f2937',
                        bodyColor: '#1f2937',
                        borderColor: '#e5e7eb',
                        borderWidth: 1,
                        callbacks: {
                            title: (items) => `Suku ${items[0].dataIndex + 1}`,
                            label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}`
                        }
                    },
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12 }
                    }
                }
            }
        });
    }
    openModal(chartModal, triggerElement);
}
