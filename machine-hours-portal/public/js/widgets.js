/* Slide-out WIDGET panel: global search, maintenance donut, and user-built link widgets. */
(function () {
  'use strict';
  const { icon, esc, $, $$, toast, modal, donut, confirmBox } = UI;
  const Views = (window.Views = window.Views || {});
  const COLORS = ['#A08C64', '#1441F5', '#0b1d33', '#3ecf8e', '#e07a5f', '#9b7ede', '#2ab7ca', '#e5626a'];
  const ICONS = ['link', 'globe', 'book', 'file', 'wrench', 'activity', 'star', 'users', 'shield', 'calendar', 'mail', 'cpu'];
  let panel = null, query = '';

  /* Built-in apps shipped with the portal (public/apps/). Shown to every user. */
  const APPS = [
    { id: 'upc', title: 'Underground Plan Calculator', url: 'apps/underground-plan-calculator.html', icon: 'site', color: '#1441F5',
      desc: 'Measure distances on mine plans (PDF or image)' }
  ];

  function appCards() {
    return APPS.map((a) => '<button class="wcard wnew wapp" data-app="' + a.id + '" title="Open ' + esc(a.title) + '">' +
      '<span class="wicon" style="background:' + a.color + '">' + icon(a.icon) + '</span>' +
      '<span style="min-width:0"><h4>' + esc(a.title) + '</h4><span style="font-size:12.5px;color:#27313b">' + esc(a.desc) + '</span></span>' +
      '<span class="wapp-go">' + icon('right') + '</span></button>').join('');
  }

  function openApp(id) {
    const a = APPS.find((x) => x.id === id); if (!a) return;
    const old = $('.app-frame'); if (old) old.remove();
    const f = UI.el('<div class="app-frame" role="dialog" aria-label="' + esc(a.title) + '">' +
      '<div class="app-bar"><span class="wicon" style="background:' + a.color + ';width:32px;height:32px">' + icon(a.icon) + '</span><b>' + esc(a.title) + '</b><span class="spacer"></span>' +
      '<a class="btn sm" href="' + a.url + '" target="_blank" rel="noopener">' + icon('external') + ' New tab</a>' +
      '<button class="btn sm" data-close>' + icon('x') + ' Close</button></div>' +
      '<iframe src="' + a.url + '" title="' + esc(a.title) + '"></iframe></div>');
    const close = () => { f.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    $('[data-close]', f).addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(f);
    if (window.matchMedia('(max-width: 900px)').matches) toggle(false);
  }

  function statsCard() {
    const ms = App.S.data ? App.maintStatuses() : [];
    const c = (s) => ms.filter((x) => x.st.status === s).length;
    const parts = [{ v: c('overdue'), color: '#e5262c' }, { v: c('soon'), color: '#f2b33d' }, { v: c('ok'), color: '#1b2128' }];
    return '<div class="wcard"><h4 style="margin-bottom:10px">' + icon('wrench') + ' Maintenance</h4><div class="wstat">' + donut(parts, 80) +
      '<div><div class="tot">TOTAL</div><div class="big">' + ms.length + '</div></div>' +
      '<ul><li><i style="background:#e5262c"></i>Overdue - ' + c('overdue') + '</li><li><i style="background:#f2b33d"></i>Due soon - ' + c('soon') + '</li><li><i style="background:#1b2128"></i>On track - ' + c('ok') + '</li></ul></div></div>';
  }

  function widgetCard(w, i, n) {
    return '<div class="wcard" data-w="' + w.id + '"><div class="wh"><div class="wicon" style="background:' + esc(w.color || '#A08C64') + '">' + icon(w.icon || 'link') + '</div>' +
      '<h4 style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + esc(w.title) + '</h4><div class="wacts">' +
      (i > 0 ? '<button data-up="' + w.id + '" title="Move up">' + icon('down', '') .replace('<svg', '<svg style="transform:rotate(180deg)"') + '</button>' : '') +
      (i < n - 1 ? '<button data-dn="' + w.id + '" title="Move down">' + icon('down') + '</button>' : '') +
      '<button data-edit="' + w.id + '" title="Edit">' + icon('pencil') + '</button><button data-del="' + w.id + '" title="Delete">' + icon('trash') + '</button></div></div>' +
      '<div class="wlinks">' + (w.links.length ? w.links.map((l) => {
        let host = ''; try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
        return '<a class="wlink" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + icon('external') + '<span>' + esc(l.label) + '</span><span class="host">' + esc(host) + '</span></a>';
      }).join('') : '<div style="font-size:12.5px;color:#4b5561">No links yet — click edit to add some.</div>') + '</div></div>';
  }

  function draw() {
    if (!panel) return;
    const W = App.S.widgets || [];
    panel.innerHTML =
      '<div class="wcard"><h4 style="margin-bottom:10px">' + icon('search') + ' Global Search</h4><div class="wsearch">' + icon('search') +
      '<input data-q placeholder="Machines, operators, remarks, chat…" value="' + esc(query) + '"></div><div class="wresults" data-res></div></div>' +
      appCards() +
      statsCard() +
      W.map((w, i) => widgetCard(w, i, W.length)).join('') +
      '<button class="wcard wnew" data-new><span class="plus">' + icon('plus') + '</span><span><h4>Create widget</h4><span style="font-size:12.5px;color:#27313b">Group your favourite links (SAP, manuals, dashboards…)</span></span></button>';
    const q = $('[data-q]', panel);
    q.addEventListener('input', UI.debounce(() => { query = q.value; search(); }, 150));
    search();
  }

  function search() {
    const res = $('[data-res]', panel);
    const S = App.S;
    const q = query.trim().toLowerCase();
    if (!res) return;
    if (!q || !S.data) { res.innerHTML = q && !S.data ? '<div style="font-size:12px">Select a site first.</div>' : ''; return; }
    const hits = [];
    S.data.machines.forEach((m) => { if ((m.name + ' ' + (m.model || '')).toLowerCase().includes(q)) hits.push({ t: m.name, s: 'Machine · ' + (m.status || ''), go: ['fleet', 'overview'] }); });
    S.data.operators.forEach((o) => { if (o.name.toLowerCase().includes(q)) hits.push({ t: o.name, s: 'Operator', go: ['dashboard'] }); });
    S.data.maintenance.forEach((m) => { if ((m.title + ' ' + (m.notes || '') + ' ' + (m.assignee || '')).toLowerCase().includes(q)) hits.push({ t: m.title, s: 'Maintenance · ' + App.machineName(m.machineId), go: ['fleet', 'maintenance'] }); });
    S.data.entries.slice().reverse().forEach((e) => { if (hits.length < 40 && ((e.remarks || '') + ' ' + (e.operator || '')).toLowerCase().includes(q)) hits.push({ t: App.machineName(e.machineId) + ' · ' + e.shift + ' ' + UI.dShort(e.date), s: 'Shift log · ' + (e.operator || '') + (e.remarks ? ' — ' + e.remarks : ''), go: ['fleet', 'log'] }); });
    S.data.messages.slice().reverse().forEach((m) => { if (hits.length < 60 && m.text.toLowerCase().includes(q)) hits.push({ t: m.userName + ': ' + m.text.slice(0, 60), s: 'Chat · ' + (m.channel === 'general' ? '#general' : '#' + App.machineName(m.channel)), go: ['chat', m.channel] }); });
    S.data.announcements.forEach((a) => { if ((a.title + ' ' + (a.body || '')).toLowerCase().includes(q)) hits.push({ t: a.title, s: 'Announcement', go: ['chat', 'announcements'] }); });
    APPS.forEach((a) => { if ((a.title + ' ' + a.desc).toLowerCase().includes(q)) hits.push({ t: a.title, s: 'App · ' + a.desc, app: a.id }); });
    (S.widgets || []).forEach((w) => w.links.forEach((l) => { if ((l.label + ' ' + l.url).toLowerCase().includes(q)) hits.push({ t: l.label, s: 'Link · ' + w.title, url: l.url }); }));
    res.innerHTML = hits.length ? hits.slice(0, 30).map((h, i) => '<button class="wres" data-hit="' + i + '"><b>' + esc(h.t) + '</b><small>' + esc(h.s) + '</small></button>').join('') : '<div style="font-size:12px;color:#4b5561">No matches</div>';
    res.onclick = (e) => {
      const b = e.target.closest('[data-hit]'); if (!b) return;
      const h = hits[Number(b.dataset.hit)];
      if (h.app) { openApp(h.app); return; }
      if (h.url) { window.open(h.url, '_blank', 'noopener'); return; }
      App.go(h.go[0], h.go[1]);
      if (window.matchMedia('(max-width: 900px)').matches) toggle(false);
    };
  }

  function editor(w) {
    w = w ? JSON.parse(JSON.stringify(w)) : { title: '', color: COLORS[0], icon: 'link', links: [{ label: '', url: '' }] };
    const rowHtml = (l) => '<div class="link-row"><input class="inp" data-l="label" placeholder="Label" value="' + esc(l.label || '') + '"><input class="inp" data-l="url" placeholder="https://…" value="' + esc(l.url || '') + '"><button type="button" class="btn icon" data-rm title="Remove">' + icon('x') + '</button></div>';
    modal({
      title: w.id ? 'Edit widget' : 'Create widget', okText: w.id ? 'Save widget' : 'Create widget',
      body: '<label class="field"><span>Widget title</span><input class="inp" name="title" value="' + esc(w.title) + '" placeholder="e.g. Workshop links"></label>' +
        '<div class="grid g-2 mt"><div class="field"><span>Icon</span><div class="icon-pick">' + ICONS.map((ic) => '<button type="button" data-ic="' + ic + '" class="' + (w.icon === ic ? 'on' : '') + '">' + icon(ic) + '</button>').join('') + '</div></div>' +
        '<div class="field"><span>Colour</span><div class="swatches">' + COLORS.map((c) => '<button type="button" class="swatch ' + (w.color === c ? 'on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>').join('') + '</div></div></div>' +
        '<div class="field mt"><span>Links</span><div class="link-rows" data-rows>' + w.links.map(rowHtml).join('') + '</div></div>' +
        '<button type="button" class="btn sm mt" data-addl>' + icon('plus') + ' Add link</button>' +
        '<p class="hint">Only http(s) addresses are allowed. "https://" is added if you leave it out. Links open in a new tab. Widgets are personal — only you see them, on every site.</p>',
      onMount: (ov) => {
        ov.addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.ic) { w.icon = b.dataset.ic; $$('[data-ic]', ov).forEach((x) => x.classList.toggle('on', x === b)); }
          if (b.dataset.c) { w.color = b.dataset.c; $$('[data-c]', ov).forEach((x) => x.classList.toggle('on', x === b)); }
          if ('addl' in b.dataset) { $('[data-rows]', ov).insertAdjacentHTML('beforeend', rowHtml({})); $$('[data-rows] .link-row', ov).pop().querySelector('input').focus(); }
          if ('rm' in b.dataset) b.closest('.link-row').remove();
        });
      },
      onOk: async (ov) => {
        const links = $$('.link-row', ov).map((r) => ({ label: $('[data-l=label]', r).value.trim(), url: $('[data-l=url]', r).value.trim() })).filter((l) => l.url);
        const body = { title: $('[name=title]', ov).value.trim(), icon: w.icon, color: w.color, links };
        if (!body.title) throw new Error('Give the widget a title');
        if (w.id) await API.put('widgets/' + w.id, body); else await API.post('widgets', body);
        await reload();
        toast(w.id ? 'Widget saved' : 'Widget created');
      }
    });
  }

  async function reload(silent) {
    try { App.S.widgets = await API.get('widgets'); } catch (e) { if (!silent) toast(e.message, 'err'); }
    draw();
  }

  function toggle(force) {
    const on = force != null ? force : !document.body.classList.contains('widget-open');
    document.body.classList.toggle('widget-open', on);
    if (on) draw();
  }

  async function move(id, dir) {
    const W = App.S.widgets.slice();
    const i = W.findIndex((w) => w.id === id), j = i + dir;
    if (j < 0 || j >= W.length) return;
    [W[i], W[j]] = [W[j], W[i]];
    App.S.widgets = W; draw();
    try { await Promise.all(W.map((w, k) => API.put('widgets/' + w.id, { order: k }))); } catch (e) { toast(e.message, 'err'); }
  }

  Views.widgets = {
    render(el) {
      panel = el;
      draw();
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b || b.classList.contains('wres')) return;
        if (b.dataset.app) return openApp(b.dataset.app);
        if ('new' in b.dataset) return editor();
        if (b.dataset.edit) return editor(App.S.widgets.find((w) => w.id === b.dataset.edit));
        if (b.dataset.up) return move(b.dataset.up, -1);
        if (b.dataset.dn) return move(b.dataset.dn, 1);
        if (b.dataset.del) {
          const w = App.S.widgets.find((x) => x.id === b.dataset.del);
          if (await confirmBox('Delete the widget "' + w.title + '"?', { danger: true, okText: 'Delete' })) {
            try { await API.del('widgets/' + w.id); await reload(); } catch (er) { toast(er.message, 'err'); }
          }
        }
      });
    },
    update() {
      if (!panel || !document.body.classList.contains('widget-open')) return;
      const a = document.activeElement;
      if (a && panel.contains(a)) { search(); return; }
      draw();
    },
    reload, toggle, openApp, APPS
  };
})();
