/* Fleet Monitoring: machine overview, shift log (data entry) and scheduled maintenance with countdowns. */
(function () {
  'use strict';
  const { icon, esc, $, $$, toast, modal, num1, dShort, dLong, dt, splitBar, confirmBox, countdown, ring, spark } = UI;
  const Views = (window.Views = window.Views || {});
  const TR = '#5b8cff', RCC = '#c9a55f';
  const STATUS_COLOR = { Operating: 'var(--ok)', Standby: 'var(--info)', Down: 'var(--bad)', 'In maintenance': 'var(--warn)' };
  const CATS = ['Service', 'Inspection', 'Repair', 'Lubrication', 'Automation', 'Tyres', 'Other'];
  const BASIS = { tr: 'Tele-remote meter', rcc: 'RCC meter', total: 'Total (TR + RCC)' };

  const statusLabel = (s) => ({ overdue: 'Overdue', soon: 'Due soon', ok: 'On track', done: 'Completed' }[s] || s);
  const stColor = (s) => (s === 'overdue' ? 'var(--bad)' : s === 'soon' ? 'var(--warn)' : s === 'done' ? 'var(--faint)' : 'var(--ok)');

  function dueText(m, st) {
    const cls = st.status === 'overdue' ? 'cd-over' : st.status === 'soon' ? 'cd-soon' : 'cd-ok';
    let h = '';
    if (m.dueAt) h += '<div><div class="countdown ' + cls + '" data-cd="' + m.dueAt + '">' + countdown(m.dueAt - Date.now()) + '</div><div class="hint">' + (m.dueAt < Date.now() ? 'was due ' : 'due ') + esc(dt(m.dueAt)) + '</div></div>';
    if (st.hrsLeft != null) {
      h += '<div><div class="countdown ' + cls + '">' + num1(st.hrsLeft) + '<span class="u">h</span> left</div><div class="hint">' + esc(BASIS[m.basis] || '') + ' at ' + num1(m.dueReading) +
        (st.estAt && st.hrsLeft > 0 ? ' · ≈ ' + esc(dt(st.estAt).split(',')[0]) + ' (' + num1(st.rate) + ' h/day)' : '') + '</div></div>';
    }
    return h || '<span class="muted">—</span>';
  }

  /** "2 trucks + 1 bucket" style text for a bucket count. */
  function truckText(buckets, perTruck) {
    const te = Core.truckEq(buckets, perTruck);
    if (!te) return null;
    const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    if (!te.rest) return pl(te.full, 'truck');
    if (!te.full) return te.rest + '/' + perTruck + ' of a truck';
    return pl(te.full, 'truck') + ' + ' + pl(te.rest, 'bucket');
  }

  const nOrDec = (x) => (Number.isInteger(x) ? String(x) : num1(x));

  /** Live bucket counter shown on a loader's card. */
  function bucketBox(m) {
    const n = m.bucketCount || 0;
    const tt = truckText(n, m.bucketsPerTruck);
    return '<div class="bucket" data-bk="' + m.id + '">' +
      '<div class="bk-h"><span class="bk-l">' + icon('fleet') + 'Bucket count</span>' +
      (n ? '<button class="btn sm ghost" data-breset="' + m.id + '" title="Set the counter back to 0">Reset</button>' : '') + '</div>' +
      '<div class="bk-row"><button class="btn bk-btn" data-bdec="' + m.id + '" aria-label="Remove one bucket" ' + (n ? '' : 'disabled') + '>−</button>' +
      '<div class="bk-v"><b data-bkn>' + n + '</b><span data-bkt>' + (!m.bucketsPerTruck ? 'Set buckets per truck in Site setup' : n ? '= ' + esc(tt) : 'Tap + for each bucket') + '</span></div>' +
      '<button class="btn bk-btn primary" data-binc="' + m.id + '" aria-label="Add one bucket">+</button></div>' +
      (m.bucketsPerTruck ? '<div class="hint">' + nOrDec(m.bucketsPerTruck) + ' buckets = 1 truck' + (n && m.bucketCountBy ? ' · last count by ' + esc(m.bucketCountBy) : '') + '</div>' : '') +
      '</div>';
  }

  function head(sub) {
    return '<div class="view-head"><div><h2>Fleet Monitoring</h2><div class="sub">' + esc(App.site.name) + ' · live machine status, hour meters and maintenance countdowns</div></div>' +
      '<div class="head-actions"><div class="subtabs">' + [['overview', 'Overview'], ['log', 'Shift log'], ['maintenance', 'Maintenance']].map(([k, l]) =>
        '<button data-sub="' + k + '" class="' + (sub === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div></div>';
  }

  /* =================================================== overview */
  function renderOverview(wrap) {
    const S = App.S, met = S.meters;
    const month = S.month;
    const A = Core.analytics(S.data, month, S.computed);
    const ms = App.maintStatuses();
    const today = Core.localDate(Date.now());
    const days = []; for (let i = 13; i >= 0; i--) days.push(Core.addDays(today, -i));
    const counts = {};
    S.data.machines.forEach((m) => { const k = m.active === false ? 'Not in service' : (m.status || 'Operating'); counts[k] = (counts[k] || 0) + 1; });

    wrap.insertAdjacentHTML('beforeend',
      '<div class="grid g-kpi">' +
      ['Operating', 'Standby', 'Down', 'In maintenance', 'Not in service'].map((k) =>
        '<div class="card kpi" style="--c:' + (STATUS_COLOR[k] || 'var(--faint)') + '"><div class="l">' + k + '</div><div class="v">' + (counts[k] || 0) + '</div></div>').join('') +
      '</div>' +
      (S.data.machines.length ? '<div class="grid g-3 mt">' + S.data.machines.map((m) => {
        const mt = met[m.id] || {};
        const pm = A.perMachine.find((p) => p.machine.id === m.id) || { tr: 0, rcc: 0, total: 0, shifts: 0 };
        const series = days.map((d) => S.computed.rows.filter((r) => r.machineId === m.id && r.date === d && r.valid).reduce((a, r) => a + r.total, 0));
        const mine = ms.filter((x) => x.m.machineId === m.id).sort((a, b) => {
          const rank = { overdue: 0, soon: 1, ok: 2 };
          return (rank[a.st.status] - rank[b.st.status]) || ((a.st.nextAt || Infinity) - (b.st.nextAt || Infinity));
        });
        const nx = mine[0];
        const inactive = m.active === false;
        const col = inactive ? 'var(--faint)' : (STATUS_COLOR[m.status] || 'var(--ok)');
        return '<div class="card mcard" style="--c:' + col + (inactive ? ';opacity:.7' : '') + '">' +
          '<div class="top"><div><h4>' + esc(m.name) + '</h4><div class="muted">' + esc(m.model || '') + (mt.lastDate ? ' · last log ' + dShort(mt.lastDate) : '') + '</div></div>' +
          (inactive ? '<span class="pill">not yet in service</span>' :
            '<select class="inp" data-status="' + m.id + '" style="width:auto;min-height:32px;padding:4px 8px;font-size:12.5px">' + Core.MACHINE_STATUS.map((s) => '<option ' + ((m.status || 'Operating') === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select>') + '</div>' +
          '<div class="meters"><div class="meter"><div class="l"><i style="background:' + TR + '"></i>TR meter</div><div class="v">' + num1(mt.tr) + '</div></div>' +
          '<div class="meter"><div class="l"><i style="background:' + RCC + '"></i>RCC meter</div><div class="v">' + num1(mt.rcc) + '</div></div></div>' +
          '<div><div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12px">' + UI.monthLabel(month) + ': <b style="color:#fff">' + num1(pm.total) + ' h</b> in ' + pm.shifts + ' shifts</span>' + splitBar(pm.tr, pm.rcc) + '</div>' +
          '<div class="hint">Manual: <b style="color:#fff">' + num1(pm.manual || 0) + ' h</b>' +
            (Core.isLoader(m) && pm.buckets ? ' · Buckets: <b style="color:#fff">' + pm.buckets + '</b>' + (pm.trucks != null ? ' ≈ ' + num1(pm.trucks) + ' trucks' : '') : '') + '</div>' +
          spark(series, '#A08C64') + '<div class="hint" style="margin-top:-4px">Last 14 days · last operator: ' + esc(mt.lastOperator || '–') + '</div></div>' +
          (Core.isLoader(m) && !inactive ? bucketBox(m) : '') +
          (nx ? '<div class="next-maint">' + ring(nx.st.pct, stColor(nx.st.status), Math.round(nx.st.pct * 100) + '%') +
            '<div style="flex:1;min-width:0"><div class="row" style="gap:6px"><b style="font-size:13.5px">' + esc(nx.m.title) + '</b><span class="pill ' + nx.st.status + '">' + statusLabel(nx.st.status) + '</span></div>' + dueText(nx.m, nx.st) + '</div></div>'
            : '<div class="next-maint"><span class="muted">No maintenance scheduled</span></div>') +
          '<div class="row"><button class="btn sm primary" data-logm="' + m.id + '" ' + (inactive ? 'disabled' : '') + '>' + icon('pencil') + ' Log shift</button><button class="btn sm" data-perm="maintCreate" data-schedm="' + m.id + '">' + icon('wrench') + ' Schedule</button>' +
          '<button class="btn sm ghost" data-hist="' + m.id + '">' + icon('clock') + ' History</button></div>' +
          '</div>';
      }).join('') + '</div>'
        : '<div class="card mt"><div class="empty">' + icon('fleet') + '<div>No machines at this site yet.</div><a class="btn primary mt" href="#/sites/setup">' + icon('plus') + ' Add machines</a></div></div>'));

    wrap.addEventListener('change', async (e) => {
      const s = e.target.closest('[data-status]'); if (!s) return;
      try { await API.put('machines/' + s.dataset.status, { status: s.value }); toast(App.machineName(s.dataset.status) + ' → ' + s.value); }
      catch (er) { toast(er.message, 'err'); }
    });
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const bid = b.dataset.binc || b.dataset.bdec;
      if (bid) {
        const m = S.data.machines.find((x) => x.id === bid); if (!m) return;
        const delta = b.dataset.binc ? 1 : -1;
        const box = b.closest('[data-bk]');
        const next = Math.max(0, Number($('[data-bkn]', box).textContent) + delta);
        // show the new count straight away; the server's answer (and other devices) follow via live updates
        $('[data-bkn]', box).textContent = next;
        if (m.bucketsPerTruck) $('[data-bkt]', box).textContent = next ? '= ' + truckText(next, m.bucketsPerTruck) : 'Tap + for each bucket';
        $('[data-bdec]', box).disabled = !next;
        try { await API.post('machines/' + bid + '/buckets', { delta, opId: Core.uid('bk_') }); }
        catch (er) { toast(er.message, 'err'); }
        return;
      }
      if (b.dataset.breset) {
        const m = S.data.machines.find((x) => x.id === b.dataset.breset);
        if (!m || !(await confirmBox('Set the bucket count for ' + m.name + ' back to 0? (' + (m.bucketCount || 0) + ' buckets counted)', { okText: 'Reset' }))) return;
        try { await API.post('machines/' + m.id + '/buckets', { set: 0, opId: Core.uid('bk_') }); toast(m.name + ': bucket count reset'); }
        catch (er) { toast(er.message, 'err'); }
        return;
      }
      if (b.dataset.logm) openEntryModal(null, { machineId: b.dataset.logm });
      if (b.dataset.schedm) maintModal(null, b.dataset.schedm);
      if (b.dataset.hist) historyModal(b.dataset.hist);
    });
  }

  function historyModal(machineId) {
    const S = App.S;
    const rows = S.computed.rows.filter((r) => r.machineId === machineId).slice(-30).reverse();
    const logs = S.data.maintLog.filter((l) => l.machineId === machineId).sort((a, b) => b.doneAt - a.doneAt).slice(0, 10);
    modal({
      title: App.machineName(machineId) + ' — history', wide: true, footer: '<button class="btn" data-x>Close</button>',
      body: '<h4 class="muted" style="margin-bottom:8px">Last 30 shift rows</h4>' + logTable(rows, { compact: true }) +
        '<h4 class="muted" style="margin:18px 0 8px">Maintenance completed</h4>' +
        (logs.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Done</th><th>Task</th><th>By</th><th class="n">TR</th><th class="n">RCC</th><th>Notes</th></tr></thead><tbody>' +
          logs.map((l) => '<tr><td>' + esc(dt(l.doneAt)) + '</td><td>' + esc(l.title) + '</td><td>' + esc(l.doneBy) + '</td><td class="n">' + num1(l.readingTR) + '</td><td class="n">' + num1(l.readingRCC) + '</td><td class="wrap">' + esc(l.notes || '') + '</td></tr>').join('') +
          '</tbody></table></div>' : '<div class="muted">None yet</div>')
    });
  }

  /* =================================================== shift log */
  function opts(list, sel, placeholder) {
    return (placeholder ? '<option value="">' + placeholder + '</option>' : '') + list.map((v) => {
      const [val, lab] = Array.isArray(v) ? v : [v, v];
      return '<option value="' + esc(val) + '" ' + (val === sel ? 'selected' : '') + '>' + esc(lab) + '</option>';
    }).join('');
  }

  /** Builds the entry form into `root`. Operators only type END readings; START fills itself in. */
  function entryForm(root, entry, preset, onSaved) {
    const S = App.S, site = App.site;
    const last = (() => { try { return JSON.parse(API.store.get('mhp.lastEntry') || '{}'); } catch (e) { return {}; } })();
    const e = entry || Object.assign({ date: Core.localDate(Date.now()), shift: last.shift || (site.shifts || ['Day'])[0], telehut: last.telehut || '' }, preset || {});
    const machines = S.data.machines.filter((m) => m.active !== false || (entry && m.id === entry.machineId));
    root.innerHTML =
      '<form class="entry-form" autocomplete="off"><div class="form-grid">' +
      '<label class="field"><span>Date <span class="kbd">Ctrl+;</span></span><input class="inp in" type="date" name="date" required value="' + esc(e.date || '') + '"></label>' +
      '<label class="field"><span>Shift</span><select class="inp in" name="shift" required>' + opts(site.shifts || ['Day', 'Night'], e.shift) + '</select></label>' +
      '<label class="field"><span>Machine</span><select class="inp in" name="machineId" required>' + opts(machines.map((m) => [m.id, m.name]), e.machineId, '— select —') + '</select></label>' +
      '<label class="field"><span>Telehut</span><select class="inp in" name="telehut">' + opts(S.data.telehuts.map((t) => t.name), e.telehut, '—') + '</select></label>' +
      '<label class="field"><span>Operator</span><select class="inp in" name="operator">' + opts(S.data.operators.map((o) => o.name).concat(e.operator && !S.data.operators.some((o) => o.name === e.operator) ? [e.operator] : []), e.operator, '— select —') + '</select></label>' +
      '<label class="field"><span>TR end reading</span><input class="inp in" type="number" step="0.1" inputmode="decimal" name="trEnd" required value="' + (e.trEnd != null ? e.trEnd : '') + '"></label>' +
      '<label class="field"><span>RCC end reading</span><input class="inp in" type="number" step="0.1" inputmode="decimal" name="rccEnd" required value="' + (e.rccEnd != null ? e.rccEnd : '') + '"></label>' +
      '<label class="field" data-bfield><span>Buckets <span data-bsrc class="faint"></span></span><input class="inp in" type="number" step="1" min="0" inputmode="numeric" name="buckets" value="' + (e.buckets != null ? e.buckets : '') + '"></label>' +
      '<label class="field" style="grid-column:span 2"><span>Remarks (optional)</span><input class="inp" name="remarks" value="' + esc(e.remarks || '') + '" placeholder="e.g. RCC tram to workshop"></label>' +
      '</div><div class="preview" data-preview></div>' +
      '<div class="row mt" style="justify-content:space-between"><span class="hint">Start = this loader\'s previous End reading (first row uses the opening reading).</span>' +
      '<button class="btn primary" type="submit">' + icon('check') + (entry ? ' Save changes' : ' Save row') + '</button></div></form>';
    const form = $('form', root);
    const pv = $('[data-preview]', root);
    const mOf = (id) => S.data.machines.find((m) => m.id === id);
    // Buckets: loaders only; a new row starts from the machine's live counter.
    let fromCounter = false;
    function syncBuckets() {
      const m = mOf(form.elements.machineId.value);
      const loader = !m || Core.isLoader(m);
      $('[data-bfield]', form).classList.toggle('hidden', !loader);
      const inp = form.elements.buckets, src = $('[data-bsrc]', form);
      if (!loader) { inp.value = ''; fromCounter = false; src.textContent = ''; return; }
      if (!entry && m && (fromCounter || inp.value === '')) {
        const n = m.bucketCount || 0;
        inp.value = n ? n : ''; fromCounter = n > 0;
        src.textContent = n ? '(counter)' : '';
      }
    }
    form.elements.machineId.addEventListener('change', syncBuckets);
    form.elements.buckets.addEventListener('input', () => { fromCounter = false; $('[data-bsrc]', form).textContent = ''; });
    syncBuckets();

    function candidate() {
      const f = UI.formData(form);
      return { id: entry ? entry.id : '__new', siteId: S.siteId, date: f.date, shift: f.shift, machineId: f.machineId, telehut: f.telehut, operator: f.operator, trEnd: f.trEnd, rccEnd: f.rccEnd, buckets: f.buckets, createdAt: entry ? entry.createdAt : Date.now() + 1e9 };
    }
    function preview() {
      const c = candidate();
      if (!c.machineId || !c.date) { pv.innerHTML = '<div class="muted">Pick a machine to see its start readings.</div>'; return null; }
      const list = S.data.entries.filter((x) => !entry || x.id !== entry.id).concat([Object.assign({}, c, { trEnd: c.trEnd == null ? NaN : c.trEnd, rccEnd: c.rccEnd == null ? NaN : c.rccEnd })]);
      const r = Core.computeSite({ site, machines: S.data.machines, entries: list }).rows.find((x) => x.id === c.id);
      const has = c.trEnd != null && c.rccEnd != null;
      const bad = (v) => v != null && v < 0;
      const tag = (lab, v, cls) => '<div><div class="l">' + lab + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
      let check = '<span class="muted">—</span>';
      if (has) check = !r.valid ? '<span class="check-bad">✗ ' + esc(r.issues.join(', ')) + '</span>' : r.warnings.length ? '<span class="check-warn">⚠ ' + esc(r.warnings.join(', ')) + '</span>' : '<span class="check-ok">✓ OK</span>';
      pv.innerHTML = tag('TR start', num1(r.trStart), 'muted') + tag('TR hrs', c.trEnd != null ? num1(r.trHrs) : '–', bad(r.trHrs) ? 'check-bad' : '') +
        tag('RCC start', num1(r.rccStart), 'muted') + tag('RCC hrs', c.rccEnd != null ? num1(r.rccHrs) : '–', bad(r.rccHrs) ? 'check-bad' : '') +
        tag('Total hrs', has && r.valid ? num1(r.total) : '–') + tag('Manual hrs', has && r.valid ? num1(r.manualHrs) : '–') +
        (r.trucks != null ? tag('Trucks', num1(r.trucks)) : '') + '<div><div class="l">Check</div><div class="v" style="font-size:14px">' + check + '</div></div>';
      $('[name=trEnd]', form).classList.toggle('err', has && bad(r.trHrs));
      $('[name=rccEnd]', form).classList.toggle('err', has && bad(r.rccHrs));
      return r;
    }
    form.addEventListener('input', preview);
    form.addEventListener('change', preview);
    preview();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const r = preview();
      const f = UI.formData(form);
      if (!f.machineId) return toast('Select a machine', 'err');
      if (f.trEnd == null || f.rccEnd == null) return toast('Enter both end readings', 'err');
      if (f.buckets != null && !(Number.isInteger(f.buckets) && f.buckets >= 0)) return toast('Buckets must be a whole number', 'err');
      const m = mOf(f.machineId);
      if (m && !Core.isLoader(m)) f.buckets = null;
      // buckets logged for a loader come off its live counter (new rows only)
      if (!entry && m && Core.isLoader(m) && f.buckets > 0 && (m.bucketCount || 0) > 0) f.takeBuckets = true;
      if (r && !r.valid && !(await confirmBox('This row fails the check (' + r.issues.join(', ') + ') and will be left out of totals. Save anyway?', { okText: 'Save anyway' }))) return;
      try {
        if (entry) await API.put('entries/' + entry.id, f);
        else await API.post('sites/' + S.siteId + '/entries', f);
        API.store.set('mhp.lastEntry', JSON.stringify({ shift: f.shift, telehut: f.telehut }));
        toast((entry ? 'Updated ' : 'Saved ') + App.machineName(f.machineId) + ' · ' + f.shift + ' ' + dShort(f.date));
        if (!entry) {
          ['machineId', 'operator', 'trEnd', 'rccEnd', 'buckets', 'remarks'].forEach((n) => { form.elements[n].value = ''; });
          fromCounter = false; syncBuckets();
          preview();
          form.elements.machineId.focus();
        }
        if (onSaved) onSaved();
      } catch (er) { toast(er.message, 'err'); }
    });
    return form;
  }

  function openEntryModal(entry, preset) {
    modal({
      title: entry ? 'Edit shift row' : 'Log end-of-shift readings', wide: true, footer: false,
      body: '<div data-ef></div>',
      onMount: (ov, close) => {
        entryForm($('[data-ef]', ov), entry, preset, () => { if (entry) close(); });
        if (!entry) $('[data-ef] form', ov).insertAdjacentHTML('beforeend', '<p class="hint" style="margin-bottom:0">Saved rows keep the date and shift so you can log the next loader straight away. Press Esc to close.</p>');
      }
    });
  }

  function logTable(rows, o) {
    o = o || {};
    if (!rows.length) return '<div class="empty">' + icon('hourglass') + '<div>No rows match.</div></div>';
    return '<div class="tbl-wrap" style="max-height:' + (o.compact ? '360px' : '70vh') + '"><table class="tbl"><thead>' +
      '<tr><th class="grp" colspan="5"></th><th class="grp" colspan="3">Tele-remote hour meter</th><th class="grp" colspan="3">RCC hour meter</th><th class="grp" colspan="' + (o.compact ? 5 : 7) + '"></th></tr>' +
      '<tr><th>Date</th><th>Shift</th><th>Machine</th><th>Telehut</th><th>Operator</th><th class="n">Start</th><th class="n">End</th><th class="n">Hrs</th><th class="n">Start</th><th class="n">End</th><th class="n">Hrs</th><th class="n">Total hrs</th><th class="n">Manual hrs</th><th class="n">Buckets</th><th>Check</th><th>Remarks</th>' +
      (o.compact ? '' : '<th>Logged by</th><th></th>') + '</tr></thead><tbody>' +
      rows.map((r) => {
        const trBad = r.trHrs != null && r.trHrs < 0, rcBad = r.rccHrs != null && r.rccHrs < 0;
        const chk = !r.valid ? '<span class="check-bad">✗ ' + esc(r.issues.join(', ')) + '</span>' : r.warnings.length ? '<span class="check-warn">⚠ ' + esc(r.warnings.join(', ')) + '</span>' : '<span class="check-ok">✓</span>';
        return '<tr><td>' + dShort(r.date) + '</td><td>' + esc(r.shift) + '</td><td>' + esc(App.machineName(r.machineId)) + '</td><td>' + esc(r.telehut || '') + '</td><td>' + esc(r.operator || '') + '</td>' +
          '<td class="n auto">' + num1(r.trStart) + '</td><td class="n ' + (trBad ? 'bad' : '') + '">' + num1(r.trEnd) + '</td><td class="n strong ' + (trBad ? 'bad' : '') + '">' + num1(r.trHrs) + '</td>' +
          '<td class="n auto">' + num1(r.rccStart) + '</td><td class="n ' + (rcBad ? 'bad' : '') + '">' + num1(r.rccEnd) + '</td><td class="n strong ' + (rcBad ? 'bad' : '') + '">' + num1(r.rccHrs) + '</td>' +
          '<td class="n strong">' + (r.valid ? num1(r.total) : '—') + '</td><td class="n">' + (r.manualHrs != null ? num1(r.manualHrs) : '—') + '</td>' +
          '<td class="n">' + (r.buckets != null ? r.buckets + (r.trucks != null ? '<div class="faint" style="font-size:11px">≈ ' + num1(r.trucks) + ' trucks</div>' : '') : '') + '</td><td>' + chk + '</td><td class="wrap">' + esc(r.remarks || '') + '</td>' +
          (o.compact ? '' : '<td class="muted">' + esc(r.createdByName || '') + '</td><td class="acts">' + (App.canEditEntry(r) ? '<button class="btn icon sm ghost" data-edit="' + r.id + '" title="Edit">' + icon('pencil') + '</button><button class="btn icon sm ghost" data-del="' + r.id + '" title="Delete">' + icon('trash') + '</button>' : '<span class="faint" title="You can change your own rows for ' + App.S.settings.entryEditHours + ' h. Ask a superuser for older rows.">' + icon('shield') + '</span>') + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  const logFilter = { month: null, machine: '', shift: '', check: false, q: '' };
  function renderLog(wrap) {
    const S = App.S;
    logFilter.month = logFilter.month || S.month;
    const months = Array.from(new Set(S.data.entries.map((e) => e.date.slice(0, 7)).concat([S.month]))).sort().reverse();
    wrap.insertAdjacentHTML('beforeend',
      '<div class="card"><div class="card-h"><h3>' + icon('pencil') + 'Enter end-of-shift readings</h3><span class="legend"><span><b style="background:rgba(160,140,100,.45)"></b>Operator fills in</span><span><b style="background:rgba(255,255,255,.12)"></b>Fills itself in</span></span></div><div data-ef></div></div>' +
      '<div class="card mt"><div class="card-h"><h3>' + icon('hourglass') + 'Machine Hours log</h3><div class="row"><button class="btn sm" data-csv>' + icon('download') + ' CSV</button></div></div>' +
      '<div class="filters" style="margin-bottom:12px">' +
      '<label class="field"><span>Month</span><select class="inp" data-f="month"><option value="">All</option>' + months.map((m) => '<option value="' + m + '" ' + (m === logFilter.month ? 'selected' : '') + '>' + UI.monthLabel(m) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Machine</span><select class="inp" data-f="machine">' + opts(S.data.machines.map((m) => [m.id, m.name]), logFilter.machine, 'All') + '</select></label>' +
      '<label class="field"><span>Shift</span><select class="inp" data-f="shift">' + opts(App.site.shifts || [], logFilter.shift, 'All') + '</select></label>' +
      '<label class="field"><span>Search</span><input class="inp" data-f="q" placeholder="Operator, remark…" value="' + esc(logFilter.q) + '"></label>' +
      '<label class="check" style="min-height:42px"><input type="checkbox" data-f="check" ' + (logFilter.check ? 'checked' : '') + '> Only rows needing a check</label></div>' +
      '<div data-table></div>' +
      '<p class="hint" style="margin-bottom:0">Rows where End &lt; Start are shown in red and left out of totals. The next row carries on from the last good reading.</p></div>');
    entryForm($('[data-ef]', wrap), null, null);
    const drawTable = () => {
      const q = logFilter.q.toLowerCase();
      const rows = S.computed.rows.filter((r) =>
        (!logFilter.month || r.date.startsWith(logFilter.month)) && (!logFilter.machine || r.machineId === logFilter.machine) &&
        (!logFilter.shift || r.shift === logFilter.shift) && (!logFilter.check || r.needsCheck) &&
        (!q || ((r.operator || '') + ' ' + (r.remarks || '') + ' ' + (r.telehut || '') + ' ' + App.machineName(r.machineId)).toLowerCase().includes(q))).slice().reverse();
      $('[data-table]', wrap).innerHTML = '<div class="hint" style="margin-bottom:6px">' + rows.length + ' rows</div>' + logTable(rows);
      return rows;
    };
    let shown = drawTable();
    wrap.addEventListener('input', UI.debounce((e) => { const f = e.target.dataset.f; if (f === 'q') { logFilter.q = e.target.value; shown = drawTable(); } }, 200));
    wrap.addEventListener('change', (e) => {
      const f = e.target.dataset.f; if (!f || f === 'q') return;
      logFilter[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      shown = drawTable();
    });
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) openEntryModal(S.data.entries.find((x) => x.id === b.dataset.edit));
      if (b.dataset.del) {
        const r = S.computed.rows.find((x) => x.id === b.dataset.del);
        if (await confirmBox('Delete the ' + r.shift + ' ' + dShort(r.date) + ' row for ' + App.machineName(r.machineId) + '? Later start readings will be recalculated.', { danger: true, okText: 'Delete' })) {
          try { await API.del('entries/' + r.id); toast('Row deleted'); } catch (er) { toast(er.message, 'err'); }
        }
      }
      if ('csv' in b.dataset) {
        const rows = [['Date', 'Shift', 'Machine', 'Telehut', 'Operator', 'TR start', 'TR end', 'TR hrs', 'RCC start', 'RCC end', 'RCC hrs', 'Total hrs', 'Manual hrs', 'Buckets', 'Trucks', 'Check', 'Remarks', 'Logged by']];
        shown.forEach((r) => rows.push([r.date, r.shift, App.machineName(r.machineId), r.telehut, r.operator, r.trStart, r.trEnd, r.trHrs, r.rccStart, r.rccEnd, r.rccHrs, r.total, r.manualHrs, r.buckets, r.trucks, r.needsCheck ? r.issues.concat(r.warnings).join('; ') : 'OK', r.remarks, r.createdByName]));
        UI.downloadCSV('shift-log_' + App.site.name.replace(/[^\w-]+/g, '_') + '.csv', rows);
      }
    });
    // live refresh of the table only (keeps the entry form as typed)
    Views.fleet._logUpdate = () => { shown = drawTable(); };
  }

  /* =================================================== maintenance */
  const maintFilter = { machine: '' };
  function renderMaint(wrap) {
    const S = App.S;
    const all = App.maintStatuses().filter((x) => !maintFilter.machine || x.m.machineId === maintFilter.machine);
    const rank = { overdue: 0, soon: 1, ok: 2 };
    all.sort((a, b) => (rank[a.st.status] - rank[b.st.status]) || ((a.st.nextAt || Infinity) - (b.st.nextAt || Infinity)));
    const c = (s) => all.filter((x) => x.st.status === s).length;
    const since = Date.now() - 30 * Core.DAY;
    const logs = S.data.maintLog.filter((l) => !maintFilter.machine || l.machineId === maintFilter.machine).sort((a, b) => b.doneAt - a.doneAt);
    const doneList = S.data.maintenance.filter((m) => m.status === 'done' && (!maintFilter.machine || m.machineId === maintFilter.machine));

    wrap.insertAdjacentHTML('beforeend',
      '<div class="grid g-kpi">' +
      '<div class="card kpi ' + (c('overdue') ? 'bad' : '') + '" style="--c:var(--bad)"><div class="l">' + icon('alert') + 'Overdue</div><div class="v">' + c('overdue') + '</div></div>' +
      '<div class="card kpi ' + (c('soon') ? 'warn' : '') + '" style="--c:var(--warn)"><div class="l">' + icon('clock') + 'Due soon</div><div class="v">' + c('soon') + '</div></div>' +
      '<div class="card kpi" style="--c:var(--ok)"><div class="l">' + icon('check') + 'On track</div><div class="v">' + c('ok') + '</div></div>' +
      '<div class="card kpi" style="--c:var(--sv-gold)"><div class="l">' + icon('wrench') + 'Completed (30 d)</div><div class="v">' + logs.filter((l) => l.doneAt > since).length + '</div></div></div>' +
      '<div class="row mt" style="justify-content:space-between;align-items:flex-end"><div class="filters"><label class="field"><span>Machine</span><select class="inp" data-mf>' + opts(S.data.machines.map((m) => [m.id, m.name]), maintFilter.machine, 'All machines') + '</select></label></div>' +
      '<button class="btn primary" data-perm="maintCreate" data-newm>' + icon('plus') + ' Schedule maintenance</button></div>' +
      '<div class="stack mt">' + (all.length ? all.map(({ m, st }) =>
        '<div class="card maint-card ' + st.status + '">' + ring(st.pct, stColor(st.status), Math.round(st.pct * 100) + '%', 74) +
        '<div style="min-width:0"><div class="row" style="gap:8px"><span class="ttl">' + esc(m.title) + '</span><span class="pill ' + st.status + '">' + statusLabel(st.status) + '</span>' + (m.category ? '<span class="pill">' + esc(m.category) + '</span>' : '') + '</div>' +
        '<div class="meta"><span>' + icon('fleet') + ' <b style="color:#fff">' + esc(App.machineName(m.machineId)) + '</b></span>' +
        (m.assignee ? '<span>' + icon('user') + ' ' + esc(m.assignee) + '</span>' : '') +
        ((m.intervalDays || m.intervalHours) ? '<span>' + icon('refresh') + ' every ' + [m.intervalDays ? m.intervalDays + ' d' : '', m.intervalHours ? m.intervalHours + ' h' : ''].filter(Boolean).join(' / ') + '</span>' : '<span>one-off</span>') +
        (m.lastDoneAt ? '<span>last done ' + esc(dt(m.lastDoneAt)) + '</span>' : '') + '</div>' +
        '<div class="row mt" style="gap:24px;align-items:flex-start">' + dueText(m, st) + '</div>' +
        (m.notes ? '<div class="hint mt">' + esc(m.notes) + '</div>' : '') + '</div>' +
        '<div class="acts"><button class="btn sm primary" data-done="' + m.id + '">' + icon('check') + ' Complete</button><button class="btn icon sm" data-perm="maintEdit" data-editmt="' + m.id + '" title="Edit">' + icon('pencil') + '</button><button class="btn icon sm danger" data-perm="maintEdit" data-delmt="' + m.id + '" title="Delete">' + icon('trash') + '</button></div></div>').join('')
        : '<div class="card"><div class="empty">' + icon('calendar') + '<div>No open maintenance schedules.</div></div></div>') + '</div>' +
      (doneList.length ? '<div class="card mt"><div class="card-h"><h3>' + icon('check') + 'Closed one-off tasks</h3></div><div class="chips">' + doneList.map((m) => '<span class="chip">' + esc(App.machineName(m.machineId)) + ' · ' + esc(m.title) + '<button data-perm="maintEdit" data-reopen="' + m.id + '" title="Reopen">' + icon('refresh') + '</button></span>').join('') + '</div></div>' : '') +
      '<div class="card mt"><div class="card-h"><h3>' + icon('clock') + 'Completion history</h3></div>' +
      (logs.length ? '<div class="tbl-wrap" style="max-height:420px"><table class="tbl"><thead><tr><th>Completed</th><th>Machine</th><th>Task</th><th>By</th><th>Was due</th><th class="n">TR meter</th><th class="n">RCC meter</th><th>Notes</th><th></th></tr></thead><tbody>' +
        logs.map((l) => '<tr><td>' + esc(dt(l.doneAt)) + '</td><td>' + esc(App.machineName(l.machineId)) + '</td><td>' + esc(l.title) + '</td><td>' + esc(l.doneBy) + '</td>' +
          '<td>' + (l.dueAt ? (l.doneAt > l.dueAt ? '<span class="pill overdue">late</span> ' : '<span class="pill ok">on time</span> ') + esc(dt(l.dueAt).split(',')[0]) : (l.dueReading ? 'at ' + num1(l.dueReading) + ' h' : '–')) + '</td>' +
          '<td class="n">' + num1(l.readingTR) + '</td><td class="n">' + num1(l.readingRCC) + '</td><td class="wrap">' + esc(l.notes || '') + '</td><td class="acts"><button class="btn icon sm ghost" data-perm="super" data-dellog="' + l.id + '">' + icon('trash') + '</button></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">Nothing completed yet.</div>') + '</div>');

    $('[data-mf]', wrap).addEventListener('change', (e) => { maintFilter.machine = e.target.value; App.refresh({ type: 'filter', force: true }); });
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if ('newm' in b.dataset) maintModal(null, maintFilter.machine || null);
        if (b.dataset.editmt) maintModal(S.data.maintenance.find((x) => x.id === b.dataset.editmt));
        if (b.dataset.done) completeModal(S.data.maintenance.find((x) => x.id === b.dataset.done));
        if (b.dataset.delmt) {
          const m = S.data.maintenance.find((x) => x.id === b.dataset.delmt);
          if (await confirmBox('Delete the schedule "' + m.title + '" for ' + App.machineName(m.machineId) + '?', { danger: true, okText: 'Delete' })) { await API.del('maintenance/' + m.id); toast('Schedule deleted'); }
        }
        if (b.dataset.reopen) { const m = S.data.maintenance.find((x) => x.id === b.dataset.reopen); maintModal(m, null, true); }
        if (b.dataset.dellog) { if (await confirmBox('Remove this completion record?', { danger: true, okText: 'Remove' })) await API.del('maintLog/' + b.dataset.dellog); }
      } catch (er) { toast(er.message, 'err'); }
    });
  }

  function maintModal(m, machineId, reopen) {
    const S = App.S, site = App.site;
    m = m || { machineId: machineId || '', basis: 'none', category: 'Service' };
    const byDate = !!m.dueAt || !m.id;
    const byHours = m.basis && m.basis !== 'none';
    modal({
      title: reopen ? 'Reopen: ' + m.title : m.id ? 'Edit maintenance schedule' : 'Schedule maintenance', wide: true, okText: m.id ? 'Save' : 'Create schedule',
      body: '<div class="form-grid">' +
        '<label class="field"><span>Machine *</span><select class="inp" name="machineId">' + opts(S.data.machines.map((x) => [x.id, x.name]), m.machineId, '— select —') + '</select></label>' +
        '<label class="field" style="grid-column:span 2"><span>Task *</span><input class="inp" name="title" value="' + esc(m.title || '') + '" placeholder="e.g. 250 h service"></label>' +
        '<label class="field"><span>Category</span><select class="inp" name="category">' + opts(CATS, m.category) + '</select></label>' +
        '<label class="field"><span>Assigned to</span><input class="inp" name="assignee" value="' + esc(m.assignee || '') + '" placeholder="Workshop / person"></label>' +
        '</div>' +
        '<div class="grid g-2 mt">' +
        '<div class="card" style="background:rgba(255,255,255,.03)"><label class="check"><input type="checkbox" data-bydate ' + (byDate ? 'checked' : '') + '> <b>Due by date</b></label>' +
        '<div class="form-grid mt" data-datebox><label class="field full"><span>Due date &amp; time</span><input class="inp" type="datetime-local" name="dueAtLocal" value="' + UI.toLocalInput(m.dueAt || (Date.now() + 7 * Core.DAY)) + '"></label>' +
        '<label class="field"><span>Repeat every (days)</span><input class="inp" type="number" min="0" name="intervalDays" value="' + (m.intervalDays || '') + '" placeholder="one-off"></label>' +
        '<label class="field"><span>Warn days before</span><input class="inp" type="number" min="0" name="leadDays" value="' + (m.leadDays != null ? m.leadDays : '') + '" placeholder="' + (site.leadDays != null ? site.leadDays : 3) + ' (site default)"></label></div></div>' +
        '<div class="card" style="background:rgba(255,255,255,.03)"><label class="check"><input type="checkbox" data-byhours ' + (byHours ? 'checked' : '') + '> <b>Due by hour meter</b></label>' +
        '<div class="form-grid mt" data-hoursbox><label class="field"><span>Meter</span><select class="inp" name="basis">' + opts(Object.entries(BASIS), byHours ? m.basis : 'total') + '</select></label>' +
        '<label class="field"><span>Due at reading</span><input class="inp" type="number" step="0.1" name="dueReading" value="' + (m.dueReading != null ? m.dueReading : '') + '"></label>' +
        '<label class="field"><span>…or due in (hours)</span><input class="inp" type="number" step="1" data-inhours placeholder="e.g. 250"></label>' +
        '<label class="field"><span>Repeat every (hours)</span><input class="inp" type="number" min="0" name="intervalHours" value="' + (m.intervalHours || '') + '" placeholder="one-off"></label>' +
        '<label class="field"><span>Warn hours before</span><input class="inp" type="number" min="0" name="leadHours" value="' + (m.leadHours != null ? m.leadHours : '') + '" placeholder="' + (site.leadHours != null ? site.leadHours : 25) + ' (site default)"></label></div>' +
        '<div class="hint mt" data-curread></div></div></div>' +
        '<label class="field mt"><span>Notes</span><textarea class="inp" name="notes" rows="2">' + esc(m.notes || '') + '</textarea></label>' +
        '<p class="hint">Whichever limit comes first (date or hours) sets the countdown. Hours-based countdowns estimate a date from the last 14 days of use. Everyone at this site gets a notification (and email) when it is due soon and when it becomes overdue.</p>',
      onMount: (ov) => {
        const q = (s) => $(s, ov);
        const sync = () => {
          q('[data-datebox]').style.opacity = q('[data-bydate]').checked ? 1 : 0.35;
          q('[data-hoursbox]').style.opacity = q('[data-byhours]').checked ? 1 : 0.35;
          const mt = S.meters[q('[name=machineId]').value] || {};
          const basis = q('[name=basis]').value;
          q('[data-curread]').innerHTML = q('[name=machineId]').value ? 'Current ' + esc(BASIS[basis]) + ': <b>' + num1(mt[basis]) + '</b> · avg ' + num1(mt['avg_' + basis]) + ' h/day (14 d)' : 'Select a machine to see its current reading.';
        };
        ov.addEventListener('change', sync);
        q('[data-inhours]').addEventListener('input', (e) => {
          const mt = S.meters[q('[name=machineId]').value] || {};
          const cur = mt[q('[name=basis]').value];
          if (cur != null && e.target.value) { q('[name=dueReading]').value = Core.r2(cur + Number(e.target.value)); q('[data-byhours]').checked = true; sync(); }
        });
        sync();
      },
      onOk: async (ov) => {
        const f = UI.formData($('.modal-b', ov));
        const byD = $('[data-bydate]', ov).checked, byH = $('[data-byhours]', ov).checked;
        const body = {
          machineId: f.machineId, title: f.title, category: f.category, assignee: f.assignee, notes: f.notes,
          dueAt: byD ? UI.fromLocalInput(f.dueAtLocal) : null, intervalDays: byD ? f.intervalDays : null, leadDays: f.leadDays,
          basis: byH ? f.basis : 'none', dueReading: byH ? f.dueReading : null, intervalHours: byH ? f.intervalHours : null, leadHours: f.leadHours
        };
        if (!body.machineId) throw new Error('Select a machine');
        if (!body.title) throw new Error('Enter the task');
        if (!byD && !byH) throw new Error('Choose a due date and/or an hour-meter limit');
        if (byH && body.dueReading == null) throw new Error('Enter the due meter reading');
        if (m.id) { if (reopen) body.reopen = true; await API.put('maintenance/' + m.id, body); toast('Schedule saved'); }
        else { await API.post('sites/' + S.siteId + '/maintenance', body); toast('Maintenance scheduled'); }
      }
    });
  }

  function completeModal(m) {
    const mt = App.S.meters[m.machineId] || {};
    const next = [];
    if (m.intervalDays) next.push('next due in ' + m.intervalDays + ' days (' + dLong(Core.localDate(Date.now() + m.intervalDays * Core.DAY)) + ')');
    if (m.intervalHours && m.basis !== 'none') next.push('next due at ' + num1((mt[m.basis] || 0) + m.intervalHours) + ' h on the ' + BASIS[m.basis]);
    modal({
      title: 'Complete: ' + m.title, okText: 'Mark complete',
      body: '<p style="margin-top:0"><b>' + esc(App.machineName(m.machineId)) + '</b> · current TR ' + num1(mt.tr) + ' · RCC ' + num1(mt.rcc) + '</p>' +
        '<label class="field"><span>Notes (parts, findings, work order no.)</span><textarea class="inp" name="notes" rows="3"></textarea></label>' +
        '<p class="hint">' + (next.length ? 'This is a repeating task — it will reset automatically: ' + esc(next.join(' and ')) + '.' : 'One-off task — it will be closed.') + '</p>',
      onOk: async (ov) => { await API.post('maintenance/' + m.id + '/complete', { notes: $('[name=notes]', ov).value }); toast('Maintenance recorded'); }
    });
  }

  /* =================================================== view */
  let curSub = 'overview';
  Views.fleet = {
    render(wrap, r) {
      curSub = ['overview', 'log', 'maintenance'].includes(r.sub) ? r.sub : 'overview';
      Views.fleet._logUpdate = null;
      wrap.innerHTML = head(curSub);
      $$('.subtabs [data-sub]', wrap).forEach((b) => b.addEventListener('click', () => App.go('fleet', b.dataset.sub)));
      if (curSub === 'overview') renderOverview(wrap);
      else if (curSub === 'log') renderLog(wrap);
      else renderMaint(wrap);
    },
    update(ev) {
      if (ev && ev.col === 'messages') return true;
      if (curSub === 'log' && Views.fleet._logUpdate && ev && ['entries', 'machines'].includes(ev.col)) { Views.fleet._logUpdate(); return true; }
      return false;
    },
    openEntryModal, statusLabel, dueText, maintModal
  };
})();
