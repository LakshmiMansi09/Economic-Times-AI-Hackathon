/* Shared left vertical navigation, injected into every page so the three
   pages stay identical. The `data-active` attribute on <body> decides which
   tab is highlighted. Tab labels per spec: Dashboard, Signal Replay,
   Models and Data. */

(function renderNav() {
  const active = document.body.getAttribute('data-active') || 'dashboard';

  const shipLogo = `
    <svg class="brand-mark" viewBox="0 0 52 52" aria-hidden="true">
      <rect width="52" height="52" rx="11" fill="#FBE9EC"/>
      <!-- hull -->
      <path d="M12 31 h28 l-4 8 h-20 z" fill="#C8102E"/>
      <!-- waterline -->
      <path d="M9 41 q6 3 11 0 q6 3 11 0 q6 3 11 0" stroke="#6B7280" stroke-width="2" fill="none" stroke-linecap="round"/>
      <!-- superstructure -->
      <rect x="20" y="22" width="12" height="9" rx="1.5" fill="#6B7280"/>
      <rect x="23" y="14" width="6" height="8" rx="1.5" fill="#C8102E"/>
      <!-- mast -->
      <line x1="26" y1="9" x2="26" y2="14" stroke="#6B7280" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

  const links = [
    { id: 'dashboard', label: 'Dashboard', href: 'index.html',
      icon: '<path d="M3 12l9-9 9 9M5 10v10h14V10"/>' },
    { id: 'signal-replay', label: 'Signal Replay', href: 'backtest.html',
      icon: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M21 3v6h-6"/>' },
    { id: 'models-data', label: 'Models and Data', href: 'methodology.html',
      icon: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'sidenav';
  nav.innerHTML = `
    <div class="sidenav-brand">
      ${shipLogo}
      <div class="brand-text">
        <div class="brand-name">Corridor<span class="accent">Watch</span></div>
        <div class="brand-tagline">Energy supply chain risk</div>
      </div>
    </div>
    <div class="nav-links">
      ${links.map(l => `
        <a class="nav-link ${l.id === active ? 'active' : ''}" href="${l.href}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${l.icon}</svg>
          ${l.label}
        </a>`).join('')}
    </div>
    <div class="nav-spacer"></div>
    <div class="nav-foot">
      <div class="live-pill"><span class="dot"></span> LIVE</div>
      <div id="nav-status">local agent</div>
    </div>
  `;

  document.getElementById('app-shell').prepend(nav);
})();
