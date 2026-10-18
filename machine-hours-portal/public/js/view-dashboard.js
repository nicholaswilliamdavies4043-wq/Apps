/* Dashboard: month-to-date analysis (as in the v4 mockup) + charts, flagged rows, upcoming maintenance. */
(function () {
  'use strict';
  const { icon, esc, $, $$, num1, pct, dShort, monthLabel, splitBar, ago } = UI;
  const Views = (window.Views = window.Views || {});
  let charts = [];

  if (window.Chart) {
    Chart.defaults.color = '#9eabb8';
    Chart.defaults.borderColor = 'rgba(255,255,255,.07)';
    Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'Segoe UI';
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10,20,34,.95)';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,.15)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.animation.duration = 700;
  }
  const TR = '#5b8cff', RCC = '#c9a55f';

  function months() {
    const S = App.S;
    const set = new Set(S.data.entries.map((e) => e.date.slice(0, 7)));
    const now = new Date();
    set.add(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
    if (S.month) set.add(S.month);
    return Array.from(set).sort().reverse();
  }

  function announcementsStrip() {
    const S = App.S, now = Date.now();
    const list = S.data.announcements.filter((a) => !a.expires || a.expires > now)
      .sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt)).slice(0, 3);
    if (!list.length) return '';
    return '<div class="ann-strip">' + list.map((a) =>
      '<div class="card ann ' + esc(a.priority || 'info') + '"><div class="ico">' + icon(a.pinned ? 'pin' : 'megaphone') + '</div><div style="flex:1;min-width:0">' +
      '<div class="row" style="gap:8px"><h4>' + esc(a.title) + '</h4><span class="pill ' + esc(a.priority || 'info') + '">' + esc(a.priority || 'info') + '</span>' + (a.pinned ? '<span class="pill gold">pinned</span>' : '') + '</div>' +
      (a.body ? '<p>' + esc(a.body) + '</p>' : '') + '<div class="meta">' + esc(a.userName || '') + ' · ' + esc(ago(a.createdAt)) + '</div></div>' +
      '<a class="btn sm ghost" href="#/chat/announcements">View all</a></div>').join('') + '</div>';
  }

  function kpi(label, value, opts) {
    opts = opts || {};
    const v = value == null ? '–' : value;
    const counted = typeof value === 'number' && isFinite(value);
    return '<div class="card kpi ' + (opts.cls || '') + '" style="--c:' + (opts.color || 'var(--sv-gold)') + '"><div class="l">' + (opts.icon ? icon(opts.icon) : '') + esc(label) + '</div>' +
      '<div class="v">' + (counted ? '<span data-count="' + value + '" data-dec="' + (opts.dec != null ? opts.dec : 1) + '" data-suf="' + (opts.suf || '') + '">0</span>' : v) + (opts.unit ? '<small>' + opts.unit + '</small>' : '') + '</div>' +
      (opts.sub ? '<div class="s">' + opts.sub + '</div>' : '') + '</div>';
  }

  function render(wrap) {
    const S = App.S;
    const month = S.month;
    const A = Core.analytics(S.data, month, S.computed);
    const k = A.kpi;
    const ms = App.maintStatuses();
    const overdue = ms.filter((x) => x.st.status === 'overdue').length, soon = ms.filter((x) => x.st.status === 'soon').length;
    const flagged = A.rows.filter((r) => r.needsCheck);
    const activeMachines = S.data.machines.filter((m) => m.active !== false).length;

    wrap.innerHTML =
      '<div class="view-head"><div><h2>Dashboard</h2><div class="sub">Machine hours — month to date · ' + esc(App.site.name) + '</div></div>' +
      '<div class="head-actions"><label class="field" style="min-width:150px"><span>Month</span><select class="inp" data-month>' +
      months().map((m) => '<option value="' + m + '" ' + (m === month ? 'selected' : '') + '>' + monthLabel(m) + '</option>').join('') + '</select></label>' +
      '<button class="btn" data-csv>' + icon('download') + ' Export CSV</button><button class="btn primary" data-log>' + icon('pencil') + ' Log shift</button></div></div>' +
      announcementsStrip() +
      '<div class="grid g-kpi">' +
      kpi('Tele-remote hrs', k.tr, { color: TR, icon: 'wifi' }) +
      kpi('RCC hrs', k.rcc, { color: RCC, icon: 'cpu' }) +
      kpi('Total hrs', k.total, { icon: 'clock', sub: k.shifts + ' shifts · ' + num1(k.avgPerShift) + ' h avg' }) +
      kpi('Tele-remote share', k.share != null ? Math.round(k.share * 100) : null, { dec: 0, suf: '%', color: TR, icon: 'activity' }) +
      kpi('Rows needing a check', k.check, { dec: 0, cls: k.check ? 'warn' : 'good', color: k.check ? 'var(--warn)' : 'var(--ok)', icon: 'alert', sub: k.errors + ' excluded from totals' }) +
      kpi('Maintenance', overdue, { dec: 0, cls: overdue ? 'bad' : 'good', color: overdue ? 'var(--bad)' : 'var(--ok)', icon: 'wrench', unit: ' overdue', sub: soon + ' due soon · ' + activeMachines + ' active machines' }) +
      '</div>' +
      '<div class="grid g-main mt">' +
      '<div class="card"><div class="card-h"><h3>' + icon('activity') + 'Daily hours — ' + monthLabel(month) + '</h3><div class="legend"><span><b style="background:' + TR + '"></b>Tele-remote</span><span><b style="background:' + RCC + '"></b>RCC</span></div></div><div class="chart-box"><canvas id="chDaily"></canvas></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + icon('grid') + 'Hours by machine</h3></div><div class="chart-box"><canvas id="chMach"></canvas></div></div>' +
      '</div>' +
      // machine table
      '<div class="card mt"><div class="card-h"><h3>' + icon('fleet') + 'Machine hours — month to date</h3><div class="legend">Split: <span><b style="background:' + TR + '"></b>Tele-remote</span><span><b style="background:' + RCC + '"></b>RCC</span></div></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Machine</th><th class="n">Tele-remote hrs</th><th class="n">RCC hrs</th><th class="n">Total hrs</th><th>Split</th><th class="n">Shifts logged</th><th class="n">Latest TR meter</th><th class="n">Latest RCC meter</th><th>Last operator</th></tr></thead><tbody>' +
      (A.perMachine.length ? A.perMachine.map((p) => p.machine.active === false
        ? '<tr class="inactive"><td>' + esc(p.machine.name) + ' <span class="pill">not yet in service</span></td><td class="n">–</td><td class="n">–</td><td class="n">–</td><td></td><td class="n">–</td><td class="n">–</td><td class="n">–</td><td>–</td></tr>'
        : '<tr><td class="strong">' + esc(p.machine.name) + '</td><td class="n">' + num1(p.tr) + '</td><td class="n">' + num1(p.rcc) + '</td><td class="n strong">' + num1(p.total) + '</td><td>' + splitBar(p.tr, p.rcc) + '</td>' +
          '<td class="n">' + p.shifts + '</td><td class="n">' + num1(p.latestTR) + '</td><td class="n">' + num1(p.latestRCC) + '</td><td>' + esc(p.lastOperator || '–') + '</td></tr>').join('')
        : '<tr><td colspan="9" class="empty">No machines yet — add them under Site Definition → Site setup.</td></tr>') +
      '</tbody><tfoot><tr><td>All machines</td><td class="n">' + num1(k.tr) + '</td><td class="n">' + num1(k.rcc) + '</td><td class="n">' + num1(k.total) + '</td><td>' + splitBar(k.tr, k.rcc) + '</td><td class="n">' + k.shifts + '</td><td></td><td></td><td></td></tr></tfoot></table></div></div>' +
      '<div class="grid g-2 mt">' +
      // operator table
      '<div class="card"><div class="card-h"><h3>' + icon('users') + 'Operators</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Operator</th><th class="n">Shifts on duty</th><th class="n">Tele-remote hrs</th><th class="n">RCC hrs</th><th class="n">Total hrs</th></tr></thead><tbody>' +
      (A.perOperator.length ? A.perOperator.map((o) => '<tr><td>' + esc(o.name) + '</td><td class="n">' + o.shifts + '</td><td class="n">' + num1(o.tr) + '</td><td class="n">' + num1(o.rcc) + '</td><td class="n strong">' + num1(o.total) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">No operators yet</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="stack">' +
      '<div class="card"><div class="card-h"><h3>' + icon('clock') + 'Shift & telehut split</h3></div><div class="grid g-2" style="gap:10px"><div class="chart-box sm"><canvas id="chShift"></canvas></div><div class="chart-box sm"><canvas id="chHut"></canvas></div></div></div>' +
      '</div></div>' +
      '<div class="grid g-2 mt">' +
      // flagged rows
      '<div class="card"><div class="card-h"><h3>' + icon('alert') + 'Rows needing a check <span class="pill ' + (flagged.length ? 'soon' : 'ok') + '">' + flagged.length + '</span></h3><a class="btn sm ghost" href="#/fleet/log">Open shift log</a></div>' +
      (flagged.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Shift</th><th>Machine</th><th>Operator</th><th>Problem</th><th></th></tr></thead><tbody>' +
        flagged.map((r) => '<tr><td>' + dShort(r.date) + '</td><td>' + esc(r.shift) + '</td><td>' + esc(App.machineName(r.machineId)) + '</td><td>' + esc(r.operator || '') + '</td>' +
          '<td class="' + (r.valid ? 'warnc' : 'bad') + '">' + (r.valid ? '⚠ ' : '✗ ') + esc(r.issues.concat(r.warnings).join(', ')) + '</td><td class="acts">' + (App.canEditEntry(r) ? '<button class="btn sm" data-fix="' + r.id + '">Fix</button>' : '<span class="hint">superuser</span>') + '</td></tr>').join('') +
        '</tbody></table></div><p class="hint">✗ rows are left out of all totals until corrected.</p>' : '<div class="empty">' + icon('check') + '<div>All rows pass the checks this month.</div></div>') + '</div>' +
      // upcoming maintenance
      '<div class="card"><div class="card-h"><h3>' + icon('wrench') + 'Upcoming maintenance</h3><a class="btn sm ghost" href="#/fleet/maintenance">All schedules</a></div>' + upcoming(ms) + '</div>' +
      '</div>';

    UI.animateCounts(wrap);
    $('[data-month]', wrap).addEventListener('change', (e) => { S.month = e.target.value; App.refresh({ type: 'month', force: true }); });
    $('[data-log]', wrap).addEventListener('click', () => Views.fleet.openEntryModal());
    $('[data-csv]', wrap).addEventListener('click', () => exportCsv(A));
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fix]'); if (!b) return;
      Views.fleet.openEntryModal(S.data.entries.find((x) => x.id === b.dataset.fix));
    });
    drawCharts(A);
  }

  function upcoming(ms) {
    const list = ms.slice().sort((a, b) => {
      const rank = { overdue: 0, soon: 1, ok: 2 };
      return (rank[a.st.status] - rank[b.st.status]) || ((a.st.nextAt || Infinity) - (b.st.nextAt || Infinity));
    }).slice(0, 5);
    if (!list.length) return '<div class="empty">' + icon('calendar') + '<div>No maintenance scheduled.</div></div>';
    return '<div class="stack" style="gap:10px">' + list.map(({ m, st }) => {
      const col = st.status === 'overdue' ? 'var(--bad)' : st.status === 'soon' ? 'var(--warn)' : 'var(--ok)';
      return '<div class="next-maint">' + UI.ring(st.pct, col, Math.round(st.pct * 100) + '%', 48) + '<div style="flex:1;min-width:0"><div class="row" style="gap:8px"><b>' + esc(m.title) + '</b><span class="pill ' + st.status + '">' + Views.fleet.statusLabel(st.status) + '</span></div>' +
        '<div class="muted" style="font-size:12.5px">' + esc(App.machineName(m.machineId)) + '</div></div><div style="text-align:right">' + Views.fleet.dueText(m, st) + '</div></div>';
    }).join('') + '</div>';
  }

  function drawCharts(A) {
    destroy();
    if (!window.Chart) return;
    const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
    const mk = (id, cfg) => { const c = document.getElementById(id); if (c) charts.push(new Chart(c, cfg)); };
    mk('chDaily', {
      type: 'bar',
      data: { labels: A.daily.map((d) => +d.date.slice(8)), datasets: [
        { label: 'Tele-remote', data: A.daily.map((d) => d.tr), backgroundColor: TR, borderRadius: 4, stack: 's' },
        { label: 'RCC', data: A.daily.map((d) => d.rcc), backgroundColor: RCC, borderRadius: 4, stack: 's' }] },
      options: Object.assign({}, base, { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, title: { display: true, text: 'hours' } } },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { title: (i) => dShort(A.daily[i[0].dataIndex].date) } } } })
    });
    const act = A.perMachine.filter((p) => p.machine.active !== false);
    mk('chMach', {
      type: 'bar',
      data: { labels: act.map((p) => p.machine.name), datasets: [
        { label: 'Tele-remote', data: act.map((p) => p.tr), backgroundColor: TR, borderRadius: 4 },
        { label: 'RCC', data: act.map((p) => p.rcc), backgroundColor: RCC, borderRadius: 4 }] },
      options: Object.assign({}, base, { indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true, grid: { display: false } } }, plugins: { legend: { display: true, position: 'bottom' } } })
    });
    const pie = (id, groups, title) => mk(id, {
      type: 'doughnut',
      data: { labels: groups.map((g) => g.name), datasets: [{ data: groups.map((g) => Core.r2(g.tr + g.rcc)), backgroundColor: ['#A08C64', '#5b8cff', '#3ecf8e', '#e07a5f', '#9b7ede', '#2ab7ca'], borderWidth: 0 }] },
      options: Object.assign({}, base, { cutout: '64%', plugins: { legend: { display: true, position: 'bottom' }, title: { display: true, text: title, color: '#dfe5ea' } } })
    });
    pie('chShift', A.byShift, 'By shift');
    pie('chHut', A.byTelehut, 'By telehut');
  }

  function exportCsv(A) {
    const rows = [['Date', 'Shift', 'Machine', 'Telehut', 'Operator', 'TR start', 'TR end', 'TR hrs', 'RCC start', 'RCC end', 'RCC hrs', 'Total hrs', 'Check', 'Remarks', 'Logged by']];
    A.rows.forEach((r) => rows.push([r.date, r.shift, App.machineName(r.machineId), r.telehut, r.operator, r.trStart, r.trEnd, r.trHrs, r.rccStart, r.rccEnd, r.rccHrs, r.total,
      r.needsCheck ? r.issues.concat(r.warnings).join('; ') : 'OK', r.remarks, r.createdByName]));
    UI.downloadCSV('machine-hours_' + App.site.name.replace(/[^\w-]+/g, '_') + '_' + A.month + '.csv', rows);
  }

  function destroy() { charts.forEach((c) => c.destroy()); charts = []; }

  Views.dashboard = {
    render,
    destroy,
    update(ev) {
      // chat traffic doesn't change the dashboard
      if (ev && ev.col === 'messages') return true;
      return false;
    }
  };
})();
