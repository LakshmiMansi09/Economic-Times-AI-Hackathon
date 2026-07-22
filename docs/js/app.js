// ---------- shared helpers ----------

async function getJSON(path) {
  try {
    const res = await fetch(path + (path.includes('?') ? '&' : '?') + 't=' + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('fetch failed', path, e);
    return null;
  }
}

function timeAgo(isoString) {
  if (!isoString) return 'never';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function bandLabel(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'elevated';
  return 'low';
}
function bandCssColor(score) {
  if (score >= 70) return 'var(--risk-high)';
  if (score >= 40) return 'var(--risk-elevated)';
  return 'var(--risk-low)';
}

function deltaHtml(delta, unit = 'pt') {
  if (delta === null || delta === undefined || isNaN(delta)) {
    return `<span class="flat">— no prior reading</span>`;
  }
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 0.1) return `<span class="flat">flat</span>`;
  const cls = rounded > 0 ? 'up' : 'down';
  const arrow = rounded > 0 ? '▲' : '▼';
  return `<span class="${cls}">${arrow} ${Math.abs(rounded)}${unit}</span>`;
}

// Finds the history entry closest to `hoursAgo` in the past, so deltas are
// honest even when the pipeline hasn't been running for a full 24h yet.
function closestPast(history, hoursAgo, valueKey, timeKey) {
  if (!history || history.length < 2) return null;
  const targetMs = Date.now() - hoursAgo * 3600 * 1000;
  let best = null;
  for (const entry of history) {
    const t = new Date(entry[timeKey]).getTime();
    if (t <= targetMs) {
      if (!best || t > new Date(best[timeKey]).getTime()) best = entry;
    }
  }
  if (!best) best = history[0]; // history doesn't go back that far yet
  return best[valueKey];
}

function updateClock() {
  const el = document.getElementById('utc-clock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toISOString().slice(11, 19) + ' UTC';
}

// ---------- data loading ----------

var STATE = {
  corridors: {}, latest: [], histories: {}, events: [], prices: [], weights: null,
};

async function loadAll() {
  const [corridors, latest, events, prices, weights] = await Promise.all([
    getJSON('/data/corridors.json'),
    getJSON('/data/scores/latest.json'),
    getJSON('/data/events/all_events.json'),
    getJSON('/data/price_history.json'),
    getJSON('/data/calibrated_weights.json'),
  ]);

  STATE.corridors = corridors || {};
  STATE.latest = latest || [];
  STATE.events = events || [];
  STATE.prices = prices || [];
  STATE.weights = weights || { news: 0.40, ais: 0.25, price: 0.20, sanctions: 0.15 };

  const histories = {};
  await Promise.all(Object.keys(STATE.corridors).map(async (id) => {
    histories[id] = await getJSON(`/data/scores/${id}.json`) || [];
  }));
  STATE.histories = histories;
}

// ---------- KPI + hero ----------

function compositeScore() {
  if (!STATE.latest.length) return 0;
  return STATE.latest.reduce((s, c) => s + c.score, 0) / STATE.latest.length;
}

function compositeDelta() {
  const deltas = STATE.latest.map(c => {
    const past = closestPast(STATE.histories[c.corridor], 24, 'score', 'computed_at');
    return past === null ? null : c.score - past;
  }).filter(d => d !== null);
  if (!deltas.length) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

function eventsWithin(hours) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return STATE.events.filter(e => new Date(e.timestamp).getTime() >= cutoff);
}

function latestPriceSeries(code) {
  return STATE.prices.filter(p => p.code === code).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function renderSparklineCanvas(el, values, color) {
  if (!el || !values || values.length < 2) return;
  const w = 180, h = 34, pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;
  const n = values.length;
  const x = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)} ${(h - pad).toFixed(1)} ` +
    values.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ') +
    ` L${x(n - 1).toFixed(1)} ${(h - pad).toFixed(1)} Z`;
  const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none" style="display:block">
      <path d="${area}" fill="${color}" fill-opacity="0.12" stroke="none"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  // The target is a <canvas>; replace it with an inline SVG holder so no
  // charting library is required (works fully offline).
  const holder = document.createElement('span');
  holder.className = el.className;
  holder.style.cssText = 'display:block; width:100%; height:100%;';
  holder.innerHTML = svg;
  if (el.parentNode) el.parentNode.replaceChild(holder, el);
}

function renderHero() {
  const composite = compositeScore();
  const delta = compositeDelta();
  document.getElementById('hero-number').textContent = composite ? composite.toFixed(1) : '—';
  document.getElementById('hero-delta').innerHTML = deltaHtml(delta) + ' <span class="muted">vs ~24h ago</span>';
  renderArcGauge(document.getElementById('hero-gauge'), composite, { size: 200, thickness: 18 });

  const alerts = STATE.latest.filter(c => c.score >= 70);
  const signals24h = eventsWithin(24);
  const brent = latestPriceSeries('BRENT_CRUDE_USD');
  const wti = latestPriceSeries('WTI_USD');

  const kpis = [
    {
      label: 'Corridors monitored', value: Object.keys(STATE.corridors).length,
      sub: `<span class="flat">${STATE.latest.length ? 'all reporting' : 'awaiting first run'}</span>`,
    },
    {
      label: 'Active high-risk alerts', value: alerts.length,
      sub: alerts.length ? `<span class="up">${alerts.map(a => a.corridor_name).join(', ')}</span>` : `<span class="down">none currently</span>`,
    },
    {
      label: 'Signals, last 24h', value: signals24h.length,
      sub: `<span class="flat">${STATE.events.length} total tracked</span>`,
    },
    {
      label: 'Highest corridor', value: highestCorridorShort(),
      sub: highestCorridorSub(),
    },
    priceKpi('Brent crude', brent),
    priceKpi('WTI crude', wti),
  ];

  const grid = document.getElementById('kpi-grid');
  grid.innerHTML = kpis.map((k, i) => `
    <div class="kpi-tile">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
      ${k.spark ? `<canvas class="kpi-spark" id="kpi-spark-${i}"></canvas>` : ''}
    </div>
  `).join('');

  kpis.forEach((k, i) => {
    if (k.spark) renderSparklineCanvas(document.getElementById(`kpi-spark-${i}`), k.spark, '#4FD1FF');
  });
}

function highestCorridorShort() {
  if (!STATE.latest.length) return '—';
  const top = [...STATE.latest].sort((a, b) => b.score - a.score)[0];
  return top.score.toFixed(1);
}
function highestCorridorSub() {
  if (!STATE.latest.length) return '<span class="flat">awaiting first run</span>';
  const top = [...STATE.latest].sort((a, b) => b.score - a.score)[0];
  const cls = top.score >= 70 ? 'up' : 'flat';
  return `<span class="${cls}">${top.corridor_name}</span>`;
}

function priceKpi(label, series) {
  if (!series.length) {
    return { label, value: '—', sub: '<span class="flat">no data yet</span>', spark: null };
  }
  const latest = series[series.length - 1].price;
  const dayAgoIdx = series.findIndex(p => new Date(p.timestamp).getTime() >= Date.now() - 24 * 3600 * 1000);
  const reference = dayAgoIdx > 0 ? series[dayAgoIdx - 1].price : series[0].price;
  const pctChange = ((latest - reference) / reference) * 100;
  return {
    label,
    value: `$${latest.toFixed(1)}`,
    sub: deltaHtml(pctChange, '%'),
    spark: series.slice(-30).map(p => p.price),
  };
}

// ---------- corridor cards ----------

function weightedBreakdown(components) {
  const w = STATE.weights;
  const parts = [
    { key: 'news', label: 'News', value: (components.news_pressure || 0) * w.news, color: 'var(--sig-news)' },
    { key: 'ais', label: 'AIS', value: (components.ais_pressure || 0) * w.ais, color: 'var(--sig-ais)' },
    { key: 'price', label: 'Price', value: (components.price_momentum || 0) * w.price, color: 'var(--sig-price)' },
    { key: 'sanctions', label: 'Sanctions', value: (components.sanctions_pressure || 0) * w.sanctions, color: 'var(--sig-sanctions)' },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  return parts.map(p => ({ ...p, pct: total > 0 ? (p.value / total) * 100 : 0 }));
}

function renderCorridorCards() {
  const grid = document.getElementById('corridor-grid');
  grid.innerHTML = '';

  for (const [corridorId, cfg] of Object.entries(STATE.corridors)) {
    const current = STATE.latest.find(s => s.corridor === corridorId);
    const score = current ? current.score : 0;
    const history = STATE.histories[corridorId] || [];
    const past = closestPast(history, 24, 'score', 'computed_at');
    const delta = past === null ? null : score - past;
    const band = bandLabel(score);
    const breakdown = current ? weightedBreakdown(current.components) : [];

    const lastEvent = STATE.events
      .filter(e => e.corridor === corridorId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    const card = document.createElement('div');
    card.className = 'corridor-card';
    card.innerHTML = `
      <div class="corridor-card-head">
        <div>
          <p class="corridor-name">${cfg.name}</p>
          <p class="corridor-region">${(cfg.typical_suppliers || []).slice(0, 3).join(' · ')}</p>
        </div>
        <span class="band-pill ${band}">${band} risk</span>
      </div>
      <div class="card-gauge-row">
        <div class="card-gauge" id="gauge-${corridorId}"></div>
        <div class="card-score-block">
          <div class="card-score tabular">${score.toFixed(1)}</div>
          <div class="card-delta">${deltaHtml(delta)} <span class="muted">/24h</span></div>
          <canvas class="card-sparkline" id="spark-${corridorId}"></canvas>
        </div>
      </div>
      <div class="breakdown">
        <div class="breakdown-bar-track">
          ${breakdown.map(b => `<div class="breakdown-bar-seg" style="width:${b.pct}%; background:${b.color};"></div>`).join('')}
        </div>
        <div class="breakdown-legend">
          ${breakdown.map(b => `<span><span class="sw" style="background:${b.color}"></span>${b.label} · ${b.pct.toFixed(0)}%</span>`).join('')}
        </div>
      </div>
      <div class="card-footer">
        <span class="footer-label">Most recent signal</span>
        ${lastEvent
          ? `${lastEvent.summary} <span class="muted tabular">· ${timeAgo(lastEvent.timestamp)}</span>`
          : '<span class="muted">No events extracted yet</span>'}
      </div>
    `;
    grid.appendChild(card);

    renderArcGauge(document.getElementById(`gauge-${corridorId}`), score, { size: 118, thickness: 12 });
    if (history.length > 1) {
      renderSparklineCanvas(document.getElementById(`spark-${corridorId}`), history.slice(-30).map(h => h.score), bandCssColor(score));
    }
  }
}

// ---------- top signals ----------

function renderTopSignals() {
  const container = document.getElementById('top-signals');
  const labelEl = document.getElementById('top-signals-window');
  let pool = eventsWithin(24);
  let windowLabel = 'last 24h';
  if (!pool.length && STATE.events.length) {
    pool = STATE.events;
    windowLabel = 'no signals in 24h — showing most recent';
  }

  const ranked = [...pool].sort((a, b) => (b.severity * b.confidence) - (a.severity * a.confidence)).slice(0, 6);

  if (!ranked.length) {
    // Fallback: no extracted signals yet — show the live corridor risk
    // ranking instead of a blank panel. Always populated, since scores
    // always exist once the pipeline has run once.
    if (labelEl) labelEl.textContent = 'corridor risk ranking';
    const byRisk = [...STATE.latest].sort((a, b) => b.score - a.score);
    if (!byRisk.length) {
      container.innerHTML = '<div class="log-empty">Agent is running — corridor scores will appear after the first cycle.</div>';
      return;
    }
    const maxScore = Math.max(...byRisk.map(c => c.score), 1);
    container.innerHTML = `
      <div class="fallback-note">No individual signals extracted yet. Showing current corridor risk ranking from the latest agent cycle.</div>
      ${byRisk.map((c, i) => {
        const pct = Math.max((c.score / maxScore) * 100, 2);
        const color = c.score >= 70 ? '#C8102E' : c.score >= 40 ? '#D97706' : '#6B7280';
        return `
          <div class="rank-row">
            <div class="rank-row-head">
              <span class="rank-num tabular">${i + 1}</span>
              <span class="rank-name">${c.corridor_name}</span>
              <span class="rank-score tabular" style="color:${color}">${c.score.toFixed(1)}</span>
            </div>
            <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%; background:${color}"></div></div>
          </div>`;
      }).join('')}
    `;
    return;
  }

  if (labelEl) labelEl.textContent = windowLabel;
  container.innerHTML = ranked.map((e, i) => `
    <div class="signal-row">
      <div class="signal-rank tabular">${i + 1}</div>
      <div class="signal-dot" style="background:${bandCssColor(e.severity * 100)}"></div>
      <div class="signal-body">
        <div class="signal-top-line">
          <span class="signal-corridor-tag">${e.corridor}</span>
          <span class="signal-time tabular">${timeAgo(e.timestamp)}</span>
        </div>
        <div class="signal-summary">${e.summary}</div>
        <div class="signal-meta tabular">severity ${e.severity.toFixed(2)} · confidence ${Math.round(e.confidence * 100)}%</div>
      </div>
    </div>
  `).join('');
}

// ---------- intelligence feed ----------

let activeFilter = 'all';

function renderFilterTabs() {
  const container = document.getElementById('filter-tabs');
  const ids = ['all', ...Object.keys(STATE.corridors)];
  container.innerHTML = ids.map(id => `
    <button class="filter-tab ${id === activeFilter ? 'active' : ''}" data-filter="${id}">
      ${id === 'all' ? 'All corridors' : STATE.corridors[id].name}
    </button>
  `).join('');
  container.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFilterTabs();
      renderLog();
    });
  });
}

function renderLog() {
  const logEl = document.getElementById('log');
  const filtered = activeFilter === 'all' ? STATE.events : STATE.events.filter(e => e.corridor === activeFilter);
  if (!filtered.length) {
    // Fallback: no events yet — explain the live pipeline state and show the
    // signal-source weighting the scorer is using, so this never reads blank.
    const w = STATE.weights || { news: 0.40, ais: 0.25, price: 0.20, sanctions: 0.15 };
    const total = w.news + w.ais + w.price + w.sanctions || 1;
    const parts = [
      { label: 'News', val: w.news, color: '#C8102E' },
      { label: 'AIS', val: w.ais, color: '#6B7280' },
      { label: 'Price', val: w.price, color: '#D97706' },
      { label: 'Sanctions', val: w.sanctions, color: '#1A1A1A' },
    ];
    logEl.innerHTML = `
      <div class="feed-fallback">
        <p class="feed-fallback-title">No events extracted in the current window.</p>
        <p class="feed-fallback-sub">The agent is polling its sources every cycle. When an article clears the confidence threshold it appears here. Meanwhile, this is how the four live sources are weighted into every corridor score:</p>
        <div class="weight-bar-track" style="max-width:640px;">
          ${parts.map(p => {
            const pct = (p.val / total) * 100;
            return `<div class="weight-bar-seg" style="width:${pct}%; background:${p.color};">${pct >= 8 ? Math.round(pct) + '%' : ''}</div>`;
          }).join('')}
        </div>
        <div class="weight-legend" style="justify-content:flex-start; margin-top:12px;">
          ${parts.map(p => `<span><span class="sw" style="background:${p.color}"></span>${p.label} · ${p.val.toFixed(2)}</span>`).join('')}
        </div>
      </div>
    `;
    return;
  }
  const recent = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 60);
  logEl.innerHTML = recent.map(e => `
    <div class="log-entry">
      <div class="log-sev-bar" style="background:${bandCssColor(e.severity * 100)}"></div>
      <div class="log-body">
        <div class="log-head">
          <span class="log-time tabular">${new Date(e.timestamp).toLocaleString()}</span>
          <span class="log-type">${e.event_type.replace('_', ' ')} · ${e.corridor}</span>
          <span class="log-confidence tabular">conf ${Math.round(e.confidence * 100)}%</span>
        </div>
        <div class="log-summary">${e.summary}</div>
        <div class="log-source"><a href="${e.source_url}" target="_blank" rel="noopener">${e.source_domain || 'source'}</a></div>
      </div>
    </div>
  `).join('');
}

// ---------- map (static, self-contained SVG — no external tiles/library) ----------

// Equirectangular projection over the Indian Ocean / West Asia region that
// contains all three chokepoints. Lon 30E..110E, Lat -12..42.
const MAP_VIEW = { lonMin: 30, lonMax: 110, latMin: -12, latMax: 42, w: 760, h: 520 };

function projX(lon) {
  return ((lon - MAP_VIEW.lonMin) / (MAP_VIEW.lonMax - MAP_VIEW.lonMin)) * MAP_VIEW.w;
}
function projY(lat) {
  return ((MAP_VIEW.latMax - lat) / (MAP_VIEW.latMax - MAP_VIEW.latMin)) * MAP_VIEW.h;
}

// Rough illustrative landmass outlines ([lon,lat] pairs) so the map reads
// geographically without any tile server.
const LANDMASSES = [
  [[34,32],[48,30],[57,26],[60,25],[56,20],[52,16],[43,12],[38,20],[35,28],[34,32]],
  [[32,31],[37,15],[43,11],[51,12],[44,5],[41,-2],[39,-11],[32,-6],[30,5],[32,31]],
  [[61,25],[70,23],[73,20],[77,8],[80,13],[87,21],[89,22],[92,21],[88,26],[77,30],[68,27],[61,25]],
  [[92,21],[99,15],[100,7],[104,1],[103,4],[106,10],[109,15],[105,20],[98,17],[92,21]],
  [[95,3],[104,-2],[106,-6],[112,-8],[104,-5],[98,0],[95,3]],
];

function renderMap() {
  const container = document.getElementById('map');
  if (!container) return;
  const { w, h } = MAP_VIEW;

  const land = LANDMASSES.map(poly => {
    const pts = poly.map(([lon, lat]) => `${projX(lon).toFixed(1)},${projY(lat).toFixed(1)}`).join(' ');
    return `<polygon points="${pts}" fill="#EDEFF2" stroke="#DADEE4" stroke-width="1" />`;
  }).join('');

  let grid = '';
  for (let lon = 40; lon <= 100; lon += 20) {
    grid += `<line x1="${projX(lon)}" y1="0" x2="${projX(lon)}" y2="${h}" stroke="#F0F1F3" stroke-width="1"/>`;
    grid += `<text x="${projX(lon)+3}" y="${h-6}" font-family="IBM Plex Mono, monospace" font-size="11" fill="#B4BAC5">${lon}°E</text>`;
  }
  for (let lat = -10; lat <= 40; lat += 10) {
    grid += `<line x1="0" y1="${projY(lat)}" x2="${w}" y2="${projY(lat)}" stroke="#F0F1F3" stroke-width="1"/>`;
    grid += `<text x="4" y="${projY(lat)-4}" font-family="IBM Plex Mono, monospace" font-size="11" fill="#B4BAC5">${lat}°</text>`;
  }

  let markers = '';
  for (const [corridorId, cfg] of Object.entries(STATE.corridors)) {
    const current = STATE.latest.find(s => s.corridor === corridorId);
    const score = current ? current.score : 0;
    const color = score >= 70 ? '#C8102E' : score >= 40 ? '#D97706' : '#6B7280';
    const b = cfg.bbox;
    const cx = projX((b.min_lon + b.max_lon) / 2);
    const cy = projY((b.min_lat + b.max_lat) / 2);
    const rw = Math.max(projX(b.max_lon) - projX(b.min_lon), 16);
    const rh = Math.max(projY(b.min_lat) - projY(b.max_lat), 16);
    const shortName = cfg.name.length > 18 ? cfg.name.slice(0, 17) + '…' : cfg.name;

    markers += `
      <g>
        <rect x="${(cx - rw/2).toFixed(1)}" y="${(cy - rh/2).toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}"
              rx="4" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2"/>
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${color}" stroke="#fff" stroke-width="2"/>
        <g transform="translate(${cx.toFixed(1)}, ${(cy + rh/2 + 20).toFixed(1)})">
          <rect x="-66" y="-15" width="132" height="42" rx="6" fill="#fff" stroke="${color}" stroke-width="1.5"/>
          <text x="0" y="1" text-anchor="middle" font-family="Inter, sans-serif" font-size="12.5" font-weight="700" fill="#1A1A1A">${shortName}</text>
          <text x="0" y="18" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="${color}">${score.toFixed(1)}</text>
        </g>
      </g>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Static map of the three monitored chokepoints coloured by current risk score">
      <rect width="${w}" height="${h}" fill="#F7F8FA"/>
      ${grid}
      ${land}
      ${markers}
    </svg>`;
}

// ---------- status + refresh ----------

async function refreshStatus() {
  const status = await getJSON('/api/status');
  const el = document.getElementById('status-line');
  if (!el) return;
  if (!status) { el.textContent = ''; return; }
  el.textContent = status.running
    ? 'agent cycle running…'
    : `last sync ${timeAgo(status.last_run_finished)}`;
}

async function triggerRun() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  await fetch('/api/run', { method: 'POST' });
  await init();
  btn.disabled = false;
  btn.textContent = 'Refresh now';
}

// ---------- init ----------

async function init() {
  await loadAll();
  renderHero();
  renderCorridorCards();
  renderTopSignals();
  renderFilterTabs();
  renderLog();
  renderMap();
  await refreshStatus();
}

document.getElementById('refresh-btn').addEventListener('click', triggerRun);
const exportBtn = document.getElementById('export-btn');
if (exportBtn) exportBtn.addEventListener('click', () => window.print());

updateClock();
setInterval(updateClock, 1000);
init();
setInterval(() => { refreshStatus(); renderLog(); renderTopSignals(); }, 30000);
