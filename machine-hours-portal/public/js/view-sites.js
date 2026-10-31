/* Site Definition: environments (mine sites) + their lists (machines, operators, telehuts, shifts). */
(function () {
  'use strict';
  const { icon, esc, $, $$, toast, modal, num1, confirmBox } = UI;
  const Views = (window.Views = window.Views || {});
  const COLORS = ['#A08C64', '#1441F5', '#3ecf8e', '#e07a5f', '#9b7ede', '#2ab7ca', '#f2b33d', '#e5626a'];

  function head(sub) {
    const s = App.site;
    return '<div class="view-head"><div><h2>Site Definition</h2><div class="sub">Each mine site is its own environment — machines, logs, maintenance and chat are kept separate per site.</div></div>' +
      '<div class="head-actions"><div class="subtabs"><button data-sub="list" class="' + (sub === 'list' ? 'on' : '') + '">All sites</button>' +
      '<button data-sub="setup" class="' + (sub === 'setup' ? 'on' : '') + '">Site setup' + (s ? ': ' + esc(s.name) : '') + '</button></div></div></div>';
  }

  function cover(s) {
    return s.coverImage ? 'background-image:url(&quot;' + s.coverImage + '&quot;)' : 'background-image:linear-gradient(135deg,' + esc(s.color || '#A08C64') + '55, #0b1d33 70%), url(img/quarry.svg)';
  }

  function renderList(wrap) {
    const S = App.S;
    wrap.insertAdjacentHTML('beforeend',
      '<div class="grid g-3">' + S.sites.map((s) =>
        '<div class="card site-card ' + (s.id === S.siteId ? 'on' : '') + '" data-open="' + s.id + '" tabindex="0">' +
        '<div class="site-cover" style="' + cover(s) + '">' + (s.id === S.siteId ? '<span class="pill gold tag">' + icon('check') + ' Current</span>' : '') + '</div>' +
        '<div class="site-body"><h4>' + esc(s.name) + '</h4><div class="muted">' + icon('pin') + ' ' + esc([s.location, s.country].filter(Boolean).join(' · ') || 'No location') + '</div>' +
        (s.description ? '<div class="hint" style="margin-top:6px">' + esc(s.description) + '</div>' : '') +
        '<div class="site-stats"><div><b>' + s.machineCount + '</b>machines</div><div><b>' + s.entryCount + '</b>log rows</div><div><b>' + s.memberCount + '</b>members</div></div>' +
        '<div class="row mt"><button class="btn sm primary" data-open="' + s.id + '">' + (s.id === S.siteId ? 'Open dashboard' : 'Switch to site') + '</button>' +
        '<button class="btn sm" data-setup="' + s.id + '">' + icon('settings') + ' Setup</button></div></div></div>').join('') +
      '<button class="card add-card" data-new data-perm="createSite"><div>' + icon('plus') + '<h4 style="margin-top:8px">Create a mine site</h4><div class="muted">Add a new environment</div></div></button>' +
      '</div>' +
      '<div class="card mt row" data-perm-not="createSite">' + icon('shield') + '<span class="muted">Only superusers can create or delete mine sites. ' + (S.sites.length ? 'Pick a site above to work in it.' : 'Ask a superuser to set up your site.') + '</span></div>' +
      '<div class="card mt row" data-perm="createSite" style="justify-content:space-between"><div><b>Want to try it out?</b><div class="muted">Load a sample site with loaders 6, 7, 9 &amp; 11, 40 days of shift readings, maintenance schedules and chat.</div></div>' +
      '<button class="btn" data-demo>' + icon('download') + ' Load sample site</button></div>');
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-open],[data-setup],[data-new],[data-demo]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.setup) { if (b.dataset.setup !== S.siteId) await App.switchSite(b.dataset.setup); App.go('sites', 'setup'); return; }
      if (b.dataset.open) { if (b.dataset.open !== S.siteId) await App.switchSite(b.dataset.open); App.go('dashboard'); return; }
      if ('new' in b.dataset) return openSiteModal();
      if ('demo' in b.dataset) return loadDemo();
    });
  }

  async function loadDemo() {
    try {
      const s = await API.post('demo');
      if (!App.S.sites.find((x) => x.id === s.id)) App.S.sites.push(s);
      await App.switchSite(s.id);
      App.go('dashboard');
    } catch (e) { toast(e.message, 'err'); }
  }

  function siteForm(s) {
    s = s || {};
    return '<div class="form-grid two">' +
      '<label class="field full"><span>Site name *</span><input class="inp" name="name" required value="' + esc(s.name || '') + '" placeholder="e.g. Tarkwa Underground"></label>' +
      '<label class="field"><span>Location / area</span><input class="inp" name="location" value="' + esc(s.location || '') + '" placeholder="e.g. Level 3 North"></label>' +
      '<label class="field"><span>Country</span><input class="inp" name="country" value="' + esc(s.country || '') + '"></label>' +
      '<label class="field full"><span>Description</span><textarea class="inp" name="description" rows="2">' + esc(s.description || '') + '</textarea></label>' +
      '<div class="field full"><span>Colour tag</span><div class="swatches">' + COLORS.map((c) => '<button type="button" class="swatch ' + ((s.color || '#A08C64') === c ? 'on' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>').join('') + '</div><input type="hidden" name="color" value="' + esc(s.color || '#A08C64') + '"></div>' +
      '<div class="field full"><span>Cover photo (used as the site background)</span><div class="cover-prev" data-prev style="' + (s.coverImage ? 'background-image:url(&quot;' + s.coverImage + '&quot;)' : '') + '">' + (s.coverImage ? '' : icon('upload') + ' No image') + '</div>' +
      '<div class="row"><label class="btn sm">' + icon('upload') + ' Choose image<input type="file" accept="image/*" data-file hidden></label>' + (s.coverImage ? '<button type="button" class="btn sm ghost" data-rmcover>Remove</button>' : '') + '<span class="hint">Resized to 1600 px, JPEG.</span></div></div>' +
      '</div>';
  }
  function bindSiteForm(root, state) {
    $$('[data-color]', root).forEach((b) => b.addEventListener('click', () => {
      $$('[data-color]', root).forEach((x) => x.classList.remove('on')); b.classList.add('on'); $('[name=color]', root).value = b.dataset.color;
    }));
    $('[data-file]', root).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { state.cover = await UI.imageToDataUrl(f, 1600); const p = $('[data-prev]', root); p.style.backgroundImage = 'url("' + state.cover + '")'; p.innerHTML = ''; }
      catch (er) { toast(er.message, 'err'); }
    });
    const rm = $('[data-rmcover]', root);
    if (rm) rm.addEventListener('click', () => { state.cover = null; const p = $('[data-prev]', root); p.style.backgroundImage = ''; p.innerHTML = icon('upload') + ' No image'; });
  }
  function openSiteModal(site) {
    const state = { cover: site ? site.coverImage : undefined };
    modal({
      title: site ? 'Edit site' : 'Create a mine site', body: siteForm(site), okText: site ? 'Save' : 'Create site',
      onMount: (ov) => bindSiteForm(ov, state),
      onOk: async (ov) => {
        const f = UI.formData($('.modal-b', ov));
        if (!f.name.trim()) throw new Error('Site name is required');
        if (state.cover !== undefined) f.coverImage = state.cover;
        if (site) { await API.put('sites/' + site.id, f); toast('Site saved'); return; }
        const s = await API.post('sites', f);
        if (!App.S.sites.find((x) => x.id === s.id)) App.S.sites.push(s);
        await App.switchSite(s.id);
        App.go('sites', 'setup');
        toast('Site created — now add machines, operators and telehuts');
      }
    });
  }

  function machineModal(m) {
    m = m || {};
    modal({
      title: m.id ? 'Edit ' + m.name : 'Add machine',
      body: '<div class="form-grid">' +
        '<label class="field"><span>Name *</span><input class="inp" name="name" value="' + esc(m.name || '') + '" placeholder="Loader 12"></label>' +
        '<label class="field"><span>Model</span><input class="inp" name="model" value="' + esc(m.model || '') + '" placeholder="LH517i"></label>' +
        '<label class="field"><span>Machine type</span><select class="inp" name="type" data-mtype>' + Core.MACHINE_TYPES.map((t) => '<option ' + ((m.type || 'Loader') === t ? 'selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '<label class="field" data-bpt><span>Buckets = 1 truck</span><input class="inp" type="number" step="0.5" min="0.5" name="bucketsPerTruck" value="' + (m.bucketsPerTruck != null ? m.bucketsPerTruck : '') + '" placeholder="e.g. 4"></label>' +
        '<label class="field"><span>Status</span><select class="inp" name="status">' + Core.MACHINE_STATUS.map((s) => '<option ' + ((m.status || 'Operating') === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>In service?</span><select class="inp" name="active"><option value="true" ' + (m.active !== false ? 'selected' : '') + '>Yes — active</option><option value="false" ' + (m.active === false ? 'selected' : '') + '>No — not yet in service</option></select></label>' +
        '<label class="field"><span>Opening TR reading</span><input class="inp" type="number" step="0.1" name="openingTR" value="' + (m.openingTR != null ? m.openingTR : '') + '"></label>' +
        '<label class="field"><span>Opening RCC reading</span><input class="inp" type="number" step="0.1" name="openingRCC" value="' + (m.openingRCC != null ? m.openingRCC : '') + '"></label>' +
        '<label class="field full"><span>Notes</span><textarea class="inp" name="notes" rows="2">' + esc(m.notes || '') + '</textarea></label>' +
        '</div><p class="hint">Opening readings are entered once per loader — they are the "Start" for its very first log row. ' +
        'For loaders, "Buckets = 1 truck" turns the bucket count on the Fleet card into truck loads.</p>',
      onMount: (ov) => {
        const sync = () => { $('[data-bpt]', ov).classList.toggle('hidden', $('[data-mtype]', ov).value !== 'Loader'); };
        $('[data-mtype]', ov).addEventListener('change', sync); sync();
      },
      onOk: async (ov) => {
        const f = UI.formData($('.modal-b', ov));
        f.active = f.active === 'true';
        if (!f.name) throw new Error('Name is required');
        if (f.type !== 'Loader') f.bucketsPerTruck = null;
        if (f.bucketsPerTruck != null && !(f.bucketsPerTruck > 0)) throw new Error('Buckets per truck must be more than 0');
        if (m.id) await API.put('machines/' + m.id, f); else await API.post('sites/' + App.S.siteId + '/machines', f);
        toast(m.id ? 'Machine saved' : 'Machine added');
      }
    });
  }

  function listChips(col, label, placeholder) {
    const items = App.S.data[col];
    return '<div class="card"><div class="card-h"><h3>' + icon(col === 'operators' ? 'users' : 'cpu') + label + ' <span class="pill">' + items.length + '</span></h3></div>' +
      '<div class="chips">' + (items.length ? items.map((o) => '<span class="chip">' + esc(o.name) + '<button data-perm="listEdit" data-delchip="' + col + '" data-id="' + o.id + '" aria-label="Remove">' + icon('x') + '</button></span>').join('') : '<span class="muted">None yet</span>') + '</div>' +
      '<form class="row mt" data-perm="listEdit" data-addchip="' + col + '"><input class="inp" name="name" placeholder="' + placeholder + '" style="flex:1;min-width:140px"><button class="btn">' + icon('plus') + ' Add</button></form></div>';
  }

  function renderSetup(wrap) {
    const S = App.S, s = App.site;
    if (!s) { noSite(wrap); return; }
    const met = S.meters || {};
    const shifts = s.shifts || ['Day', 'Night'];
    const state = { cover: undefined };
    wrap.insertAdjacentHTML('beforeend',
      '<div class="grid g-main">' +
      '<div class="stack">' +
      // machines
      '<div class="card"><div class="card-h"><h3>' + icon('fleet') + 'Machines <span class="pill">' + S.data.machines.length + '</span></h3><button class="btn sm primary" data-perm="super" data-addm>' + icon('plus') + ' Add machine</button></div>' +
      (S.data.machines.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Machine</th><th>Model</th><th>Type</th><th class="n">Buckets/truck</th><th>Active?</th><th>Status</th><th class="n">Opening TR</th><th class="n">Opening RCC</th><th class="n">Latest TR</th><th class="n">Latest RCC</th><th></th></tr></thead><tbody>' +
        S.data.machines.map((m) => '<tr class="' + (m.active === false ? 'inactive' : '') + '"><td class="strong">' + esc(m.name) + '</td><td>' + esc(m.model || '–') + '</td>' +
          '<td>' + esc(m.type || 'Loader') + '</td><td class="n">' + (Core.isLoader(m) ? (m.bucketsPerTruck != null ? (Number.isInteger(m.bucketsPerTruck) ? m.bucketsPerTruck : num1(m.bucketsPerTruck)) : '<span class="faint">not set</span>') : '–') + '</td>' +
          '<td>' + (m.active === false ? '<span class="pill">No</span>' : '<span class="pill ok">Yes</span>') + '</td><td>' + esc(m.status || '') + '</td>' +
          '<td class="n">' + (m.openingTR != null ? num1(m.openingTR) : '<span class="faint">enter when it arrives</span>') + '</td><td class="n">' + num1(m.openingRCC) + '</td>' +
          '<td class="n">' + num1(met[m.id] && met[m.id].tr) + '</td><td class="n">' + num1(met[m.id] && met[m.id].rcc) + '</td>' +
          '<td class="acts" data-perm="super"><button class="btn icon sm ghost" data-editm="' + m.id + '" title="Edit">' + icon('pencil') + '</button><button class="btn icon sm ghost" data-delm="' + m.id + '" title="Delete">' + icon('trash') + '</button></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">' + icon('fleet') + '<div>No machines yet. Add your loaders with their opening hour-meter readings.</div></div>') + '</div>' +
      '<div class="grid g-2">' + listChips('operators', 'Operators', 'Operator name') + listChips('telehuts', 'Telehuts', 'e.g. Telehut 3') + '</div>' +
      // shifts
      '<div class="card"><div class="card-h"><h3>' + icon('clock') + 'Shifts</h3><span class="hint">Order matters: it decides which reading comes first on the same day.</span></div>' +
      '<div class="chips" data-shifts>' + shifts.map((x, i) => '<span class="chip"><span class="ord">' + (i + 1) + '.</span> ' + esc(x) + (shifts.length > 1 ? '<button data-perm="super" data-delshift="' + i + '">' + icon('x') + '</button>' : '') + '</span>').join('') + '</div>' +
      '<form class="row mt" data-perm="super" data-addshift><input class="inp" name="shift" placeholder="e.g. Afternoon" style="flex:1;min-width:140px"><button class="btn">' + icon('plus') + ' Add shift</button></form></div>' +
      '</div>' +
      // details
      '<div class="stack"><div class="card" data-details data-readonly="super"><div class="card-h"><h3>' + icon('site') + 'Site details</h3><span class="pill gold" data-perm-not="super">' + icon('shield') + ' Superusers only</span></div>' + siteForm(s) +
      '<div class="form-grid mt"><label class="field"><span>Shift length (hrs)</span><input class="inp" type="number" step="0.5" name="shiftHours" value="' + (s.shiftHours != null ? s.shiftHours : 12) + '"></label>' +
      '<label class="field"><span>Warn days before</span><input class="inp" type="number" step="1" name="leadDays" value="' + (s.leadDays != null ? s.leadDays : 3) + '"></label>' +
      '<label class="field"><span>Warn hrs before</span><input class="inp" type="number" step="1" name="leadHours" value="' + (s.leadHours != null ? s.leadHours : 25) + '"></label></div>' +
      '<p class="hint">Manual hrs = shift length − TR hrs − RCC hrs. Rows above the shift length are flagged for a check. Maintenance turns "due soon" when within the warning window.</p>' +
      '<button class="btn primary" data-perm="super" data-savesite>' + icon('check') + ' Save site details</button></div>' +
      '<div class="card" data-perm="super" style="border-color:rgba(255,100,100,.3)"><div class="card-h"><h3 style="color:#ff9a9a">' + icon('alert') + 'Danger zone</h3></div><p class="muted" style="margin-top:0">Deleting a site removes all its machines, log rows, maintenance, chat and announcements.</p><button class="btn danger" data-delsite>' + icon('trash') + ' Delete this site</button></div>' +
      '</div></div>');

    bindSiteForm($('[data-details]', wrap), state);
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if ('addm' in b.dataset) machineModal();
        if (b.dataset.editm) machineModal(App.machine(b.dataset.editm));
        if (b.dataset.delm) {
          const m = App.machine(b.dataset.delm);
          const n = S.data.entries.filter((x) => x.machineId === m.id).length;
          if (await confirmBox('Delete ' + m.name + '? This also removes its ' + n + ' log rows and maintenance schedules. Tip: set it to "not in service" instead to keep history.', { danger: true, okText: 'Delete', typeToConfirm: n ? m.name : null })) {
            await API.del('machines/' + m.id); toast(m.name + ' deleted');
          }
        }
        if (b.dataset.delchip) { await API.del(b.dataset.delchip + '/' + b.dataset.id); }
        if (b.dataset.delshift != null) {
          const sh = shifts.slice(); sh.splice(Number(b.dataset.delshift), 1);
          await API.put('sites/' + s.id, { shifts: sh });
        }
        if ('savesite' in b.dataset) {
          const f = UI.formData($('[data-details]', wrap));
          if (state.cover !== undefined) f.coverImage = state.cover;
          await API.put('sites/' + s.id, f); toast('Site details saved');
        }
        if ('delsite' in b.dataset) {
          if (await confirmBox('This permanently deletes "' + s.name + '" and all its data.', { danger: true, okText: 'Delete site', typeToConfirm: s.name })) {
            await API.del('sites/' + s.id); toast('Site deleted');
          }
        }
      } catch (er) { toast(er.message, 'err'); }
    });
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.dataset.addchip) {
          const v = f.elements.name.value.trim(); if (!v) return;
          await API.post('sites/' + s.id + '/' + f.dataset.addchip, { name: v }); f.reset(); f.elements.name.focus();
        }
        if ('addshift' in f.dataset) {
          const v = f.elements.shift.value.trim(); if (!v) return;
          if (shifts.includes(v)) throw new Error(v + ' already exists');
          await API.put('sites/' + s.id, { shifts: shifts.concat(v) }); f.reset();
        }
      } catch (er) { toast(er.message, 'err'); }
    });
  }

  function noSite(wrap) {
    wrap.innerHTML = '<div class="view-head"><div><h2>Welcome, ' + esc(App.S.user.name.split(' ')[0]) + '</h2><div class="sub">Start by creating the mine site (environment) you work on.</div></div></div>' +
      '<div class="card" style="max-width:720px"><div class="empty" style="padding:30px 10px">' + icon('site') +
      '<h3 style="margin:6px 0">No site selected</h3><p class="muted">Every site keeps its own machines, shift logs, maintenance schedules, chat and announcements.</p>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-perm="createSite" data-new>' + icon('plus') + ' Create a mine site</button><button class="btn" data-perm="createSite" data-demo>' + icon('download') + ' Load sample site</button>' +
      '<p class="hint" data-perm-not="createSite" style="width:100%">Only superusers can create mine sites. Ask a superuser to set one up, or pick an existing site.</p>' +
      (App.S.sites.length ? '<button class="btn" data-list>Choose existing site</button>' : '') + '</div></div></div>';
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if ('new' in b.dataset) openSiteModal();
      if ('demo' in b.dataset) loadDemo();
      if ('list' in b.dataset) App.go('sites', 'list');
    });
  }

  Views.sites = {
    render(wrap, r) {
      const sub = r.sub === 'setup' ? 'setup' : 'list';
      wrap.innerHTML = head(sub);
      $$('.subtabs [data-sub]', wrap).forEach((b) => b.addEventListener('click', () => App.go('sites', b.dataset.sub)));
      if (sub === 'list') renderList(wrap); else renderSetup(wrap);
    },
    noSite, openSiteModal
  };
})();
