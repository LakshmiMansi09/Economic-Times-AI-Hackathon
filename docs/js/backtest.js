async function loadBacktest() {
  let data = null;
  const res = await fetch('/data/backtest/hormuz_2026_result.json?t=' + Date.now());
  if (res.ok) {
    data = await res.json();
  } else {
    // Fallback: the computed result file isn't present (backtest.py not run
    // yet). Build a display dataset directly from the raw timeline that
    // always ships in the repo, so the chart is never blank.
    try {
      const rawRes = await fetch('/data/backtest/hormuz_2026_timeline.json?t=' + Date.now());
      if (rawRes.ok) {
        const raw = await rawRes.json();
        const prices = raw.brent_price_series || [];
        data = {
          calibrated_news_weight: 0.40,
          calibrated_price_weight: 0.20,
          lead_time_days: null,
          _from_raw: true,
          timeline: prices.map(p => ({
            date: (p.timestamp || '').slice(0, 10),
            score: null,
            actual_brent_price: p.price,
          })),
        };
      }
    } catch (e) {}
  }

  if (!data) {
    document.getElementById('lead-time-callout').textContent =
      'No replay data found. Run "python scripts/backtest.py" to generate it.';
    document.getElementById('stat-strip').innerHTML = '';
    return;
  }

  const timeline = data.timeline;

  const scores = timeline.map(t => t.score).filter(s => s !== null && s !== undefined);
  const prices = timeline.map(t => t.actual_brent_price).filter(p => p !== null && p !== undefined);
  const peakScore = scores.length ? Math.max(...scores) : null;
  const peakPrice = prices.length ? Math.max(...prices) : null;

  document.getElementById('stat-strip').innerHTML = `
    <div class="stat-tile">
      <div class="stat-label">Lead time</div>
      <div class="stat-value tabular">${data.lead_time_days !== null && data.lead_time_days !== undefined ? data.lead_time_days + 'd' : '—'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Peak risk score</div>
      <div class="stat-value tabular">${peakScore !== null ? peakScore.toFixed(1) : '—'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Peak Brent price</div>
      <div class="stat-value tabular">${peakPrice !== null ? '$' + peakPrice.toFixed(0) : '—'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Days modeled</div>
      <div class="stat-value tabular">${timeline.length}</div>
    </div>
  `;

  const callout = document.getElementById('lead-time-callout');
  if (data._from_raw) {
    callout.innerHTML = `Showing the raw Brent price timeline for the 2026 Hormuz window. ` +
      `Run <code>python scripts/backtest.py</code> to compute the model's risk-score trajectory and lead time against it.`;
  } else if (data.lead_time_days !== null) {
    callout.innerHTML = `With calibrated weights (news=${data.calibrated_news_weight}, price=${data.calibrated_price_weight}), ` +
      `the corridor score crossed the high-risk threshold <strong>${data.lead_time_days} day(s) before</strong> ` +
      `Brent crude actually crossed $100/bbl in this replay.`;
  } else {
    callout.textContent = 'No lead time detected at current thresholds — see the raw timeline below.';
  }

  const labels = timeline.map(t => t.date);
  const scoreSeries = timeline.map(t => t.score);
  const priceSeries = timeline.map(t => t.actual_brent_price);

  drawStaticChart(labels, scoreSeries, priceSeries);
}

// Static, self-contained dual-axis line chart. No Chart.js / no CDN.
// Left axis (red): corridor risk score 0-100. Right axis (grey): Brent price.
function drawStaticChart(labels, scores, prices) {
  const host = document.getElementById('backtest-chart');
  if (!host) return;

  const W = 900, H = 380;
  const m = { top: 30, right: 62, bottom: 54, left: 52 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  const n = labels.length;
  const xAt = (i) => m.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  // left axis: score fixed 0-100
  const yScore = (v) => m.top + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;

  // right axis: price, padded range
  const validPrices = prices.filter(p => p !== null && p !== undefined);
  const pMin = validPrices.length ? Math.min(...validPrices) : 0;
  const pMax = validPrices.length ? Math.max(...validPrices) : 100;
  const pLo = Math.floor((pMin - 5) / 10) * 10;
  const pHi = Math.ceil((pMax + 5) / 10) * 10;
  const yPrice = (v) => m.top + plotH - ((v - pLo) / (pHi - pLo || 1)) * plotH;

  const linePath = (series, yFn) => {
    let d = '';
    let started = false;
    series.forEach((v, i) => {
      if (v === null || v === undefined) { started = false; return; }
      d += `${started ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yFn(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  // gridlines + left axis labels (score)
  let grid = '';
  for (let v = 0; v <= 100; v += 25) {
    const y = yScore(v);
    grid += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + plotW}" y2="${y.toFixed(1)}" stroke="#EEF0F2" stroke-width="1"/>`;
    grid += `<text x="${m.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#C8102E">${v}</text>`;
  }
  // right axis labels (price)
  let priceAxis = '';
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const val = pLo + ((pHi - pLo) * s) / steps;
    const y = yPrice(val);
    priceAxis += `<text x="${m.left + plotW + 10}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-family="IBM Plex Mono, monospace" font-size="11" fill="#6B7280">$${val.toFixed(0)}</text>`;
  }

  // x labels (thin them out so they don't collide)
  let xLabels = '';
  const stride = Math.max(1, Math.ceil(n / 8));
  labels.forEach((lab, i) => {
    if (i % stride !== 0 && i !== n - 1) return;
    xLabels += `<text x="${xAt(i).toFixed(1)}" y="${H - m.bottom + 22}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#8A909C">${lab}</text>`;
  });

  // area under the score line
  const scorePath = linePath(scores, yScore);
  let areaPath = '';
  if (scores.some(v => v !== null && v !== undefined)) {
    const firstI = scores.findIndex(v => v !== null && v !== undefined);
    let lastI = -1;
    for (let i = scores.length - 1; i >= 0; i--) { if (scores[i] !== null && scores[i] !== undefined) { lastI = i; break; } }
    if (firstI >= 0 && lastI >= 0) {
      areaPath = `M${xAt(firstI).toFixed(1)} ${(m.top + plotH).toFixed(1)} ` +
                 scores.map((v, i) => (v === null || v === undefined) ? '' : `L${xAt(i).toFixed(1)} ${yScore(v).toFixed(1)} `).join('') +
                 `L${xAt(lastI).toFixed(1)} ${(m.top + plotH).toFixed(1)} Z`;
    }
  }

  const priceLine = linePath(prices, yPrice);
  const hasScore = scores.some(v => v !== null && v !== undefined);

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Corridor risk score versus actual Brent crude price over the 2026 Hormuz window">
      ${grid}
      ${priceAxis}
      ${areaPath ? `<path d="${areaPath}" fill="rgba(200,16,46,0.08)" stroke="none"/>` : ''}
      ${hasScore ? `<path d="${scorePath}" fill="none" stroke="#C8102E" stroke-width="2.5" stroke-linejoin="round"/>` : ''}
      <path d="${priceLine}" fill="none" stroke="#6B7280" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>
      ${xLabels}
      <g font-family="Inter, sans-serif" font-size="12.5" font-weight="600">
        <rect x="${m.left}" y="6" width="12" height="12" rx="2" fill="#C8102E"/>
        <text x="${m.left + 18}" y="16" fill="#5B6270">Corridor risk score</text>
        <rect x="${m.left + 168}" y="6" width="12" height="12" rx="2" fill="#6B7280"/>
        <text x="${m.left + 186}" y="16" fill="#5B6270">Actual Brent price (USD/bbl)</text>
      </g>
    </svg>`;
}

loadBacktest();
