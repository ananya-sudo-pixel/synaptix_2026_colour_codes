/* ============================
   VitalSync — Real-Time Health Monitoring Engine
   Vitals Simulation · Correlation Analysis · Risk Prediction · Anomaly Detection
   ============================ */

// ======================== CONFIG ========================
const CONFIG = {
    updateInterval: 2000,       // ms between data updates
    chartPoints: 40,            // data points in mini-charts
    trendPoints: 60,            // data points in trend charts
    anomalyCheckInterval: 8000, // ms between anomaly checks
    correlationWindow: 20,      // samples for correlation calculation
    signals: ['hr', 'spo2', 'bp_sys', 'bp_dia', 'temp', 'rr', 'hrv'],
    signalLabels: { hr: 'HR', spo2: 'SpO2', bp_sys: 'Sys BP', bp_dia: 'Dia BP', temp: 'Temp', rr: 'RR', hrv: 'HRV' },
    signalColors: {
        hr: '#ff006e', spo2: '#00d4ff', bp_sys: '#a855f7', bp_dia: '#8b5cf6',
        temp: '#ffb800', rr: '#00ff88', hrv: '#3b82f6'
    }
};

// ======================== STATE ========================
const state = {
    vitals: {
        hr:     { value: 72, baseline: 72, min: 55, max: 105, variance: 3, unit: 'BPM', history: [] },
        spo2:   { value: 98, baseline: 98, min: 92, max: 100, variance: 0.5, unit: '%', history: [] },
        bp_sys: { value: 120, baseline: 120, min: 95, max: 150, variance: 4, unit: 'mmHg', history: [] },
        bp_dia: { value: 80, baseline: 80, min: 60, max: 100, variance: 3, unit: 'mmHg', history: [] },
        temp:   { value: 98.6, baseline: 98.6, min: 96.5, max: 101, variance: 0.2, unit: '°F', history: [] },
        rr:     { value: 16, baseline: 16, min: 10, max: 25, variance: 1.5, unit: 'br/min', history: [] },
        hrv:    { value: 42, baseline: 42, min: 15, max: 80, variance: 4, unit: 'ms', history: [] }
    },
    correlations: {},
    risks: {
        cardio:      { value: 12, target: 12, factors: [] },
        respiratory: { value: 8, target: 8, factors: [] },
        metabolic:   { value: 15, target: 15, factors: [] },
        apnea:       { value: 6, target: 6, factors: [] }
    },
    anomalies: [],
    anomalyStats: { total: 0, critical: 0, resolved: 0 },
    trendData: { hr: [], spo2: [], bp_sys: [], bp_dia: [], rr: [], hrv: [] },
    tick: 0,
    anomalyMode: false,       // when true, simulate a multi-signal anomaly
    anomalyModeStart: 0,
    nextAnomalyTick: 30       // first anomaly event after ~60 seconds
};

// ======================== UTILITIES ========================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function gaussRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function formatTime(d) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
function pearsonCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 5) return 0;
    const xs = x.slice(-n), ys = y.slice(-n);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        const xd = xs[i] - mx, yd = ys[i] - my;
        num += xd * yd;
        dx += xd * xd;
        dy += yd * yd;
    }
    const denom = Math.sqrt(dx * dy);
    return denom === 0 ? 0 : num / denom;
}

