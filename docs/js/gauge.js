/* Semicircular instrument gauge, shared by the hero metric and each
   corridor card. Draws three fixed background bands (low/elevated/high)
   so the risk context is always visible, then overlays a bright value
   arc up to the current score, with tick marks and a needle-tip dot. */

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  if (endAngle - startAngle <= 0.01) return '';
  const p1 = polarToCartesian(cx, cy, r, startAngle);
  const p2 = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

function scoreToAngle(score) {
  const clamped = Math.max(0, Math.min(100, score));
  return -90 + (clamped / 100) * 180;
}

function bandColorForScore(score) {
  if (score >= 70) return '#C8102E';
  if (score >= 40) return '#D97706';
  return '#6B7280';
}

/**
 * Renders an arc gauge into `container`.
 * @param {HTMLElement} container
 * @param {number} score - 0 to 100
 * @param {{size?: number, thickness?: number}} opts
 */
function renderArcGauge(container, score, opts = {}) {
  const size = opts.size || 140;
  const thickness = opts.thickness || Math.max(8, size * 0.09);
  const pad = thickness / 2 + 6;
  const cx = size / 2;
  const cy = size - pad;
  const r = size / 2 - pad;
  const viewH = cy + thickness / 2 + 4;
  const valueColor = bandColorForScore(score);
  const valueAngle = scoreToAngle(score);
  const tipPos = polarToCartesian(cx, cy, r, valueAngle);

  const bands = [
    { from: -90, to: -90 + 1.8 * 40, color: '#6B7280' },
    { from: -90 + 1.8 * 40, to: -90 + 1.8 * 70, color: '#D97706' },
    { from: -90 + 1.8 * 70, to: 90, color: '#C8102E' },
  ];

  const ticks = [0, 25, 50, 75, 100].map((v) => {
    const a = scoreToAngle(v);
    const inner = polarToCartesian(cx, cy, r - thickness / 2 - 3, a);
    const outer = polarToCartesian(cx, cy, r - thickness / 2 - 9, a);
    return `<line x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}" stroke="#8A909C" stroke-width="1.5" />`;
  }).join('');

  container.innerHTML = `
    <svg width="100%" viewBox="0 0 ${size} ${viewH}" role="img" aria-label="Risk gauge showing a score of ${Math.round(score)} out of 100">
      <defs>
        <filter id="glow-${score}-${size}" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      ${bands.map(b => `<path d="${describeArc(cx, cy, r, b.from, b.to)}" fill="none" stroke="${b.color}" stroke-width="${thickness}" opacity="0.22" stroke-linecap="butt" />`).join('')}
      ${ticks}
      <path d="${describeArc(cx, cy, r, -90, valueAngle)}" fill="none" stroke="${valueColor}" stroke-width="${thickness}" stroke-linecap="round" filter="url(#glow-${score}-${size})" />
      <circle cx="${tipPos.x.toFixed(2)}" cy="${tipPos.y.toFixed(2)}" r="${thickness * 0.42}" fill="${valueColor}" stroke="${valueColor.startsWith('var') ? '#04141c' : '#04141c'}" stroke-width="2" />
    </svg>
  `;
}
