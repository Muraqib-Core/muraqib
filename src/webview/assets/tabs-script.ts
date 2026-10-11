/**
 * Vanilla tab + copy-button behaviour, inlined into the page (no bundler, no framework).
 * Tabs follow the WAI-ARIA tabs pattern and keep the active tab in the URL hash.
 */
export const TABS_SCRIPT = `
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  if (!tabs.length) return;
  var rtl = document.documentElement.dir === 'rtl';

  function select(index, focus) {
    tabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(tab.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tabs[index].focus();
  }

  function fromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    for (var i = 0; i < tabs.length; i++) if (tabs[i].dataset.tab === id) return i;
    return 0;
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      select(i, false);
      history.replaceState(null, '', '#' + tab.dataset.tab);
    });
    tab.addEventListener('keydown', function (event) {
      var step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
      var next = i;
      if (step) next = (i + step + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      select(next, true);
      history.replaceState(null, '', '#' + tabs[next].dataset.tab);
    });
  });
  window.addEventListener('hashchange', function () { select(fromHash(), false); });
  select(fromHash(), false);

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(area);
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-copy]');
    if (!button) return;
    var code = button.closest('figure').querySelector('code');
    var text = code ? code.textContent : '';
    var done = function () {
      var label = button.textContent;
      button.textContent = button.getAttribute('data-copied');
      setTimeout(function () { button.textContent = label; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  });
})();
`;
