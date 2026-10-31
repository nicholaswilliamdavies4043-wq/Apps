/* UI helpers: escaping, formatting, icons, modal, toast, small SVG charts. */
(function () {
  'use strict';
  const P = {
    gauge: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/><circle cx="12" cy="14" r="1.4"/>',
    site: '<path d="M8 3l4 8 5-5 5 15H2L8 3z"/>',
    fleet: '<path d="M2 15V9h7l2-4h5v10"/><path d="M16 9h3l3 4v2h-6"/><path d="M2 12H0"/><circle cx="6" cy="17.5" r="2.5"/><circle cx="17" cy="17.5" r="2.5"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v4a5 5 0 0 0 10 0V2"/><path d="M7 22v-4a5 5 0 0 1 10 0v4"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    pencil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'
  };
  const icon = (n, cls) => '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || P.link) + '</svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const num1 = (v) => (v == null || !isFinite(v) ? '–' : nf1.format(v));
  const pct = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v * 100) + '%');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dShort = (ds) => { if (!ds) return ''; const [, m, d] = ds.split('-'); return d + '-' + MON[+m - 1]; };
  const dLong = (ds) => { if (!ds) return ''; const [y, m, d] = ds.split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; };
  const monthLabel = (mk) => { const [y, m] = mk.split('-'); return MON[+m - 1] + '-' + y; };
  const dt = (ts) => { const d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const tm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    return dt(ts);
  }
  /** "3d 04h 12m 09s" — returns HTML */
  function countdown(ms) {
    const neg = ms < 0; ms = Math.abs(ms);
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    const p = (n) => String(n).padStart(2, '0');
    const u = (t) => '<span class="u">' + t + '</span>';
    return (neg ? '−' : '') + (d ? d + u('d') : '') + p(h) + u('h') + p(m) + u('m') + p(s) + u('s');
  }
  const toLocalInput = (ts) => { if (!ts) return ''; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

  function initials(name) {
    const p = String(name || '?').replace(/[^\p{L}\p{N} .]/gu, '').trim().split(/[\s.]+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0] || '')[1] || '')).toUpperCase();
  }
  const PAL = ['#A08C64', '#5b8cff', '#3ecf8e', '#e07a5f', '#9b7ede', '#2ab7ca', '#f2b33d', '#e5626a'];
  function colorFor(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; }
  const avatar = (name, cls) => '<div class="avatar ' + (cls || '') + '" style="background:' + colorFor(name) + ';color:#fff">' + esc(initials(name)) + '</div>';

  /* ---------- toast ---------- */
  function toast(msg, type) {
    type = type || 'ok';
    const t = el('<div class="toast ' + type + '">' + icon(type === 'err' ? 'alert' : type === 'warn' ? 'bell' : 'check') + '<div>' + esc(msg) + '</div></div>');
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, type === 'err' ? 5000 : 3000);
  }

  /* ---------- modal ---------- */
  function modal(opts) {
    const root = $('#modal-root');
    const ov = el('<div class="overlay" role="dialog" aria-modal="true"><div class="modal ' + (opts.wide ? 'wide' : '') + '">' +
      '<div class="modal-h"><h3>' + esc(opts.title || '') + '</h3><button class="btn icon ghost" data-x aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="modal-b">' + (opts.body || '') + '</div>' +
      (opts.footer !== false ? '<div class="modal-f">' + (opts.footer || '<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>' + esc(opts.okText || 'Save') + '</button>') + '</div>' : '') +
      '</div></div>');
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); setTimeout(() => document.dispatchEvent(new CustomEvent('mhp:modalclosed')), 0); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    $$('[data-x]', ov).forEach((b) => b.addEventListener('click', close));
    const okBtn = $('[data-ok]', ov);
    if (okBtn && opts.onOk) {
      okBtn.addEventListener('click', async () => {
        okBtn.disabled = true;
        try { const r = await opts.onOk(ov); if (r !== false) close(); }
        catch (e) { toast(e.message, 'err'); }
        finally { okBtn.disabled = false; }
      });
    }
    root.appendChild(ov);
    const f = $('input:not([type=hidden]):not([readonly]), select, textarea', $('.modal-b', ov));
    if (f && !opts.noFocus) setTimeout(() => f.focus(), 40);
    if (opts.onMount) opts.onMount(ov, close);
    return { el: ov, close };
  }
  function confirmBox(text, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: opts.title || 'Please confirm',
        body: '<p style="margin:0">' + esc(text) + '</p>' + (opts.typeToConfirm ? '<label class="field mt"><span>Type "' + esc(opts.typeToConfirm) + '" to confirm</span><input class="inp" data-t></label>' : ''),
        footer: '<button class="btn" data-x>Cancel</button><button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-ok>' + esc(opts.okText || 'Confirm') + '</button>',
        onOk: (ov) => {
          if (opts.typeToConfirm && $('[data-t]', ov).value.trim() !== opts.typeToConfirm) { toast('Text does not match', 'err'); return false; }
          done = true; resolve(true);
        }
      });
      const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
      obs.observe($('#modal-root'), { childList: true });
    });
  }
  /** read named inputs of a container into an object */
  function formData(root) {
    const o = {};
    $$('[name]', root).forEach((i) => {
      if (i.type === 'checkbox') o[i.name] = i.checked;
      else if (i.type === 'number') o[i.name] = i.value === '' ? null : Number(i.value);
      else o[i.name] = i.value;
    });
    return o;
  }

  /* ---------- tiny SVG charts ---------- */
  function ring(pctVal, color, label, size) {
    size = size || 54;
    const r = 24, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pctVal)));
    return '<svg class="ring" viewBox="0 0 54 54" style="width:' + size + 'px;height:' + size + 'px"><circle class="bgc" cx="27" cy="27" r="' + r + '"/>' +
      '<circle class="fg" cx="27" cy="27" r="' + r + '" stroke="' + color + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      (label != null ? '<text x="27" y="31" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + esc(label) + '</text>' : '') + '</svg>';
  }
  function donut(parts, size) { // parts: [{v, color}]
    size = size || 84;
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    const r = 34, c = 2 * Math.PI * r;
    let acc = 0, segs = '';
    parts.forEach((p) => {
      const len = (p.v / tot) * c;
      segs += '<circle cx="42" cy="42" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="9" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 42 42)"/>';
      acc += len;
    });
    return '<svg viewBox="0 0 84 84" style="width:' + size + 'px;height:' + size + 'px;flex:none"><circle cx="42" cy="42" r="' + r + '" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="9"/>' + segs +
      '<circle cx="42" cy="42" r="22" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/></svg>';
  }
  function spark(values, color) {
    const w = 200, h = 38, max = Math.max(1, ...values);
    const step = values.length > 1 ? w / (values.length - 1) : w;
    const pts = values.map((v, i) => (i * step).toFixed(1) + ',' + (h - 3 - (v / max) * (h - 8)).toFixed(1));
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polyline points="0,' + h + ' ' + pts.join(' ') + ' ' + w + ',' + h + '" fill="' + color + '" fill-opacity=".15" stroke="none"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }
  function splitBar(tr, rcc) {
    const t = (tr || 0) + (rcc || 0);
    if (!t) return '<div class="split"></div>';
    return '<div class="split" title="TR ' + Math.round(tr / t * 100) + '% · RCC ' + Math.round(rcc / t * 100) + '%"><i class="s-tr" style="width:' + (tr / t * 100).toFixed(1) + '%"></i><i class="s-rcc" style="width:' + (rcc / t * 100).toFixed(1) + '%"></i></div>';
  }
  /** animate numbers in [data-count] */
  function animateCounts(root) {
    $$('[data-count]', root).forEach((n) => {
      const to = Number(n.dataset.count), dec = Number(n.dataset.dec || 1), suf = n.dataset.suf || '';
      if (!isFinite(to)) return;
      const f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const t0 = performance.now(), dur = 700;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); n.textContent = f.format(to * e) + suf; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  function downloadCSV(name, rows) {
    const q = (v) => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** resize an image file to a JPEG data URL */
  function imageToDataUrl(file, maxW) {
    maxW = maxW || 1600;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = URL.createObjectURL(file);
    });
  }
  const debounce = (fn, ms) => { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(this, a), ms); }; };

  window.UI = { icon, esc, $, $$, el, num1, pct, dShort, dLong, monthLabel, dt, tm, ago, countdown, toLocalInput, fromLocalInput, initials, colorFor, avatar, toast, modal, confirmBox, formData, ring, donut, spark, splitBar, animateCounts, downloadCSV, imageToDataUrl, debounce, MON, ICONS: Object.keys(P) };
})();