// ======================== VITALS SIMULATOR ========================
function generateVital(signal) {
    const v = state.vitals[signal];
    const tick = state.tick;

    // Circadian-like slow oscillation
    const circadian = Math.sin(tick * 0.02) * v.variance * 0.5;
    // Noise
    const noise = gaussRandom() * v.variance;

    // Mean-reversion toward baseline
    const reversion = (v.baseline - v.value) * 0.08;

    let newVal = v.value + reversion + circadian * 0.1 + noise;

    // During anomaly mode, create subtle correlated drifts
    if (state.anomalyMode) {
        const elapsed = tick - state.anomalyModeStart;
        const severity = Math.min(elapsed / 15, 1); // ramp over 15 ticks (~30s)

        switch (signal) {
            case 'hr':    newVal += severity * 8 + gaussRandom() * 2; break;
            case 'spo2':  newVal -= severity * 2.5 + Math.abs(gaussRandom()) * 0.5; break;
            case 'rr':    newVal += severity * 4 + gaussRandom(); break;
            case 'hrv':   newVal -= severity * 10 + Math.abs(gaussRandom()) * 2; break;
            case 'bp_sys': newVal += severity * 6 + gaussRandom() * 2; break;
            case 'temp':  newVal += severity * 0.6 + gaussRandom() * 0.1; break;
        }

        // End anomaly after ~20 ticks (40s) — auto-resolve
        if (elapsed > 20) {
            state.anomalyMode = false;
            addAnomaly('auto-resolved', 'Multi-Signal Pattern Normalized',
                'Correlation patterns have returned to baseline. The transient divergence resolved without intervention.',
                ['HR', 'SpO2', 'HRV'], 'low');
            state.nextAnomalyTick = tick + 25 + Math.floor(Math.random() * 20);
        }
    }

    newVal = clamp(newVal, v.min, v.max);
    if (signal === 'spo2') newVal = Math.round(newVal * 10) / 10;
    if (signal === 'temp') newVal = Math.round(newVal * 10) / 10;
    else if (signal !== 'spo2') newVal = Math.round(newVal * 10) / 10;

    v.value = newVal;
    v.history.push(newVal);
    if (v.history.length > CONFIG.chartPoints) v.history.shift();
}

function updateAllVitals() {
    state.tick++;

    // Check if should trigger anomaly mode
    if (!state.anomalyMode && state.tick >= state.nextAnomalyTick) {
        state.anomalyMode = true;
        state.anomalyModeStart = state.tick;
        addAnomaly('active', 'Multi-Signal Correlation Divergence Detected',
            'HR-SpO2 inverse correlation strengthening while HRV is declining. This pattern may indicate early-stage autonomic stress response. Monitoring closely.',
            ['HR↔SpO2', 'HRV Decline', 'Correlation Shift'], 'medium');
    }

    CONFIG.signals.forEach(s => generateVital(s));

    // Store trend data
    ['hr', 'spo2', 'bp_sys', 'bp_dia', 'rr', 'hrv'].forEach(s => {
        state.trendData[s].push(state.vitals[s].value);
        if (state.trendData[s].length > CONFIG.trendPoints) state.trendData[s].shift();
    });

    updateCorrelations();
    updateRisks();
    renderVitals();
    renderCorrelationMatrix();
    renderRisks();
    renderTrendCharts();
    updateHeader();
}

// ======================== CORRELATION ENGINE ========================
function updateCorrelations() {
    const matrixSignals = ['hr', 'spo2', 'bp_sys', 'temp', 'rr', 'hrv'];
    for (let i = 0; i < matrixSignals.length; i++) {
        for (let j = 0; j < matrixSignals.length; j++) {
            const key = `${matrixSignals[i]}_${matrixSignals[j]}`;
            if (i === j) {
                state.correlations[key] = 1;
            } else {
                const x = state.vitals[matrixSignals[i]].history;
                const y = state.vitals[matrixSignals[j]].history;
                state.correlations[key] = pearsonCorrelation(x, y);
            }
        }
    }
}

