/* Superuser area: users & roles, app settings, audit log, data source (file / SharePoint). */
(function () {
  'use strict';
  const { icon, esc, $, $$, toast, modal, confirmBox, dt, ago } = UI;
  const Views = (window.Views = window.Views || {});
  const SUBS = [['users', 'Users & roles'], ['settings', 'App settings'], ['audit', 'Audit log'], ['storage', 'Data source']];

  const SETTINGS = [
    ['allowUserSiteCreate', 'bool', 'Regular users can create mine sites', 'Off: only superusers create sites and load the sample site.'],
    ['allowUserListEdit', 'bool', 'Regular users can edit operator & telehut lists', 'Add or remove names in Site setup.'],
    ['allowUserMaintCreate', 'bool', 'Regular users can schedule maintenance', 'Everyone can always mark maintenance as complete.'],
    ['allowUserMaintEdit', 'bool', 'Regular users can edit and delete maintenance schedules', 'Off: only superusers change or remove schedules.'],
    ['entryEditHours', 'num', 'Hours a user can edit or delete their own shift rows', 'After this, only superusers can change the row. 0 = never.']
  ];
  const ALWAYS = [
    'Change site settings (name, shifts, max hours, warning windows, cover photo) and delete sites',
    'Add, edit or delete machines and their opening hour-meter readings',
    'Edit or delete other people’s shift rows (and own rows after the edit window)',
    'Delete maintenance history',
    'Post critical or pinned announcements; delete other people’s announcements and chat messages',
    'Add and remove superusers, reset superuser passwords, disable users',
    'Change these app settings, view the audit log, run SharePoint sync'
  ];

  function head(sub) {
    return '<div class="view-head"><div><h2>' + icon('shield') + ' Superuser</h2><div class="sub">Critical settings and changes — only superusers see this area.</div></div>' +
      '<div class="head-actions"><div class="subtabs">' + SUBS.map(([k, l]) => '<button data-sub="' + k + '" class="' + (sub === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div></div>';
  }

  function codeModal(email, code, why) {
    modal({
      title: 'One-time setup code', footer: '<button class="btn primary" data-x>Done</button>',
      body: '<p style="margin-top:0">' + esc(why) + '</p><div class="code-big" data-code>' + esc(code) + '</div>' +
        '<div class="row" style="justify-content:center"><button class="btn sm" data-copy>' + icon('file') + ' Copy</button></div>' +
        '<ol class="hint" style="padding-left:18px;line-height:1.7"><li>Give this code to <b>' + esc(email) + '</b> (it was also emailed if email is set up).</li>' +
        '<li>They sign in with that email, choose “I have a one-time setup code”, enter it and create a password.</li><li>The code works once and expires in 7 days. It is not shown again.</li></ol>',
      onMount: (ov) => {
        $('[data-copy]', ov).addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch (e) { toast('Select the code and copy it', 'warn'); }
        });
      }
    });
  }

  /* ---------------- users & roles ---------------- */
  async function renderUsers(wrap) {
    if (API.mode !== 'server') {
      wrap.insertAdjacentHTML('beforeend', '<div class="card"><div class="empty">' + icon('shield') + '<div>Managing superusers needs the server (<span class="kbd">node server.js</span>). In demo mode the owner email (' + esc(Core.DEFAULT_OWNERS.join(', ')) + ') is a superuser without a password.</div></div></div>');
      return;
    }
    const box = UI.el('<div class="stack"><div class="card"><div class="empty"><div class="spinner" style="margin:auto"></div></div></div></div>');
    wrap.appendChild(box);
    let data;
    try { data = await API.get('admin/users'); } catch (e) { box.innerHTML = '<div class="card"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
    const me = App.S.user;
    const roleTag = (u) => u.role === 'owner' ? '<span class="pill gold">' + icon('star') + ' Owner</span>' : u.role === 'superuser' ? '<span class="pill info">' + icon('shield') + ' Superuser</span>' : '<span class="pill">User</span>';
    const list = data.users.slice().sort((a, b) => ({ owner: 0, superuser: 1, user: 2 }[a.role] - { owner: 0, superuser: 1, user: 2 }[b.role]) || String(a.name).localeCompare(b.name));
    box.innerHTML =
      '<div class="card"><div class="card-h"><h3>' + icon('plus') + 'Add a superuser</h3></div>' +
      '<form class="row" data-add><input class="inp" name="email" type="email" required placeholder="name@company.com" style="flex:1;min-width:220px"><button class="btn primary">' + icon('shield') + ' Make superuser</button></form>' +
      '<p class="hint" style="margin-bottom:0">They do not need to have signed in yet. You get a one-time setup code to give them; they use it to create their superuser password.</p></div>' +
      '<div class="card"><div class="card-h"><h3>' + icon('users') + 'People <span class="pill">' + list.length + '</span></h3><div class="hint">Owners come from the server setting <span class="kbd">SUPERUSER_EMAILS</span>: ' + esc(data.owners.join(', ')) + '</div></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map((u) => {
        const isMe = u.email === me.email;
        const acts = [];
        if (u.role === 'user' && u.id) acts.push('<button class="btn sm" data-promote="' + esc(u.email) + '">' + icon('shield') + ' Make superuser</button>');
        if (u.role === 'superuser') acts.push('<button class="btn sm danger" data-demote="' + esc(u.email) + '">Remove superuser</button>');
        if (u.role !== 'user' && (u.role !== 'owner' || me.isOwner)) acts.push('<button class="btn sm" data-reset="' + esc(u.email) + '">' + icon('refresh') + ' ' + (u.hasPassword ? 'Reset password' : 'New setup code') + '</button>');
        if (u.id && u.role !== 'owner' && !isMe) acts.push('<button class="btn sm ghost" data-disable="' + u.id + '" data-on="' + (u.disabled ? '0' : '1') + '">' + (u.disabled ? 'Enable' : 'Disable') + '</button>');
        if (u.id && !isMe) acts.push('<button class="btn sm ghost" data-signout="' + u.id + '" title="End all their sessions">' + icon('logout') + '</button>');
        return '<tr class="' + (u.disabled ? 'inactive' : '') + '"><td class="strong">' + esc(u.name) + (isMe ? ' <span class="faint">(you)</span>' : '') + '</td><td>' + esc(u.email) + '</td><td>' + roleTag(u) + '</td>' +
          '<td>' + (u.role === 'user' ? '<span class="faint">not needed</span>' : u.hasPassword ? '<span class="pill ok">set</span>' : '<span class="pill soon">setup pending</span>') + '</td>' +
          '<td>' + (u.lastSeen ? esc(ago(u.lastSeen)) : '<span class="faint">–</span>') + '</td><td>' + (u.disabled ? '<span class="pill bad">disabled</span>' : '<span class="pill ok">active</span>') + '</td>' +
          '<td class="acts" style="opacity:1"><div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">' + acts.join('') + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    const reload = () => { const w = box.parentElement; box.remove(); renderUsers(w); };
    $('[data-add]', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = e.target.elements.email.value.trim();
      try {
        const r = await API.post('admin/superusers', { email });
        if (r.code) codeModal(r.email, r.code, r.email + ' is now a superuser.'); else toast(r.email + ' is now a superuser');
        reload();
      } catch (er) { toast(er.message, 'err'); }
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.promote) {
          if (!(await confirmBox('Make ' + b.dataset.promote + ' a superuser? They will be signed out and need a setup code to create a password.', { okText: 'Make superuser' }))) return;
          const r = await API.post('admin/superusers', { email: b.dataset.promote });
          if (r.code) codeModal(r.email, r.code, r.email + ' is now a superuser.');
          reload();
        }
        if (b.dataset.demote) {
          if (!(await confirmBox('Remove superuser rights from ' + b.dataset.demote + '? Their password is deleted and they are signed out.', { danger: true, okText: 'Remove' }))) return;
          await API.del('admin/superusers/' + encodeURIComponent(b.dataset.demote)); toast('Superuser removed'); reload();
        }
        if (b.dataset.reset) {
          const self = b.dataset.reset === me.email;
          if (!(await confirmBox((self ? 'Reset your own password? You will need the new code to sign in next time.' : 'Reset the password of ' + b.dataset.reset + '? They are signed out and need the new code.'), { danger: true, okText: 'Reset' }))) return;
          const r = await API.post('admin/superusers/' + encodeURIComponent(b.dataset.reset) + '/reset');
          codeModal(r.email, r.code, 'Password reset for ' + r.email + '.'); reload();
        }
        if (b.dataset.disable) {
          const on = b.dataset.on === '1';
          if (on && !(await confirmBox('Disable this user? They are signed out and cannot sign in until enabled again.', { danger: true, okText: 'Disable' }))) return;
          await API.post('admin/users/' + b.dataset.disable + '/disable', { disabled: on }); toast(on ? 'User disabled' : 'User enabled'); reload();
        }
        if (b.dataset.signout) { await API.post('admin/users/' + b.dataset.signout + '/signout'); toast('Signed out everywhere'); reload(); }
      } catch (er) { toast(er.message, 'err'); }
    });
  }

  /* ---------------- settings ---------------- */
  async function renderSettings(wrap) {
    let st;
    try { st = await API.get('admin/settings'); } catch (e) { wrap.insertAdjacentHTML('beforeend', '<div class="card"><div class="empty">' + esc(e.message) + '</div></div>'); return; }
    wrap.insertAdjacentHTML('beforeend',
      '<div class="grid g-2"><form class="card" data-settings><div class="card-h"><h3>' + icon('settings') + 'What regular users may do</h3></div><div class="stack" style="gap:14px">' +
      SETTINGS.map(([k, t, label, hint]) => t === 'bool'
        ? '<label class="toggle-row"><span><b>' + esc(label) + '</b><br><span class="hint">' + esc(hint) + '</span></span><input type="checkbox" class="switch" name="' + k + '" ' + (st[k] ? 'checked' : '') + '></label>'
        : '<label class="toggle-row"><span><b>' + esc(label) + '</b><br><span class="hint">' + esc(hint) + '</span></span><input class="inp" type="number" min="0" step="1" name="' + k + '" value="' + esc(st[k]) + '" style="width:100px"></label>').join('') +
      '</div><div class="row mt" style="justify-content:flex-end"><button class="btn primary">' + icon('check') + ' Save settings</button></div></form>' +
      '<div class="card"><div class="card-h"><h3>' + icon('shield') + 'Always superuser-only</h3></div><ul class="perm-list">' + ALWAYS.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '<p class="hint">Every one of these actions is written to the audit log. The server checks these rules on every request, so hiding a button is not the only protection.</p></div></div>');
    $('[data-settings]', wrap).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { App.S.settings = await API.put('admin/settings', UI.formData(e.target)); toast('Settings saved'); }
      catch (er) { toast(er.message, 'err'); }
    });
  }

  /* ---------------- audit ---------------- */
  async function renderAudit(wrap) {
    let rows;
    try { rows = await API.get('admin/audit'); } catch (e) { wrap.insertAdjacentHTML('beforeend', '<div class="card"><div class="empty">' + esc(e.message) + '</div></div>'); return; }
    wrap.insertAdjacentHTML('beforeend',
      '<div class="card"><div class="card-h"><h3>' + icon('file') + 'Audit log <span class="pill">' + rows.length + '</span></h3><div class="row"><input class="inp" data-q placeholder="Filter…" style="width:220px"><button class="btn sm" data-csv>' + icon('download') + ' CSV</button></div></div><div data-t></div></div>');
    const draw = () => {
      const q = $('[data-q]', wrap).value.toLowerCase();
      const r = rows.filter((a) => !q || [a.action, a.userName, a.userEmail, a.siteName, a.details].join(' ').toLowerCase().includes(q));
      $('[data-t]', wrap).innerHTML = r.length ? '<div class="tbl-wrap" style="max-height:70vh"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Site</th><th>Details</th></tr></thead><tbody>' +
        r.map((a) => '<tr><td>' + esc(dt(a.at)) + '</td><td>' + esc(a.userName || '') + '<br><span class="faint">' + esc(a.userEmail || '') + '</span></td><td class="strong">' + esc(a.action) + '</td><td>' + esc(a.siteName || '–') + '</td><td class="wrap">' + esc(a.details || '') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">No entries</div>';
      return r;
    };
    let shown = draw();
    $('[data-q]', wrap).addEventListener('input', UI.debounce(() => { shown = draw(); }, 150));
    $('[data-csv]', wrap).addEventListener('click', () => UI.downloadCSV('audit-log.csv', [['When (UTC)', 'User', 'Email', 'Action', 'Site', 'Details']].concat(shown.map((a) => [new Date(a.at).toISOString(), a.userName, a.userEmail, a.action, a.siteName, a.details]))));
  }

  /* ---------------- storage ---------------- */
  const tenantGuess = (u) => { try { const m = new URL(u).hostname.toLowerCase().match(/^([a-z0-9-]+?)(-my)?\.sharepoint\.com$/); return m ? m[1] + '.onmicrosoft.com' : ''; } catch (e) { return ''; } };
  const IT_REQUEST = (site) => 'Hello IT,\n\nPlease give the Machine Hours Portal access to our SharePoint site so it can store its data there.\n\n' +
    '1. Create an app registration in Entra ID called "Machine Hours Portal".\n' +
    '2. Add the Microsoft Graph APPLICATION permission "Sites.Selected" and grant admin consent.\n' +
    '3. Give the app "Write" access to this site only (or "Manage" if the portal should create its lists itself):\n   ' + (site || 'https://<tenant>.sharepoint.com/sites/<site>') + '\n' +
    '   (PowerShell: Grant-PnPAzureADAppSitePermission -AppId <client id> -DisplayName "Machine Hours Portal" -Permissions Write -Site <site url>)\n' +
    '4. Create a client secret and send me: the Client (application) ID and the client secret (and the Tenant ID).\n\n' +
    'The portal only uses this one site (12 lists starting with MHP_ and one folder for site photos). Passwords and sessions stay on the portal server.\n\nThank you';

  function stepsHtml(steps) {
    return '<div class="steps">' + steps.map((s) => '<div class="step ' + (s.ok ? 'ok' : 'bad') + '">' + icon(s.ok ? 'check' : 'x') + '<div><b>' + esc(s.label) + '</b>' + (s.info ? '<div class="info">' + esc(s.info) + '</div>' : '') + '</div></div>').join('') + '</div>';
  }

  function connectForm(box, st) {
    const c = st.config || {};
    box.insertAdjacentHTML('beforeend',
      '<div class="card" data-spform><div class="card-h"><h3>' + icon('globe') + (st.mode === 'sharepoint' ? 'Change SharePoint connection' : 'Connect to SharePoint') + '</h3>' +
      '<button class="btn sm" data-itmail>' + icon('mail') + ' Copy request for IT</button></div>' +
      '<ol class="howto">' +
      '<li><div><b>Get access from IT (once).</b> Click <i>Copy request for IT</i>, paste it into an email to IT. They send back a <b>Client ID</b> and a <b>Client secret</b>.</div></li>' +
      '<li><div><b>Paste the SharePoint site link and the two values from IT below.</b></div></li>' +
      '<li><div><b>Click Test, then Connect.</b> Your data is copied to SharePoint and everyone’s app reloads automatically.</div></li></ol>' +
      '<div class="form-grid two mt">' +
      '<label class="field full"><span>SharePoint site link</span><input class="inp" name="siteUrl" placeholder="https://sandvik.sharepoint.com/sites/MachineHours" value="' + esc(c.siteUrl || '') + '"></label>' +
      '<label class="field"><span>Client ID (from IT)</span><input class="inp" name="clientId" placeholder="00000000-0000-0000-0000-000000000000" value="' + esc(c.clientId || '') + '"></label>' +
      '<label class="field"><span>Client secret (from IT)</span><input class="inp" type="password" name="clientSecret" autocomplete="off" placeholder="' + (c.secretSet ? '•••••• (saved — leave empty to keep)' : '') + '"></label>' +
      '</div>' +
      '<details class="mt"><summary class="hint" style="cursor:pointer">Advanced</summary><div class="form-grid two mt">' +
      '<label class="field"><span>Tenant (worked out from the link)</span><input class="inp" name="tenantId" data-tenant placeholder="' + esc(tenantGuess(c.siteUrl) || 'auto') + '" value="' + esc(c.tenantId && c.tenantId !== tenantGuess(c.siteUrl) ? c.tenantId : '') + '"></label>' +
      '<label class="field"><span>List name prefix</span><input class="inp" name="prefix" value="' + esc(c.prefix != null ? c.prefix : 'MHP_') + '"></label></div></details>' +
      '<label class="check mt"><input type="checkbox" name="createLists" checked> Create the lists for me if they don’t exist <span class="hint">(needs “Manage” on the site — otherwise a site owner runs the <a href="#" data-ps1>PowerShell script</a>)</span></label>' +
      '<div class="row mt" style="justify-content:flex-end"><button class="btn" data-test>' + icon('check') + ' Test connection</button><button class="btn primary" data-connect>' + icon('globe') + ' Connect</button></div>' +
      '<div data-result></div></div>');
    const f = $('[data-spform]', box);
    const site = $('[name=siteUrl]', f);
    site.addEventListener('input', () => { $('[data-tenant]', f).placeholder = tenantGuess(site.value) || 'enter your tenant ID'; });
    const values = () => UI.formData(f);
    $('[data-itmail]', f).addEventListener('click', async () => {
      const text = IT_REQUEST(site.value.trim());
      try { await navigator.clipboard.writeText(text); toast('Request copied — paste it into an email to IT'); }
      catch (e) { modal({ title: 'Request for IT', footer: '<button class="btn" data-x>Close</button>', body: '<textarea class="inp" rows="14" style="width:100%">' + esc(text) + '</textarea>' }); }
    });
    $('[data-ps1]', f).addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const r = await fetch('api/admin/storage/script', { headers: { Authorization: 'Bearer ' + API.token } });
        const blob = new Blob([await r.text()], { type: 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'create-lists.ps1'; a.click();
      } catch (er) { toast(er.message, 'err'); }
    });
    const res = $('[data-result]', f);
    const run = async (what) => {
      const btns = $$('[data-test],[data-connect]', f); btns.forEach((b) => { b.disabled = true; });
      res.innerHTML = '<div class="row mt"><div class="spinner" style="width:22px;height:22px;border-width:2px"></div><span class="muted">' + (what === 'test' ? 'Testing…' : 'Connecting and copying your data… this can take a minute') + '</span></div>';
      try {
        const r = await API.post('admin/storage/' + what, values());
        res.innerHTML = stepsHtml(r.steps || []) + (r.ok ? '<div class="demo-note" style="color:var(--ok);border-color:rgba(62,207,142,.4);background:rgba(62,207,142,.08)">' +
          (what === 'test' ? 'Everything works. ' + (r.existing ? '<b>SharePoint already has ' + r.existing + ' records</b> — after connecting the app will use the SharePoint data (your current data is kept as a backup file).' : 'Click <b>Connect</b> to copy your data to SharePoint.') :
            'Connected! ' + (r.migrated != null ? r.migrated + ' records copied to SharePoint.' : r.loaded + ' records loaded from SharePoint.') + ' Reloading the app…') + '</div>'
          : '<div class="demo-note">' + esc(r.error || 'Something went wrong') + '</div>');
        return r;
      } catch (er) { res.innerHTML = '<div class="demo-note">' + esc(er.message) + '</div>'; return null; }
      finally { btns.forEach((b) => { b.disabled = false; }); }
    };
    $('[data-test]', f).addEventListener('click', () => run('test'));
    $('[data-connect]', f).addEventListener('click', async () => {
      if (!(await confirmBox('Switch the data source to SharePoint? Everyone using the app will see it reload. Your current data is backed up first.', { okText: 'Connect' }))) return;
      run('connect');
    });
  }

  async function renderStorage(wrap) {
    if (API.mode !== 'server') {
      wrap.insertAdjacentHTML('beforeend', '<div class="card"><div class="empty">' + icon('cpu') + '<div>Demo mode — data is stored in this browser only. Start the server (start.bat) to connect SharePoint.</div></div></div>');
      return;
    }
    const box = UI.el('<div class="stack"></div>');
    wrap.appendChild(box);
    const draw = async () => {
      let st;
      try { st = await API.get('admin/storage'); } catch (e) { box.innerHTML = '<div class="card"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
      const spMode = st.mode === 'sharepoint', pgMode = st.mode === 'postgres';
      const fromEnv = st.config && st.config.source === 'env';
      if (pgMode) {
        box.innerHTML =
          '<div class="grid g-kpi">' +
          '<div class="card kpi" style="--c:var(--sv-gold)"><div class="l">' + icon('cpu') + 'Data source</div><div class="v" style="font-size:22px">PostgreSQL</div><div class="s" style="word-break:break-all">' + esc(st.database || '') + '</div></div>' +
          '<div class="card kpi" style="--c:' + (st.connected ? 'var(--ok)' : 'var(--bad)') + '"><div class="l">Connection</div><div class="v" style="font-size:22px">' + (st.connected ? 'Connected' : 'Not connected') + '</div><div class="s">' + (st.connected ? 'Working normally' : 'Changes are kept on this server until the database answers') + '</div></div>' +
          '<div class="card kpi"><div class="l">Last saved</div><div class="v" style="font-size:18px">' + (st.lastSave ? esc(ago(Date.parse(st.lastSave))) : 'not since start') + '</div><div class="s">to the database</div></div>' +
          '</div>' +
          (st.lastError ? '<div class="card ann critical"><div class="ico">' + icon('alert') + '</div><div><h4>Last error</h4><p>' + esc(st.lastError) + '</p></div></div>' : '') +
          '<div class="card"><p class="muted" style="margin:0">All data is stored in the PostgreSQL database set by <span class="kbd">DATABASE_URL</span> in the server environment, so it survives restarts and redeploys. ' +
          'The server keeps a working copy in <span class="kbd">' + esc(st.cacheFile || '') + '</span>. To change the database, change <span class="kbd">DATABASE_URL</span> where the server is hosted.</p></div>';
        return;
      }
      box.innerHTML =
        '<div class="grid g-kpi">' +
        '<div class="card kpi" style="--c:var(--sv-gold)"><div class="l">' + icon('cpu') + 'Data source</div><div class="v" style="font-size:22px">' + (spMode ? 'SharePoint' : 'This server (file)') + '</div><div class="s" style="word-break:break-all">' + esc(spMode ? st.siteUrl || '' : st.file || '') + '</div></div>' +
        (spMode ? '<div class="card kpi ' + (st.connected ? 'good' : 'bad') + '" style="--c:' + (st.connected ? 'var(--ok)' : 'var(--bad)') + '"><div class="l">Connection</div><div class="v" style="font-size:22px">' + (st.connected ? 'Connected' : 'Offline') + '</div><div class="s">' + (st.connected ? 'Working normally' : 'Running from the server copy — changes are sent when SharePoint is back') + '</div></div>' +
          '<div class="card kpi ' + (st.pending ? 'warn' : '') + '" style="--c:var(--warn)"><div class="l">Waiting to send</div><div class="v">' + (st.pending || 0) + '</div><div class="s">changes not yet in SharePoint</div></div>' +
          '<div class="card kpi"><div class="l">Last sync</div><div class="v" style="font-size:18px">' + (st.lastFlush ? esc(ago(st.lastFlush)) : '–') + '</div><div class="s">last read: ' + (st.lastPull ? esc(ago(st.lastPull)) : '–') + '</div></div>' : '') +
        '</div>' +
        (!spMode ? '<div class="card ann important"><div class="ico">' + icon('alert') + '</div><div><h4>Data is kept in a file on this server</h4><p>On hosting services such as Render, this file is wiped on every restart or redeploy. ' +
          'For permanent storage, add <span class="kbd">DATABASE_URL</span> (PostgreSQL) to the server environment, or connect SharePoint below.</p></div></div>' : '') +
        (st.lastError ? '<div class="card ann critical"><div class="ico">' + icon('alert') + '</div><div><h4>Last error' + (st.lastErrorAt ? ' · ' + esc(ago(st.lastErrorAt)) : '') + '</h4><p>' + esc(st.lastError) + '</p></div></div>' : '') +
        (spMode ? '<div class="card"><div class="card-h"><h3>' + icon('refresh') + 'SharePoint</h3><div class="row"><button class="btn" data-check>' + icon('check') + ' Check lists</button><button class="btn primary" data-sync>' + icon('refresh') + ' Sync now</button>' +
          (fromEnv ? '' : '<button class="btn danger" data-disconnect>' + icon('x') + ' Disconnect</button>') + '</div></div>' +
          '<p class="muted" style="margin-top:0">Lists use the prefix <span class="kbd">' + esc(st.prefix || '') + '</span>. Changes are sent within seconds; edits made directly in SharePoint are read every few minutes (or now with “Sync now”).' + (fromEnv ? ' This connection is set in the server’s <span class="kbd">.env</span> file.' : '') + '</p><div data-report></div></div>' : '');
      if (!fromEnv) connectForm(box, st);
      const sync = $('[data-sync]', box), check = $('[data-check]', box), disc = $('[data-disconnect]', box);
      if (sync) sync.addEventListener('click', async () => {
        sync.disabled = true;
        try { const r = await API.post('admin/storage/sync'); toast(r.changed ? 'Synced — changes from SharePoint loaded' : 'Synced — no new changes'); }
        catch (er) { toast(er.message, 'err'); }
        draw();
      });
      if (check) check.addEventListener('click', async () => {
        check.disabled = true;
        try {
          const r = await API.post('admin/storage/check');
          $('[data-report]', box).innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>List</th><th>Status</th></tr></thead><tbody>' +
            r.report.map((x) => '<tr><td>' + esc(x.list) + '</td><td class="' + (/MISSING/.test(x.action) ? 'bad' : '') + '">' + esc(x.action) + '</td></tr>').join('') + '</tbody></table></div>';
        } catch (er) { toast(er.message, 'err'); }
        check.disabled = false;
      });
      if (disc) disc.addEventListener('click', async () => {
        if (!(await confirmBox('Stop using SharePoint? The app keeps working from the server file with all current data. The SharePoint lists are left untouched.', { danger: true, okText: 'Disconnect' }))) return;
        try { await API.post('admin/storage/disconnect'); toast('Disconnected — reloading…'); } catch (er) { toast(er.message, 'err'); }
      });
    };
    draw();
  }

  Views.admin = {
    render(wrap, r) {
      if (!App.isSuper()) { wrap.innerHTML = '<div class="card"><div class="empty">' + icon('shield') + '<div>Superusers only.</div></div></div>'; return; }
      const sub = SUBS.some(([k]) => k === r.sub) ? r.sub : 'users';
      wrap.innerHTML = head(sub);
      $$('.subtabs [data-sub]', wrap).forEach((b) => b.addEventListener('click', () => App.go('admin', b.dataset.sub)));
      ({ users: renderUsers, settings: renderSettings, audit: renderAudit, storage: renderStorage })[sub](wrap);
    },
    update() { return true; } // admin pages load their own data; live data events don't redraw them
  };
})();
