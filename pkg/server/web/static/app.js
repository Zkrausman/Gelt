const API_BASE = '/api/v1';

async function fetchHealth() {
    try {
        const res = await fetch(API_BASE + '/health');
        const data = await res.json();

        const elStatus = document.getElementById('broker-status');
        if (elStatus) elStatus.textContent = data.MCPReachable ? 'ST_ROBINHOOD_MCP:CONNECTED' : 'ST_ROBINHOOD_MCP:OFFLINE';

        const elBp = document.getElementById('buying-power');
        if (elBp) {
                const bpCheck = data.Checks?.find(c => c.Name === "Account Health");
                if (bpCheck) {
                    const match = bpCheck.Message.match(/\$([0-9.,]+)/);
                    if (match) elBp.textContent = '$' + match[1];
                }
        }

        const elLat = document.getElementById('latency');
        if (elLat) elLat.textContent = data.LatencyMs + 'ms';
    } catch (e) { console.error('Error fetching health:', e); }
}

async function fetchRegime() {
    try {
        const res = await fetch(API_BASE + '/regime');
        const data = await res.json();

        const elReg = document.getElementById('regime-status');
        if (elReg) elReg.textContent = data.is_volatile ? 'HIGH VOLATILITY' : 'LOW VOLATILITY';

        const elVix = document.getElementById('vix-level');
        if (elVix && data.vix !== undefined) elVix.textContent = data.vix.toFixed(1);
    } catch (e) { console.error('Error fetching regime:', e); }
}

async function fetchRisk() {
    try {
        const res = await fetch(API_BASE + '/risk');
        const data = await res.json();

        const elCap = document.getElementById('daily-cap');
        if (elCap && data.daily_cap !== undefined) elCap.textContent = '-$' + data.daily_cap.toFixed(2);

        const elPositions = document.getElementById('positions-body');
        if (elPositions && data.active_positions) {
            elPositions.innerHTML = '';
            if (data.active_positions.length === 0) {
                elPositions.innerHTML = '<tr><td colspan="8" class="px-2 py-1.5 text-center text-on-surface-variant">NO ACTIVE POSITIONS</td></tr>';
            } else {
                data.active_positions.forEach((pos, index) => {
                    const row = document.createElement('tr');
                    row.className = "border-b border-outline-variant hover:bg-surface-container-highest cursor-crosshair";

                    const pnlClass = pos.unrealized_pnl >= 0 ? "text-primary-container" : "text-error";
                    const pnlText = pos.unrealized_pnl >= 0 ? '+$' + pos.unrealized_pnl.toFixed(2) : '-$' + Math.abs(pos.unrealized_pnl).toFixed(2);

                    row.innerHTML = `
                        <td class="px-2 py-1.5 border-r border-outline-variant text-on-surface-variant text-center">${(index + 1).toString().padStart(3, '0')}</td>
                        <td class="px-3 py-1.5 border-r border-outline-variant text-on-surface">${pos.symbol}</td>
                        <td class="px-3 py-1.5 border-r border-outline-variant text-right">${pos.qty.toLocaleString()}</td>
                        <td class="px-3 py-1.5 border-r border-outline-variant text-right text-on-surface-variant">--</td>
                        <td class="px-3 py-1.5 border-r border-outline-variant text-right">--</td>
                        <td class="px-3 py-1.5 border-r border-outline-variant text-right ${pnlClass}">${pnlText}</td>
                        <td class="px-3 py-1.5 border-r border-outline-variant text-right text-on-surface flex justify-end items-center gap-2">
                            <span>--</span>
                        </td>
                        <td class="px-3 py-1.5 text-center">
                            <button class="bg-surface-container-highest border border-outline-variant text-on-surface px-2 py-0.5 text-[9px] hover:border-primary-container hover:text-primary-container w-full transition-none uppercase">LIQ</button>
                        </td>
                    `;
                    elPositions.appendChild(row);
                });
            }
        }

    } catch (e) { console.error('Error fetching risk:', e); }
}

async function fetchShadow() {
    try {
        const res = await fetch(API_BASE + '/shadow');
        const data = await res.json();

        if (data && data.length > 0) {
                const plan = data[0];
                const elWr = document.getElementById('shadow-winrate');
                if (elWr && plan.win_rate !== undefined) elWr.textContent = plan.win_rate.toFixed(1) + '%';

                const elPnl = document.getElementById('shadow-pnl');
                if (elPnl && plan.total_pnl_usd !== undefined) {
                    elPnl.textContent = plan.total_pnl_usd >= 0 ? '+$' + plan.total_pnl_usd.toFixed(2) : '-$' + Math.abs(plan.total_pnl_usd).toFixed(2);
                }
        }
    } catch (e) { console.error('Error fetching shadow:', e); }
}