// ======================== RISK PREDICTION ENGINE ========================
function updateRisks() {
    const v = state.vitals;

    // Cardiovascular: HR, BP, HRV
    const hrDev = Math.abs(v.hr.value - v.hr.baseline) / v.hr.baseline;
    const bpDev = Math.abs(v.bp_sys.value - v.bp_sys.baseline) / v.bp_sys.baseline;
    const hrvDev = Math.abs(v.hrv.value - v.hrv.baseline) / v.hrv.baseline;
    const hrBpCorr = Math.abs(state.correlations['hr_bp_sys'] || 0);
    let cardioRisk = (hrDev * 30 + bpDev * 25 + hrvDev * 25 + hrBpCorr * 20) * 100;
    cardioRisk = clamp(cardioRisk, 3, 95);
    state.risks.cardio.target = Math.round(cardioRisk);
    state.risks.cardio.factors = [
        `HR-BP Sync: ${hrBpCorr > 0.5 ? 'Elevated' : 'Normal'}`,
        `HRV Stability: ${hrvDev < 0.15 ? 'Good' : hrvDev < 0.3 ? 'Fair' : 'Poor'}`
    ];

    // Respiratory: SpO2, RR, HR
    const spo2Dev = Math.abs(v.spo2.value - v.spo2.baseline) / v.spo2.baseline;
    const rrDev = Math.abs(v.rr.value - v.rr.baseline) / v.rr.baseline;
    const spo2RrCorr = Math.abs(state.correlations['spo2_rr'] || 0);
    let respRisk = (spo2Dev * 35 + rrDev * 30 + hrDev * 15 + spo2RrCorr * 20) * 100;
    respRisk = clamp(respRisk, 2, 95);
    state.risks.respiratory.target = Math.round(respRisk);
    state.risks.respiratory.factors = [
        `SpO2-RR Sync: ${spo2RrCorr > 0.5 ? 'Diverging' : 'Normal'}`,
        `Breathing Pattern: ${rrDev < 0.15 ? 'Regular' : 'Irregular'}`
    ];

    // Metabolic: Temp, HR, BP
    const tempDev = Math.abs(v.temp.value - v.temp.baseline) / v.temp.baseline;
    const tempHrCorr = Math.abs(state.correlations['temp_hr'] || 0);
    let metaRisk = (tempDev * 30 + hrDev * 25 + bpDev * 20 + tempHrCorr * 25) * 100;
    metaRisk = clamp(metaRisk, 3, 95);
    state.risks.metabolic.target = Math.round(metaRisk);
    state.risks.metabolic.factors = [
        `Temp-HR Pattern: ${tempHrCorr > 0.5 ? 'Coupling' : 'Normal'}`,
        `Circadian Rhythm: ${tempDev < 0.005 ? 'Aligned' : 'Shifted'}`
    ];

    // Sleep Apnea: SpO2, RR, HRV
    const spo2HrvCorr = Math.abs(state.correlations['spo2_hrv'] || 0);
    let apneaRisk = (spo2Dev * 35 + rrDev * 25 + hrvDev * 20 + spo2HrvCorr * 20) * 100;
    apneaRisk = clamp(apneaRisk, 1, 95);
    state.risks.apnea.target = Math.round(apneaRisk);
    state.risks.apnea.factors = [
        `Night SpO2 Dips: ${spo2Dev > 0.02 ? 'Detected' : 'None'}`,
        `RR Irregularity: ${rrDev < 0.1 ? 'Low' : 'Moderate'}`
    ];
}

// ======================== ANOMALY EVENTS ========================
function addAnomaly(status, title, description, tags, severity) {
    const now = new Date();
    state.anomalies.unshift({
        id: Date.now(),
        time: formatTime(now),
        title,
        description,
        tags,
        severity,
        status
    });

    if (state.anomalies.length > 15) state.anomalies.pop();

    state.anomalyStats.total = state.anomalies.length;
    state.anomalyStats.critical = state.anomalies.filter(a => a.severity === 'high' || a.status === 'active').length;
    state.anomalyStats.resolved = state.anomalies.filter(a => a.status === 'auto-resolved').length;

    renderAnomalyTimeline();
}

