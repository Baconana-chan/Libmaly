/* LIBMALY in-game browser toolbar — injected as a Tauri initialization script.
   Runs on every page loaded in the "overlay-browser" WebviewWindow.
   Uses vanilla ES6; no external deps. */
(function () {
  'use strict';

  var BAR_H   = 46;
  var BG      = 'rgba(10,14,22,0.97)';
  var BORDER  = 'rgba(125,170,214,0.18)';
  var BTN_FG  = 'rgba(255,255,255,0.52)';
  var BTN_FGA = 'rgba(255,255,255,0.9)';

  // ── Tauri IPC bridge ────────────────────────────────────────────────────
  function callTauri(cmd, args) {
    try {
      if (window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__.invoke(cmd, args || {}).catch(function () {});
      }
    } catch (_) {}
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function mkBtn(text, title, color) {
    var b = document.createElement('button');
    b.textContent = text;
    b.title = title;
    b.style.cssText =
      'width:30px;height:30px;border:none;background:transparent;' +
      'color:' + (color || BTN_FG) + ';cursor:pointer;border-radius:5px;' +
      'font-size:14px;flex-shrink:0;display:flex;align-items:center;' +
      'justify-content:center;padding:0;transition:background .12s,color .12s;' +
      '-webkit-app-region:no-drag;box-sizing:border-box;';
    b.addEventListener('mouseenter', function () {
      b.style.background = 'rgba(255,255,255,0.09)';
      b.style.color = color ? 'rgba(255,90,90,1)' : BTN_FGA;
    });
    b.addEventListener('mouseleave', function () {
      b.style.background = 'transparent';
      b.style.color = color || BTN_FG;
    });
    return b;
  }

  function resolveUrl(raw) {
    var val = raw.trim();
    if (!val) return null;
    if (/^https?:\/\//i.test(val)) return val;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(val) && val.indexOf(' ') === -1) {
      return 'https://' + val;
    }
    return 'https://www.google.com/search?q=' + encodeURIComponent(val);
  }

  // ── Build toolbar ────────────────────────────────────────────────────────
  function buildBar() {
    if (document.getElementById('__libmaly_bar__')) return;

    var bar = document.createElement('div');
    bar.id = '__libmaly_bar__';
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:' + BAR_H + 'px;' +
      'background:' + BG + ';' +
      'border-bottom:1px solid ' + BORDER + ';' +
      'display:flex;align-items:center;gap:4px;padding:0 8px;' +
      'z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:12px;' +
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'box-sizing:border-box;-webkit-app-region:drag;';

    // Back / Forward / Refresh
    var back = mkBtn('\u2190', 'Back');
    back.addEventListener('click', function () { history.back(); });

    var fwd = mkBtn('\u2192', 'Forward');
    fwd.addEventListener('click', function () { history.forward(); });

    var refresh = mkBtn('\u27f3', 'Refresh');
    refresh.style.fontSize = '17px';
    refresh.addEventListener('click', function () { location.reload(); });

    // URL / search input
    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = location.href;
    urlInput.placeholder = 'URL or search…';
    urlInput.style.cssText =
      'flex:1;height:28px;background:rgba(255,255,255,0.06);' +
      'border:1px solid ' + BORDER + ';border-radius:6px;' +
      'color:rgba(255,255,255,0.85);padding:0 10px;font-size:11px;' +
      'outline:none;font-family:inherit;min-width:0;' +
      '-webkit-app-region:no-drag;box-sizing:border-box;';
    urlInput.addEventListener('focus', function () {
      urlInput.select();
      urlInput.style.borderColor = 'rgba(125,170,214,0.5)';
    });
    urlInput.addEventListener('blur', function () {
      urlInput.style.borderColor = BORDER;
    });
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var resolved = resolveUrl(urlInput.value);
        if (resolved) location.href = resolved;
      }
      if (e.key === 'Escape') {
        urlInput.value = location.href;
        urlInput.blur();
      }
    });

    // LIBMALY badge
    var badge = document.createElement('span');
    badge.textContent = 'LIBMALY';
    badge.style.cssText =
      'font-size:9px;font-weight:900;letter-spacing:.1em;' +
      'color:rgba(124,197,255,0.45);padding:2px 6px;' +
      'border:1px solid rgba(124,197,255,0.14);border-radius:4px;' +
      'white-space:nowrap;flex-shrink:0;-webkit-app-region:no-drag;';

    // Close button
    var closeBtn = mkBtn('\u2715', 'Close browser', 'rgba(255,90,90,0.6)');
    closeBtn.addEventListener('click', function () {
      callTauri('close_overlay_browser', {});
    });

    bar.appendChild(back);
    bar.appendChild(fwd);
    bar.appendChild(refresh);
    bar.appendChild(urlInput);
    bar.appendChild(badge);
    bar.appendChild(closeBtn);

    // Keep URL bar in sync with SPA navigation
    var updateUrl = function () { urlInput.value = location.href; };
    var origPush = history.pushState.bind(history);
    var origReplace = history.replaceState.bind(history);
    history.pushState    = function () { origPush.apply(history, arguments);    updateUrl(); };
    history.replaceState = function () { origReplace.apply(history, arguments); updateUrl(); };
    window.addEventListener('popstate', updateUrl);

    // Insert toolbar
    if (document.body) {
      document.body.insertAdjacentElement('afterbegin', bar);
    } else {
      document.documentElement.appendChild(bar);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildBar);
  } else {
    buildBar();
  }
})();