async function fetchMetrics() {
    try {
        const res = await fetch(API_BASE + '/metrics');
        const data = await res.json();

        if (res.status === 400 && data.status === 'CONFIG_INVALID') {
            showDegradedMode();
        } else {
            hideDegradedMode();
        }
    } catch (e) { console.error('Error fetching metrics:', e); }
}

function showDegradedMode() {
    const banner = document.getElementById('degraded-banner');
    if (banner) banner.style.display = 'flex';
}

function hideDegradedMode() {
    const banner = document.getElementById('degraded-banner');
    if (banner) banner.style.display = 'none';
}

function updateAll() {
    fetchHealth();
    fetchRegime();
    fetchRisk();
    fetchShadow();
    fetchMetrics();
}

document.addEventListener('DOMContentLoaded', () => {
    initSettingsModal();
    initDataExplorer();
    updateAll();
    setInterval(updateAll, 3000);
});

let currentDays = 30;

async function initDataExplorer() {
    const navExplorerBtn = document.getElementById('nav-explorer-btn');
    const explorerModal = document.getElementById('explorer-modal');
    const explorerCloseBtn = document.getElementById('explorer-close-btn');

    if (navExplorerBtn && explorerModal) {
        navExplorerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            explorerModal.classList.remove('hidden');
            loadExplorerData();
        });
    }

    if (explorerCloseBtn && explorerModal) {
        explorerCloseBtn.addEventListener('click', () => {
            explorerModal.classList.add('hidden');
        });
    }

    const feat1Select = document.getElementById('explorer-feature1');
    const feat2Select = document.getElementById('explorer-feature2');

    if (feat1Select && feat2Select) {
        feat1Select.addEventListener('change', loadExplorerData);
        feat2Select.addEventListener('change', loadExplorerData);
    }

    const rangeBtns = document.querySelectorAll('.range-btn');
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeBtns.forEach(b => b.classList.remove('border-primary-container', 'text-primary-container', 'bg-surface-container-highest'));
            btn.classList.add('border-primary-container', 'text-primary-container', 'bg-surface-container-highest');
            currentDays = parseInt(btn.getAttribute('data-days')) || 30;
            loadExplorerData();
        });
    });

    await populateFeatureSelectors();
}

async function populateFeatureSelectors() {
    try {
        const res = await fetch(API_BASE + '/features');
        const rawData = await res.json();
        const streams = Array.isArray(rawData) ? rawData : (rawData.streams || []);

        const feat1Select = document.getElementById('explorer-feature1');
        const feat2Select = document.getElementById('explorer-feature2');

        if (!feat1Select || !feat2Select) return;

        feat1Select.innerHTML = '';
        feat2Select.innerHTML = '';

        let k1Found = false;
        streams.forEach((stream) => {
            const opt1 = document.createElement('option');
            opt1.value = stream.key;
            opt1.textContent = `${stream.name} [${stream.category}]`;
            // Select the first valid equity feature as default if available
            if (!k1Found && stream.category === 'Equity') {
                opt1.selected = true;
                k1Found = true;
            }
            feat1Select.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = stream.key;
            opt2.textContent = `${stream.name} [${stream.category}]`;
            if (stream.key === 'Macro.Yield10Y' || stream.key === 'Macro.FRED.DFF') opt2.selected = true;
            feat2Select.appendChild(opt2);
        });

        if (streams.length > 1 && feat1Select.value === feat2Select.value) {
            feat2Select.selectedIndex = (feat1Select.selectedIndex + 1) % streams.length;
        }

    } catch (e) {
        console.error('Error populating feature streams:', e);
    }
}

async function loadExplorerData() {
    const feat1Select = document.getElementById('explorer-feature1');
    const feat2Select = document.getElementById('explorer-feature2');

    const k1 = feat1Select && feat1Select.value ? feat1Select.value : '';
    const k2 = feat2Select && feat2Select.value ? feat2Select.value : 'Macro.Yield10Y';

    if (!k1) return;

    try {
        const [res1, res2] = await Promise.all([
            fetch(`${API_BASE}/features/query?key=${encodeURIComponent(k1)}&days=${currentDays}`).then(r => r.json()),
            fetch(`${API_BASE}/features/query?key=${encodeURIComponent(k2)}&days=${currentDays}`).then(r => r.json())
        ]);

        const series1 = res1.points || [];
        const series2 = res2.points || [];

        renderExplorerCanvas(k1, series1, k2, series2);
        updateExplorerStats(k1, series1, k2, series2);
    } catch (e) {
        console.error('Error loading explorer feature datasets:', e);
    }
}