// ======================== RENDERING ========================
function renderVitals() {
    const v = state.vitals;

    // HR
    updateVitalCard('hr', Math.round(v.hr.value), v.hr);
    // SpO2
    updateVitalCard('spo2', Math.round(v.spo2.value), v.spo2);
    // BP
    const bpEl = document.getElementById('bp-value');
    if (bpEl) bpEl.textContent = `${Math.round(v.bp_sys.value)}/${Math.round(v.bp_dia.value)}`;
    updateVitalStatus('bp', v.bp_sys);
    // Temp
    updateVitalCard('temp', v.temp.value.toFixed(1), v.temp);
    // RR
    updateVitalCard('rr', Math.round(v.rr.value), v.rr);
    // HRV
    updateVitalCard('hrv', Math.round(v.hrv.value), v.hrv);

    // Render mini charts
    renderMiniChart('hr-chart', v.hr.history, CONFIG.signalColors.hr, v.hr.min, v.hr.max);
    renderMiniChart('spo2-chart', v.spo2.history, CONFIG.signalColors.spo2, v.spo2.min, v.spo2.max);
    renderMiniChart('bp-chart', v.bp_sys.history, CONFIG.signalColors.bp_sys, v.bp_sys.min, v.bp_sys.max);
    renderMiniChart('temp-chart', v.temp.history, CONFIG.signalColors.temp, v.temp.min, v.temp.max);
    renderMiniChart('rr-chart', v.rr.history, CONFIG.signalColors.rr, v.rr.min, v.rr.max);
    renderMiniChart('hrv-chart', v.hrv.history, CONFIG.signalColors.hrv, v.hrv.min, v.hrv.max);
}

function updateVitalCard(signal, displayValue, vitalObj) {
    const el = document.getElementById(`${signal}-value`);
    if (el) el.textContent = displayValue;
    updateVitalStatus(signal, vitalObj);
    updateVitalTrend(signal, vitalObj);
}

function updateVitalStatus(signal, vitalObj) {
    const statusEl = document.getElementById(`${signal}-status`);
    if (!statusEl) return;
    const deviation = Math.abs(vitalObj.value - vitalObj.baseline) / Math.abs(vitalObj.max - vitalObj.min);
    if (deviation > 0.35) {
        statusEl.textContent = 'Alert';
        statusEl.className = 'vital-status vital-status-alert';
    } else if (deviation > 0.18) {
        statusEl.textContent = 'Watch';
        statusEl.className = 'vital-status vital-status-warning';
    } else {
        statusEl.textContent = 'Normal';
        statusEl.className = 'vital-status vital-status-normal';
    }
}

function updateVitalTrend(signal, vitalObj) {
    const trendEl = document.getElementById(`${signal}-trend`);
    if (!trendEl || vitalObj.history.length < 5) return;
    const recent = vitalObj.history.slice(-5);
    const older = vitalObj.history.slice(-10, -5);
    if (older.length === 0) return;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const pctChange = ((recentAvg - olderAvg) / olderAvg * 100).toFixed(1);

    if (pctChange > 1) {
        trendEl.textContent = `↗ +${pctChange}%`;
        trendEl.className = 'vital-trend trend-up';
    } else if (pctChange < -1) {
        trendEl.textContent = `↘ ${pctChange}%`;
        trendEl.className = 'vital-trend trend-down';
    } else {
        trendEl.textContent = `→ ${pctChange}%`;
        trendEl.className = 'vital-trend trend-stable';
    }
}

