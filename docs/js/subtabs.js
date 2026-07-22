/* Shared inner-tab switcher. Any .subtab with data-tab toggles the
   .subtab-panel with the matching data-panel. Works for any number of
   sub-tab groups on a page. */
document.querySelectorAll('.subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.closest('.prose') || document;
    group.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    group.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = group.querySelector(`.subtab-panel[data-panel="${btn.dataset.tab}"]`);
    if (panel) panel.classList.add('active');
  });
});