function updateExplorerStats(k1, s1, k2, s2) {
    if (s1.length > 0) {
        const vals1 = s1.map(p => p.Value);
        const last1 = vals1[vals1.length - 1];
        const min1 = Math.min(...vals1);
        const max1 = Math.max(...vals1);

        const elStat1 = document.getElementById('feat1-summary');
        if (elStat1) elStat1.textContent = `${k1}: Latest ${last1.toFixed(2)} | Min ${min1.toFixed(2)} | Max ${max1.toFixed(2)}`;
    }

    if (s2.length > 0) {
        const vals2 = s2.map(p => p.Value);
        const last2 = vals2[vals2.length - 1];
        const min2 = Math.min(...vals2);
        const max2 = Math.max(...vals2);

        const elStat2 = document.getElementById('feat2-summary');
        if (elStat2) elStat2.textContent = `${k2}: Latest ${last2.toFixed(2)} | Min ${min2.toFixed(2)} | Max ${max2.toFixed(2)}`;
    }

    if (s1.length > 0 && s2.length > 0) {
        const corr = calcCorrelation(s1.map(p => p.Value), s2.map(p => p.Value));
        const elCorr = document.getElementById('feat-correlation');
        if (elCorr) elCorr.textContent = `Correlation: ${corr.toFixed(3)}`;
    }
}

function calcCorrelation(arr1, arr2) {
    const len = Math.min(arr1.length, arr2.length);
    if (len === 0) return 0;

    let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, pSum = 0;
    for (let i = 0; i < len; i++) {
        sum1 += arr1[i];
        sum2 += arr2[i];
        sum1Sq += arr1[i] * arr1[i];
        sum2Sq += arr2[i] * arr2[i];
        pSum += arr1[i] * arr2[i];
    }

    const num = pSum - (sum1 * sum2 / len);
    const den = Math.sqrt((sum1Sq - sum1 * sum1 / len) * (sum2Sq - sum2 * sum2 / len));
    return den === 0 ? 0 : num / den;
}

function renderExplorerCanvas(k1, s1, k2, s2) {
    const canvas = document.getElementById('explorer-chart-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.clientWidth || 800;
    const height = canvas.height = canvas.parentElement.clientHeight || 360;

    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    const gridRows = 5;
    const gridCols = 6;
    for (let i = 1; i < gridRows; i++) {
        const y = (height / gridRows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    for (let j = 1; j < gridCols; j++) {
        const x = (width / gridCols) * j;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    if (s1.length === 0) return;

    const padding = 40;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    // Draw Series 1 (Green Neon)
    const vals1 = s1.map(p => p.Value);
    const min1 = Math.min(...vals1);
    const max1 = Math.max(...vals1) || (min1 + 1);

    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    s1.forEach((p, idx) => {
        const x = padding + (idx / (s1.length - 1)) * chartW;
        const normY = (p.Value - min1) / (max1 - min1);
        const y = height - padding - (normY * chartH);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Series 2 (Cyan Neon)
    if (s2.length > 0) {
        const vals2 = s2.map(p => p.Value);
        const min2 = Math.min(...vals2);
        const max2 = Math.max(...vals2) || (min2 + 1);

        ctx.strokeStyle = '#00f6f6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        s2.forEach((p, idx) => {
            const x = padding + (idx / (s2.length - 1)) * chartW;
            const normY = (p.Value - min2) / (max2 - min2);
            const y = height - padding - (normY * chartH);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // Legends & Labels
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#39ff14';
    ctx.fillText(`— ${k1}`, padding, 20);

    if (s2.length > 0) {
        ctx.fillStyle = '#00f6f6';
        ctx.fillText(`— ${k2}`, padding + 180, 20);
    }
}

// Settings Modal Logic
function initSettingsModal() {
    const cogBtn = document.getElementById('settings-cog-btn');
    const closeBtn = document.getElementById('settings-close-btn');
    const modal = document.getElementById('settings-modal');

    if (cogBtn && modal) {
        cogBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    // Close modal when clicking outside
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }

    const themeBtns = document.querySelectorAll('.theme-btn');

    // Highlight the currently active theme button based on URL param
    const urlParams = new URLSearchParams(window.location.search);
    const currentTheme = urlParams.get('theme') || 'cyberpunk';

    themeBtns.forEach(btn => {
        const theme = btn.getAttribute('data-theme');
        if (theme === currentTheme) {
            btn.classList.add('border-primary');
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.classList.remove('hidden');
        }

        btn.addEventListener('click', () => {
            if (theme) {
                window.location.href = '/?theme=' + theme;
            }
        });
    });
}