// ======================== MINI CHARTS ========================
function renderMiniChart(containerId, data, color, minVal, maxVal) {
    const container = document.getElementById(containerId);
    if (!container || data.length < 2) return;

    let canvas = container.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        container.appendChild(canvas);
    }

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const w = rect.width;
    const h = rect.height;
    const padding = 4;
    const range = maxVal - minVal || 1;

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '30');
    gradient.addColorStop(1, color + '05');

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = padding + (i / (data.length - 1)) * (w - padding * 2);
        const y = padding + (1 - (data[i] - minVal) / range) * (h - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.lineTo(padding + w - padding * 2, h);
    ctx.lineTo(padding, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = padding + (i / (data.length - 1)) * (w - padding * 2);
        const y = padding + (1 - (data[i] - minVal) / range) * (h - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw endpoint dot
    const lastX = padding + (w - padding * 2);
    const lastY = padding + (1 - (data[data.length - 1] - minVal) / range) * (h - padding * 2);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// ======================== CORRELATION MATRIX ========================
const matrixSignals = ['hr', 'spo2', 'bp_sys', 'temp', 'rr', 'hrv'];
const matrixLabels = ['HR', 'SpO2', 'Sys BP', 'Temp', 'RR', 'HRV'];

function buildCorrelationMatrix() {
    const headerRow = document.getElementById('matrix-header-row');
    const body = document.getElementById('matrix-body');

    // Clear
    headerRow.innerHTML = '<div class="matrix-corner"></div>';
    body.innerHTML = '';

    // Headers
    matrixLabels.forEach(label => {
        const cell = document.createElement('div');
        cell.className = 'matrix-header-cell';
        cell.textContent = label;
        headerRow.appendChild(cell);
    });

    // Rows
    matrixSignals.forEach((rowSig, i) => {
        const row = document.createElement('div');
        row.className = 'matrix-row';

        const rowLabel = document.createElement('div');
        rowLabel.className = 'matrix-row-label';
        rowLabel.textContent = matrixLabels[i];
        row.appendChild(rowLabel);

        matrixSignals.forEach((colSig, j) => {
            const cell = document.createElement('div');
            cell.className = 'matrix-cell' + (i === j ? ' diagonal' : '');
            cell.id = `corr-${rowSig}-${colSig}`;
            cell.textContent = i === j ? '1.00' : '0.00';
            row.appendChild(cell);
        });

        body.appendChild(row);
    });
}

function renderCorrelationMatrix() {
    matrixSignals.forEach((rowSig, i) => {
        matrixSignals.forEach((colSig, j) => {
            if (i === j) return;
            const cell = document.getElementById(`corr-${rowSig}-${colSig}`);
            if (!cell) return;
            const key = `${rowSig}_${colSig}`;
            const val = state.correlations[key] || 0;
            cell.textContent = val.toFixed(2);
            cell.style.background = getCorrelationColor(val);
            cell.style.color = Math.abs(val) > 0.5 ? '#fff' : 'rgba(255,255,255,0.6)';
        });
    });
}

function getCorrelationColor(val) {
    const absVal = Math.abs(val);
    if (val >= 0.7) return `rgba(0, 255, 136, ${0.3 + absVal * 0.5})`;
    if (val >= 0.3) return `rgba(0, 212, 255, ${0.2 + absVal * 0.4})`;
    if (val >= -0.3) return `rgba(108, 114, 147, ${0.15 + absVal * 0.3})`;
    if (val >= -0.7) return `rgba(255, 184, 0, ${0.2 + absVal * 0.4})`;
    return `rgba(255, 0, 110, ${0.3 + absVal * 0.5})`;
}

// ======================== RISK GAUGES ========================
function renderRisks() {
    Object.entries(state.risks).forEach(([key, risk]) => {
        // Smooth animation toward target
        risk.value = lerp(risk.value, risk.target, 0.1);

        renderGauge(`gauge-${key}`, risk.value);

        const valEl = document.getElementById(`risk-${key}-value`);
        if (valEl) valEl.textContent = Math.round(risk.value);

        const factorsEl = document.getElementById(`risk-${key}-factors`);
        if (factorsEl) {
            factorsEl.innerHTML = risk.factors.map(f =>
                `<span class="risk-factor">${f}</span>`
            ).join('');
        }

        const trendEl = document.getElementById(`risk-${key}-trend`);
        if (trendEl) {
            const arrow = risk.value > risk.target + 2 ? '↗' : risk.value < risk.target - 2 ? '↘' : '→';
            const cls = risk.value > 40 ? 'trend-high' : risk.value > 25 ? 'trend-rising' : 'trend-stable';
            trendEl.innerHTML = `<span class="risk-trend-arrow ${cls}">${arrow}</span><span>${risk.value < 20 ? 'Low risk' : risk.value < 40 ? 'Moderate' : 'Elevated'}</span>`;
        }
    });
}

function renderGauge(canvasId, value) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 140;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = 58;
    const lineWidth = 8;
    const startAngle = 0.75 * Math.PI;
    const endAngle = 2.25 * Math.PI;
    const sweep = endAngle - startAngle;

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    const valAngle = startAngle + (value / 100) * sweep;
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    if (value < 25) {
        gradient.addColorStop(0, '#00ff88');
        gradient.addColorStop(1, '#00d4ff');
    } else if (value < 50) {
        gradient.addColorStop(0, '#00d4ff');
        gradient.addColorStop(1, '#ffb800');
    } else if (value < 75) {
        gradient.addColorStop(0, '#ffb800');
        gradient.addColorStop(1, '#ff6b35');
    } else {
        gradient.addColorStop(0, '#ff6b35');
        gradient.addColorStop(1, '#ff006e');
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, valAngle);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glow
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, valAngle);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth + 4;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.15;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// ======================== ANOMALY TIMELINE ========================
function renderAnomalyTimeline() {
    const timeline = document.getElementById('anomaly-timeline');
    const emptyEl = document.getElementById('timeline-empty');

    // Update stats
    document.getElementById('anomaly-total').textContent = state.anomalyStats.total;
    document.getElementById('anomaly-critical').textContent = state.anomalyStats.critical;
    document.getElementById('anomaly-resolved').textContent = state.anomalyStats.resolved;

    if (state.anomalies.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Only re-render if new items
    const existingIds = timeline.querySelectorAll('.timeline-item');
    if (existingIds.length === state.anomalies.length) return;

    // Only add the newest
    const html = state.anomalies.map(a => `
        <div class="timeline-item" data-id="${a.id}">
            <div class="timeline-dot severity-${a.severity}"></div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <span class="timeline-title">${a.title}</span>
                    <span class="timeline-time">${a.time}</span>
                </div>
                <p class="timeline-desc">${a.description}</p>
                <div class="timeline-tags">
                    ${a.tags.map(t => `<span class="timeline-tag">${t}</span>`).join('')}
                    <span class="timeline-tag tag-${a.status === 'auto-resolved' ? 'resolved' : a.status === 'active' ? 'active' : 'critical'}">${a.status}</span>
                </div>
            </div>
        </div>
    `).join('');

    // Keep empty element first, add timeline items after
    timeline.innerHTML = html;
}

// ======================== TREND CHARTS ========================
function renderTrendCharts() {
    renderTrendChart('trend-hr', state.trendData.hr, '#ff006e', 'Heart Rate (BPM)');
    renderTrendChart('trend-spo2', state.trendData.spo2, '#00d4ff', 'SpO2 (%)');
    renderBPTrendChart();
    renderDualTrendChart();
}

function renderTrendChart(canvasId, data, color, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || data.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width - 48;
    const h = 180;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const minVal = Math.min(...data) - 2;
    const maxVal = Math.max(...data) + 2;
    const range = maxVal - minVal || 1;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (i / 4) * chartH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        ctx.font = '10px Inter';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'right';
        ctx.fillText((maxVal - (i / 4) * range).toFixed(0), padding.left - 6, y + 3);
    }

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, padding.top, 0, h);
    gradient.addColorStop(0, color + '25');
    gradient.addColorStop(1, color + '02');

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = padding.left + (i / (data.length - 1)) * chartW;
        const y = padding.top + (1 - (data[i] - minVal) / range) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.lineTo(padding.left + chartW, h - padding.bottom);
    ctx.lineTo(padding.left, h - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = padding.left + (i / (data.length - 1)) * chartW;
        const y = padding.top + (1 - (data[i] - minVal) / range) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Glow
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.15;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function renderBPTrendChart() {
    const canvas = document.getElementById('trend-bp');
    if (!canvas || state.trendData.bp_sys.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width - 48;
    const h = 180;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const allBP = [...state.trendData.bp_sys, ...state.trendData.bp_dia];
    const minVal = Math.min(...allBP) - 5;
    const maxVal = Math.max(...allBP) + 5;
    const range = maxVal - minVal || 1;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (i / 4) * chartH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
        ctx.font = '10px Inter';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'right';
        ctx.fillText((maxVal - (i / 4) * range).toFixed(0), padding.left - 6, y + 3);
    }

    // Systolic
    drawTrendLine(ctx, state.trendData.bp_sys, '#a855f7', padding, chartW, chartH, minVal, range);
    // Diastolic
    drawTrendLine(ctx, state.trendData.bp_dia, '#8b5cf6', padding, chartW, chartH, minVal, range);

    // Legend
    ctx.font = '10px Inter';
    ctx.fillStyle = '#a855f7';
    ctx.fillText('● Systolic', padding.left, h - 5);
    ctx.fillStyle = '#8b5cf6';
    ctx.fillText('● Diastolic', padding.left + 70, h - 5);
}

function renderDualTrendChart() {
    const canvas = document.getElementById('trend-hrv-rr');
    if (!canvas || state.trendData.hrv.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width - 48;
    const h = 180;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // HRV (scaled)
    const allVals = [...state.trendData.hrv, ...state.trendData.rr.map(v => v * 3)];
    const minVal = Math.min(...allVals) - 3;
    const maxVal = Math.max(...allVals) + 3;
    const range = maxVal - minVal || 1;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (i / 4) * chartH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
    }

    drawTrendLine(ctx, state.trendData.hrv, '#3b82f6', padding, chartW, chartH, minVal, range);
    drawTrendLine(ctx, state.trendData.rr.map(v => v * 3), '#00ff88', padding, chartW, chartH, minVal, range);

    ctx.font = '10px Inter';
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('● HRV (ms)', padding.left, h - 5);
    ctx.fillStyle = '#00ff88';
    ctx.fillText('● Resp Rate (×3)', padding.left + 80, h - 5);
}

function drawTrendLine(ctx, data, color, padding, chartW, chartH, minVal, range) {
    if (data.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = padding.left + (i / (data.length - 1)) * chartW;
        const y = padding.top + (1 - (data[i] - minVal) / range) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Glow
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.12;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// ======================== HEADER UPDATES ========================
function updateHeader() {
    const syncEl = document.getElementById('sync-status');
    const lastSyncEl = document.getElementById('last-sync');
    if (syncEl) syncEl.textContent = `Connected • Syncing live`;
    if (lastSyncEl) lastSyncEl.textContent = `Last sync: ${formatTime(new Date())}`;
}

// ======================== NAV INTERACTIVITY ========================
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });

    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// ======================== INITIALIZATION ========================
function init() {
    console.log('🏥 VitalSync Health Monitoring System — Initializing...');

    // Pre-fill some history
    CONFIG.signals.forEach(signal => {
        const v = state.vitals[signal];
        for (let i = 0; i < 15; i++) {
            const noise = gaussRandom() * v.variance * 0.5;
            const val = clamp(v.baseline + noise, v.min, v.max);
            v.history.push(signal === 'temp' || signal === 'spo2' ? Math.round(val * 10) / 10 : Math.round(val * 10) / 10);
        }
    });

    // Pre-fill trend data
    ['hr', 'spo2', 'bp_sys', 'bp_dia', 'rr', 'hrv'].forEach(s => {
        const v = state.vitals[s];
        for (let i = 0; i < 20; i++) {
            const noise = gaussRandom() * v.variance * 0.5;
            state.trendData[s].push(clamp(v.baseline + noise, v.min, v.max));
        }
    });

    buildCorrelationMatrix();
    setupNavigation();

    // Initial render
    updateCorrelations();
    updateRisks();
    renderVitals();
    renderCorrelationMatrix();
    renderRisks();
    renderTrendCharts();
    renderAnomalyTimeline();

    // Add initial informational event
    addAnomaly('info', 'System Initialized — Correlation Monitoring Active',
        'Multi-signal correlation engine is online. Monitoring 6 physiological signals with real-time cross-correlation analysis. Early-stage risk prediction active.',
        ['System', 'All Signals', 'Baseline Set'], 'low');

    // Start continuous updates
    setInterval(updateAllVitals, CONFIG.updateInterval);

    console.log('✅ VitalSync initialized — monitoring active');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
