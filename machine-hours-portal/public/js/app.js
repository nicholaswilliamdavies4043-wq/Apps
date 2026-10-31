/* App shell: state, routing, header/sidebar/tools, live events. */
(function () {
  'use strict';
  const { icon, esc, $, $$, el, toast, modal, avatar, ago } = UI;
  const Views = window.Views;

  const S = {
    user: null, sites: [], users: [], siteId: null, data: null, computed: null, meters: null,
    widgets: [], notifs: [], route: { tab: 'dashboard', sub: null, arg: null }, month: null
  };

  const BASE_NAV = [
    { tab: 'sites', label: 'Site Definition', icon: 'site', subs: [['list', 'All sites'], ['setup', 'Site setup']] },
    { tab: 'dashboard', label: 'Dashboard', icon: 'gauge' },
    { tab: 'fleet', label: 'Fleet Monitoring', icon: 'fleet', subs: [['overview', 'Overview'], ['log', 'Shift log'], ['buckets', 'Buckets'], ['maintenance', 'Maintenance']] },
    { tab: 'inventory', label: 'Inventory', icon: 'box', subs: [['items', 'Items'], ['moves', 'Movements']] },
    { tab: 'chat', label: 'Chat', icon: 'chat', subs: [['general', 'Channels'], ['announcements', 'Announcements']] }
  ];
  const ADMIN_NAV = { tab: 'admin', label: 'Superuser', icon: 'shield', subs: [['users', 'Users & roles'], ['settings', 'App settings'], ['audit', 'Audit log'], ['storage', 'Data source']] };
  const navList = () => (S.user && S.user.isSuper ? BASE_NAV.concat([ADMIN_NAV]) : BASE_NAV);

  const App = {
    S,
    get site() { return S.data && S.data.site; },
    machine(id) { return S.data && S.data.machines.find((m) => m.id === id); },
    machineName(id) { const m = App.machine(id); return m ? m.name : '(removed)'; },
    userName(id) { const u = S.users.find((x) => x.id === id); return u ? u.name : ''; },

    /* ---------------- permissions (the server enforces the same rules) ---------------- */
    isSuper() { return !!(S.user && S.user.isSuper); },
    can(what) {
      if (App.isSuper()) return true;
      const st = S.settings || {};
      return { createSite: st.allowUserSiteCreate, listEdit: st.allowUserListEdit, maintEdit: st.allowUserMaintEdit, maintCreate: st.allowUserMaintCreate !== false, invEdit: st.allowUserInventoryEdit !== false, super: false }[what] || false;
    },
    canEditEntry(e) {
      if (App.isSuper()) return true;
      const hrs = Number((S.settings || {}).entryEditHours) || 0;
      return e.createdBy === S.user.id && Date.now() - (e.createdAt || 0) <= hrs * 3600000;
    },
    /** hide / disable elements marked data-perm, data-perm-not, data-readonly */
    applyPerms(root) {
      root = root || document;
      $$('[data-perm]', root).forEach((n) => { if (!App.can(n.dataset.perm)) n.remove(); });
      $$('[data-perm-not]', root).forEach((n) => { if (App.can(n.dataset.permNot)) n.remove(); });
      $$('[data-readonly]', root).forEach((n) => {
        if (App.can(n.dataset.readonly)) return;
        $$('input, select, textarea', n).forEach((i) => { i.disabled = true; });
        $$('button, label.btn', n).forEach((b) => { b.disabled = true; b.style.pointerEvents = 'none'; b.style.opacity = '.5'; });
      });
    },

    /* ---------------- routing ---------------- */
    go(tab, sub, arg) {
      const h = '#/' + [tab, sub, arg].filter(Boolean).join('/');
      if (location.hash !== h) location.hash = h; else App.render();
    },
    parseHash() {
      const [tab, sub, arg] = location.hash.replace(/^#\/?/, '').split('/');
      S.route = { tab: navList().some((n) => n.tab === tab) ? tab : 'dashboard', sub: sub || null, arg: arg ? decodeURIComponent(arg) : null };
    },

    /* ---------------- data ---------------- */
    recompute() {
      if (!S.data) { S.computed = null; S.meters = null; return; }
      S.computed = Core.computeSite(S.data);
      S.meters = Core.meters(S.data, S.computed);
    },
    async loadSite(id) {
      S.siteId = id;
      if (!id) { S.data = null; App.recompute(); App.applyBg(); return; }
      API.store.set('mhp.site', id);
      try {
        S.data = await API.get('sites/' + id + '/data');
      } catch (e) { toast(e.message, 'err'); S.data = null; }
      if (S.data) {
        const cur = new Date();
        S.month = S.month || (cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0'));
      }
      App.recompute();
      App.applyBg();
    },
    applyBg() {
      const s = App.site;
      const bg = $('#bg');
      if (s && s.coverImage) bg.style.setProperty('--site-bg', 'url("' + s.coverImage + '")');
      else bg.style.removeProperty('--site-bg');
    },
    async switchSite(id) {
      await App.loadSite(id);
      App.renderShell();
      App.render();
      if (App.site) toast('Switched to ' + App.site.name);
    },
    maintStatuses() {
      if (!S.data) return [];
      const now = Date.now();
      return S.data.maintenance.filter((m) => m.status !== 'done').map((m) => ({ m, st: Core.maintStatus(m, S.meters[m.machineId], S.data.site, now) }));
    },

    /* ---------------- chat read state ---------------- */
    readMap() { try { return JSON.parse(API.store.get('mhp.read.' + S.siteId) || '{}'); } catch (e) { return {}; } },
    markRead(ch) { const r = App.readMap(); r[ch] = Date.now(); API.store.set('mhp.read.' + S.siteId, JSON.stringify(r)); App.updateBadges(); },
    unread() {
      const out = { total: 0 };
      if (!S.data) return out;
      const r = App.readMap();
      for (const m of S.data.messages) {
        if (m.userId === S.user.id) continue;
        if (m.createdAt > (r[m.channel] || 0)) { out[m.channel] = (out[m.channel] || 0) + 1; out.total++; }
      }
      const a = S.data.announcements.filter((x) => x.userId !== S.user.id && x.createdAt > (r.announcements || 0)).length;
      if (a) { out.announcements = a; out.total += a; }
      return out;
    },

    /* ---------------- rendering ---------------- */
    renderSignIn() {
      document.body.classList.remove('widget-open', 'side-open');
      $('#app').innerHTML =
        '<div class="signin"><div class="card">' +
        '<div class="wordmark">SANDVIK</div>' +
        '<h1>Machine Hours Portal</h1><div class="muted">Tele-remote &amp; RCC hours, maintenance countdowns and fleet chat — per mine site.</div>' +
        '<form id="si"><label class="field"><span>Your name</span><input class="inp" name="name" autocomplete="name" required placeholder="e.g. Nicholas Davies"></label>' +
        '<label class="field"><span>Email (for notifications)</span><input class="inp" name="email" type="email" autocomplete="email" required placeholder="name@sandvik.com"></label>' +
        '<div class="su-box hidden" data-pwbox><div class="row" style="gap:8px">' + icon('shield') + '<b>Superuser sign-in</b></div>' +
        '<label class="field"><span>Password</span><input class="inp" name="password" type="password" autocomplete="current-password"></label>' +
        '<button type="button" class="btn sm ghost" data-havecode>I have a one-time setup code</button></div>' +
        '<div class="su-box hidden" data-setupbox><div class="row" style="gap:8px">' + icon('shield') + '<b>Set your superuser password</b></div>' +
        '<div class="hint">Enter the one-time setup code. The owner\'s first code is printed in the server window and saved in <span class="kbd">data/superuser-setup-codes.txt</span>; other superusers get theirs from the superuser who added them.</div>' +
        '<label class="field"><span>Setup code</span><input class="inp" name="code" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX" style="text-transform:uppercase;letter-spacing:.12em"></label>' +
        '<label class="field"><span>New password (10+ characters, letters and numbers)</span><input class="inp" name="newpw" type="password" autocomplete="new-password"></label>' +
        '<label class="field"><span>Repeat password</span><input class="inp" name="newpw2" type="password" autocomplete="new-password"></label></div>' +
        '<label class="check remember"><input type="checkbox" name="remember" ' + (API.store.get('mhp.remember') === '0' ? '' : 'checked') + '> Remember me for 30 days <span class="hint">(untick on shared computers)</span></label>' +
        '<button class="btn primary" type="submit">' + icon('right') + ' Continue</button></form>' +
        (API.mode === 'local' ? '<div class="demo-note"><b>Demo mode:</b> the server is not running, so data is stored in this browser only and is not shared with other users. Start the server with <span class="kbd">node server.js</span> for multi-user use.</div>' : '') +
        '<div class="hint mt">Regular users sign in with name and email only. Superusers also need their password. Your name is shown on log entries and chat messages.</div>' +
        '</div></div>';
      const form = $('#si'), pwbox = $('[data-pwbox]'), setupbox = $('[data-setupbox]');
      let mode = 'plain';
      const show = (m) => {
        mode = m;
        pwbox.classList.toggle('hidden', m !== 'password');
        setupbox.classList.toggle('hidden', m !== 'setup');
        const f = $(m === 'password' ? '[name=password]' : '[name=code]', form);
        if (m !== 'plain') setTimeout(() => f.focus(), 30);
      };
      $('[data-havecode]').addEventListener('click', () => show('setup'));
      form.elements.email.addEventListener('input', () => { if (mode !== 'plain') show('plain'); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = UI.formData(form);
        try {
          if (mode === 'setup') {
            if (f.newpw !== f.newpw2) throw new Error('The passwords do not match');
            await API.setup(f.name.trim(), f.email.trim(), f.code.trim(), f.newpw, f.remember);
          } else await API.signIn(f.name.trim(), f.email.trim(), mode === 'password' ? f.password : undefined, f.remember);
          API.store.set('mhp.remember', f.remember ? '1' : '0');
          await App.start();
        } catch (er) {
          if (er.data && er.data.needSetup) { if (mode !== 'setup') { show('setup'); toast(er.message, 'warn'); return; } }
          else if (er.data && er.data.needPassword) { if (mode !== 'password') { show('password'); toast(er.message, 'warn'); return; } }
          toast(er.message, 'err');
        }
      });
    },

    renderShell() {
      const s = App.site;
      $('#app').innerHTML =
        '<header class="topbar">' +
        '<button class="tool-btn menu-btn" data-act="menu" aria-label="Menu">' + icon('menu') + '</button>' +
        '<a class="brand" href="#/dashboard" aria-label="Home"><span class="wordmark">SANDVIK</span></a>' +
        '<div class="site-switch"><button class="site-btn" data-act="sites" aria-haspopup="true"><span class="dot" style="background:' + esc((s && s.color) || '#A08C64') + '"></span>' +
        '<span style="display:grid;line-height:1.1;text-align:left;min-width:0"><span class="lbl">Environment</span><span class="nm">' + esc(s ? s.name : 'Select a site') + '</span></span>' + icon('down') + '</button></div>' +
        '<div class="spacer"></div>' +
        '<button class="net-pill hidden" data-act="net" id="netPill"></button>' +
        '<div class="portal-title">MACHINE HOURS PORTAL</div><div class="vdiv"></div>' +
        (S.user.isSuper ? '<a class="su-chip" href="#/admin/users" title="Superuser mode">' + icon('shield') + '<span>SUPERUSER</span></a>' : '') +
        '<div style="position:relative"><button class="avatar-btn" data-act="profile" aria-label="Profile">' + avatar(S.user.name) + icon('down') + '</button></div>' +
        '</header>' +
        '<div class="side-scrim" data-act="menu"></div>' +
        '<aside class="sidebar" id="sidebar"></aside>' +
        '<div class="tools"><button class="tool-btn" data-act="quick" title="Log shift readings">' + icon('pencil') + '</button>' +
        '<button class="tool-btn" data-act="bell" title="Notifications">' + icon('bell') + '<span class="count hidden" id="bellCount"></span></button></div>' +
        '<main class="main" id="main"></main>' +
        '<button class="widget-tab" data-act="widget" aria-label="Open widgets">' + icon('left', 'chev') + '<span>WIDGET</span></button>' +
        '<aside class="widget-panel" id="widgetPanel" aria-label="Widgets"></aside>' +
        '<nav class="bottom-nav" id="bottomNav"></nav>';
      App.renderSidebar();
      Views.widgets.render($('#widgetPanel'));
      if (!App._bound) { $('#app').addEventListener('click', App.onShellClick); App._bound = true; }
    },

    renderSidebar() {
      const r = S.route;
      const openGroups = App._open || (App._open = { [r.tab]: true });
      $('#sidebar').innerHTML = navList().map((n) =>
        '<div class="nav-group ' + (openGroups[n.tab] ? 'open' : '') + '" data-group="' + n.tab + '">' +
        '<button class="nav-item ' + (r.tab === n.tab ? 'on' : '') + '" data-nav="' + n.tab + '">' + icon(n.icon) + '<span>' + n.label + '</span>' +
        '<span class="nav-badge hidden" data-badge="' + n.tab + '"></span>' +
        (n.subs ? '<span class="chev-wrap" data-toggle="' + n.tab + '" role="button" aria-label="Expand">' + icon('down', 'chev') + '</span>' : '') + '</button>' +
        (n.subs ? '<div class="nav-sub"><div>' + n.subs.map(([k, l]) =>
          '<button data-nav="' + n.tab + '" data-sub="' + k + '" class="' + (r.tab === n.tab && (r.sub || n.subs[0][0]) === k ? 'on' : '') + '">' + l +
          '<span class="sub-badge hidden" data-subbadge="' + n.tab + '-' + k + '"></span></button>').join('') + '</div></div>' : '') +
        '</div>').join('') +
        '<div class="side-foot">Pilot v' + Core.VERSION + '<br><span class="mode ' + (API.mode === 'server' ? 'live' : '') + '">' +
        (API.mode === 'server' ? '● Live — shared server' : '● Demo — this browser only') + '</span></div>';
      $('#bottomNav').innerHTML = navList().map((n) =>
        '<button data-nav="' + n.tab + '" class="' + (r.tab === n.tab ? 'on' : '') + '">' + icon(n.icon) + '<span>' + n.label.replace(' Definition', 's').replace(' Monitoring', '').replace('Superuser', 'Admin') + '</span><span class="nav-badge hidden" data-badge="' + n.tab + '"></span></button>').join('');
      App.updateBadges();
    },

    updateBadges() {
      if (!$('#sidebar')) return;
      const overdue = App.maintStatuses().filter((x) => x.st.status === 'overdue').length;
      const un = App.unread();
      const set = (sel, v) => $$(sel).forEach((b) => { b.textContent = v; b.classList.toggle('hidden', !v); });
      set('[data-badge="fleet"]', overdue || '');
      set('[data-subbadge="fleet-maintenance"]', overdue || '');
      set('[data-badge="chat"]', un.total || '');
      const lowStock = Views.inventory ? Views.inventory.lowCount() : 0;
      set('[data-badge="inventory"]', lowStock || '');
      set('[data-subbadge="inventory-items"]', lowStock || '');
      set('[data-subbadge="chat-general"]', (un.total - (un.announcements || 0)) || '');
      set('[data-subbadge="chat-announcements"]', un.announcements || '');
      const nUn = S.notifs.filter((n) => !n.read).length;
      const bc = $('#bellCount');
      if (bc) { bc.textContent = nUn > 99 ? '99+' : nUn; bc.classList.toggle('hidden', !nUn); }
      document.title = (nUn ? '(' + nUn + ') ' : '') + 'Machine Hours Portal · Sandvik';
    },

    render() {
      const main = $('#main');
      if (!main) return;
      if (App.current && App.current.destroy) App.current.destroy();
      App.parseHash();
      const r = S.route;
      App._open = App._open || {};
      App._open[r.tab] = true;
      App.renderSidebar();
      document.body.classList.remove('side-open');
      const v = Views[r.tab];
      App.current = v;
      main.innerHTML = '';
      const wrap = el('<div class="view"></div>');
      main.appendChild(wrap);
      if (r.tab !== 'sites' && r.tab !== 'admin' && !S.data) { Views.sites.noSite(wrap); App.applyPerms(wrap); return; }
      v.render(wrap, r);
      App.applyPerms(wrap);
      window.scrollTo(0, 0);
    },

    /** called after any data change */
    refresh: UI.debounce(function (ev) {
      App.updateBadges();
      Views.widgets.update();
      const v = App.current, main = $('#main');
      if (!v || !main) return;
      if (v.update && v.update(ev) !== false) return;
      const a = document.activeElement;
      const force = ev && ev.force;
      if (!force && a && main.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { App._pending = true; return; }
      if (!force && $('.overlay')) { App._pending = true; return; }
      const y = window.scrollY;
      const old = $('.view', main);
      if (!old) return;
      if (v.destroy) v.destroy();
      // fresh element so listeners bound by the view are not duplicated
      const wrap = el('<div class="view" style="animation:none"></div>');
      main.replaceChild(wrap, old);
      if (S.route.tab !== 'sites' && S.route.tab !== 'admin' && !S.data) Views.sites.noSite(wrap); else v.render(wrap, S.route);
      App.applyPerms(wrap);
      window.scrollTo(0, y);
    }, 120),

    /* ---------------- shell interactions ---------------- */
    onShellClick(e) {
      const t = e.target.closest('[data-act],[data-nav],[data-toggle]');
      if (!t) return;
      if (t.dataset.toggle && e.target.closest('.chev-wrap')) {
        e.stopPropagation();
        App._open[t.dataset.toggle] = !App._open[t.dataset.toggle];
        t.closest('.nav-group').classList.toggle('open');
        return;
      }
      if (t.dataset.nav) { App.go(t.dataset.nav, t.dataset.sub); return; }
      const a = t.dataset.act;
      if (a === 'menu') document.body.classList.toggle('side-open');
      if (a === 'widget') Views.widgets.toggle();
      if (a === 'sites') App.siteMenu(t);
      if (a === 'profile') App.profileMenu(t);
      if (a === 'bell') App.notifPanel();
      if (a === 'net') App.netModal();
      if (a === 'quick') { if (!S.data) return toast('Select or create a site first', 'warn'); Views.fleet.openEntryModal(); }
    },
    closePops() { $$('.dropdown').forEach((d) => d.remove()); },
    popup(anchor, html, cls) {
      const had = anchor.parentElement.querySelector('.dropdown');
      App.closePops();
      if (had) return null;
      const d = el('<div class="dropdown ' + (cls || '') + '">' + html + '</div>');
      anchor.parentElement.appendChild(d);
      setTimeout(() => document.addEventListener('click', function h(ev) { if (!d.contains(ev.target)) { d.remove(); document.removeEventListener('click', h); } }), 0);
      return d;
    },
    siteMenu(btn) {
      const d = App.popup(btn,
        '<div class="dd-head">Mine sites / environments</div>' +
        (S.sites.length ? S.sites.map((s) => '<button class="dd-item ' + (s.id === S.siteId ? 'on' : '') + '" data-site="' + s.id + '"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:' + esc(s.color || '#A08C64') + '"></span><span><b>' + esc(s.name) + '</b><br><small class="muted">' + esc([s.location, s.country].filter(Boolean).join(' · ') || '—') + '</small></span></button>').join('') : '<div class="dd-item muted">No sites yet</div>') +
        '<div class="dd-sep"></div><button class="dd-item" data-new>' + icon('plus') + ' New site</button><button class="dd-item" data-manage>' + icon('settings') + ' Manage sites</button>');
      if (!d) return;
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        App.closePops();
        if (b.dataset.site) App.switchSite(b.dataset.site);
        if ('new' in b.dataset) Views.sites.openSiteModal();
        if ('manage' in b.dataset) App.go('sites', 'list');
      });
    },
    profileMenu(btn) {
      const u = S.user;
      const d = App.popup(btn,
        '<div class="row" style="padding:10px 12px">' + avatar(u.name, 'sm') + '<div><b>' + esc(u.name) + '</b><br><small class="muted">' + esc(u.email) + '</small></div></div><div class="dd-sep"></div>' +
        '<div class="dd-item" style="cursor:default">' + icon('shield') + (u.isSuper ? '<span>Role: <b style="color:var(--sv-gold-l)">Superuser</b></span>' : '<span>Role: Regular user</span>') + '</div>' +
        '<label class="dd-item check"><input type="checkbox" data-mail ' + (u.notifyEmail ? 'checked' : '') + '> Email me notifications</label>' +
        '<button class="dd-item" data-edit>' + icon('user') + ' Change display name</button>' +
        '<button class="dd-item" data-phone>' + icon('wifi') + ' Use on phone or tablet</button>' +
        (S.user.isSuper && API.mode === 'server' ? '<button class="dd-item" data-pw>' + icon('shield') + ' Change superuser password</button>' : '') +
        (API.mode === 'local' ? '<button class="dd-item" data-reset>' + icon('refresh') + ' Reset demo data</button>' : '') +
        '<div class="dd-sep"></div><button class="dd-item" data-out>' + icon('logout') + ' Sign out</button>', 'right');
      if (!d) return;
      $('[data-mail]', d).addEventListener('change', async (e) => {
        try { S.user = await API.put('me', { notifyEmail: e.target.checked }); toast(e.target.checked ? 'Email notifications on' : 'Email notifications off'); }
        catch (er) { toast(er.message, 'err'); }
      });
      d.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        App.closePops();
        if ('out' in b.dataset) { await API.signOut(); App.renderSignIn(); }
        if ('pw' in b.dataset) {
          modal({
            title: 'Change superuser password',
            body: '<div class="stack"><label class="field"><span>Current password</span><input class="inp" type="password" name="current" autocomplete="current-password"></label>' +
              '<label class="field"><span>New password (10+ characters, letters and numbers)</span><input class="inp" type="password" name="password" autocomplete="new-password"></label>' +
              '<label class="field"><span>Repeat new password</span><input class="inp" type="password" name="again" autocomplete="new-password"></label></div>',
            onOk: async (ov) => {
              const f = UI.formData($('.modal-b', ov));
              if (f.password !== f.again) throw new Error('The new passwords do not match');
              await API.post('auth/password', { current: f.current, password: f.password });
              toast('Password changed — other sessions were signed out');
            }
          });
        }
        if ('reset' in b.dataset) {
          if (await UI.confirmBox('Delete all demo data stored in this browser?', { danger: true, okText: 'Reset' })) { API.resetLocal(); location.reload(); }
        }
        if ('phone' in b.dataset) App.phoneModal();
        if ('edit' in b.dataset) {
          modal({
            title: 'Display name', body: '<label class="field"><span>Name</span><input class="inp" name="name" value="' + esc(u.name) + '"></label>',
            onOk: async (ov) => { S.user = await API.put('me', { name: $('[name=name]', ov).value }); App.renderShell(); App.render(); toast('Name updated'); }
          });
        }
      });
    },
    async notifPanel() {
      const ex = $('.notif-pop');
      if (ex) { ex.remove(); return; }
      App.closePops();
      const ICON = { maintenance: 'wrench', announcement: 'megaphone', mention: 'chat' };
      const list = S.notifs;
      const d = el('<div class="dropdown notif-pop"><div class="row" style="justify-content:space-between;padding:6px 8px 10px"><b>Notifications</b><span class="row" style="gap:4px">' +
        '<button class="btn sm ghost" data-all>Mark all read</button><button class="btn sm ghost" data-clear>Clear</button></span></div>' +
        (list.length ? list.map((n) => '<div class="notif ' + (n.read ? '' : 'unread') + '" data-id="' + n.id + '"><div class="ico">' + icon(ICON[n.type] || 'bell') + '</div><div style="min-width:0">' +
          '<div class="t">' + esc(n.title) + '</div><div class="b">' + esc(n.body) + '</div><div class="ts">' + esc(ago(n.ts)) + (n.siteId !== S.siteId ? ' · ' + esc((S.sites.find((s) => s.id === n.siteId) || {}).name || '') : '') + '</div></div></div>').join('')
          : '<div class="empty">' + icon('bell') + '<div>You are all caught up</div></div>') + '</div>');
      document.body.appendChild(d);
      setTimeout(() => document.addEventListener('click', function h(ev) { if (!d.contains(ev.target) && !ev.target.closest('[data-act=bell]')) { d.remove(); document.removeEventListener('click', h); } }), 0);
      d.addEventListener('click', async (e) => {
        if (e.target.closest('[data-all]')) { await API.post('notifications/read'); S.notifs.forEach((n) => (n.read = true)); d.remove(); App.updateBadges(); return; }
        if (e.target.closest('[data-clear]')) { await API.post('notifications/clear'); S.notifs = []; d.remove(); App.updateBadges(); return; }
        const it = e.target.closest('.notif'); if (!it) return;
        const n = S.notifs.find((x) => x.id === it.dataset.id);
        d.remove();
        if (!n) return;
        if (!n.read) { n.read = true; API.post('notifications/read', { ids: [n.id] }).catch(() => {}); App.updateBadges(); }
        if (n.siteId && n.siteId !== S.siteId) await App.switchSite(n.siteId);
        if (n.link) App.go(n.link.tab, n.link.sub || n.link.channel);
      });
    },

    /* ---------------- live events ---------------- */
    onEvent(ev) {
      if (!S.user) return;
      if (ev.type === 'signedout') { App.renderSignIn(); return; }
      if (ev.type === 'settings') { S.settings = ev.item; App.refresh({ type: 'settings', force: true }); return; }
      if (ev.type === 'role') { if (ev.userId === S.user.id) { toast('Your access was changed by a superuser — please sign in again', 'warn'); App.resync(true); } return; }
      if (ev.type === 'resync') { App.resync(); return; }
      if (ev.type === 'storageFull') { toast('Browser storage is full — this change is not saved. Remove cover photos or run the server.', 'err'); return; }
      if (ev.type === 'offline') { App.updateNet(); toast("You're offline — you can keep working. Changes are saved on this device and sent when the connection is back.", 'warn'); return; }
      if (ev.type === 'online') { App.updateNet(); toast('Back online'); if (!API.outbox.length) App.resync(); return; }
      if (ev.type === 'outbox' || ev.type === 'syncing') { App.updateNet(ev.type === 'syncing'); return; }
      if (ev.type === 'synced') {
        App.updateNet();
        if (ev.sent) toast(ev.sent + ' offline change' + (ev.sent === 1 ? '' : 's') + ' sent');
        if (ev.problems) toast(ev.problems + ' offline change(s) could not be saved — tap the status pill for details', 'err');
        return;
      }
      if (ev.type === 'reload-app') { toast((ev.reason || 'The app was updated') + ' — reloading…', 'warn'); setTimeout(() => location.reload(), 1800); return; }
      if (ev.type === 'notify') {
        if (ev.userId !== S.user.id) return;
        if (S.notifs.some((n) => n.id === ev.item.id)) return;
        S.notifs.unshift(ev.item);
        toast(ev.item.title, ev.item.type === 'maintenance' ? 'warn' : 'ok');
        App.updateBadges();
        return;
      }
      if (ev.type === 'widgets') { if (ev.userId === S.user.id) Views.widgets.reload(); return; }
      if (ev.type === 'users') {
        const i = S.users.findIndex((u) => u.id === ev.item.id);
        if (i >= 0) S.users[i] = ev.item; else S.users.push(ev.item);
        return;
      }
      if (ev.type === 'sites') {
        if (ev.action === 'delete') {
          S.sites = S.sites.filter((s) => s.id !== ev.id);
          if (ev.id === S.siteId) { App.switchSite(S.sites[0] ? S.sites[0].id : null); return; }
        } else {
          const i = S.sites.findIndex((s) => s.id === ev.item.id);
          if (i >= 0) S.sites[i] = ev.item; else S.sites.push(ev.item);
          if (S.data && ev.item.id === S.siteId) { S.data.site = ev.item; App.applyBg(); App.recompute(); }
        }
        const nm = $('.site-btn .nm'); if (nm) nm.textContent = App.site ? App.site.name : 'Select a site';
        App.refresh(ev);
        return;
      }
      if (ev.type === 'reload' && ev.siteId === S.siteId) { App.loadSite(S.siteId).then(() => App.refresh(ev)); return; }
      if (ev.type === 'change' && S.data && ev.siteId === S.siteId) {
        const arr = S.data[ev.col];
        if (!arr) return;
        if (ev.action === 'delete') { const i = arr.findIndex((x) => x.id === ev.id); if (i >= 0) arr.splice(i, 1); }
        else { const i = arr.findIndex((x) => x.id === ev.item.id); if (i >= 0) arr[i] = ev.item; else arr.push(ev.item); }
        if (['entries', 'machines', 'maintenance', 'maintLog'].includes(ev.col)) App.recompute();
        App.refresh(ev);
      }
    },
    async resync(reshell) {
      try {
        const b = await API.get('bootstrap');
        const wasSuper = App.isSuper();
        S.sites = b.sites; S.users = b.users; S.user = b.user; S.settings = b.settings || S.settings;
        if (reshell || wasSuper !== App.isSuper()) { if (S.siteId) await App.loadSite(S.siteId); App.renderShell(); App.render(); return; }
        S.notifs = await API.get('notifications');
        if (S.siteId) await App.loadSite(S.siteId);
        App.refresh({ type: 'resync' });
      } catch (e) { /* ignore */ }
    },

    /* ---------------- connection status (offline queue) ---------------- */
    updateNet(syncing) {
      const p = $('#netPill'); if (!p) return;
      const n = API.outbox.length, probs = API.problems ? API.problems().length : 0;
      let cls = '', txt = '';
      if (API.offline) { cls = 'off'; txt = icon('wifi') + '<span>Offline' + (n ? ' · ' + n + ' waiting' : '') + '</span>'; }
      else if (syncing || n) { cls = 'sync'; txt = icon('refresh') + '<span>Sending ' + n + '…</span>'; }
      else if (probs) { cls = 'err'; txt = icon('alert') + '<span>' + probs + ' not saved</span>'; }
      p.className = 'net-pill ' + cls + (txt ? '' : ' hidden');
      p.innerHTML = txt;
    },
    netModal() {
      const probs = API.problems();
      modal({
        title: API.offline ? "You're offline" : 'Sync status', footer: '<button class="btn" data-x>Close</button>' + (probs.length ? '<button class="btn danger" data-clear>Clear list</button>' : '') + '<button class="btn primary" data-retry>' + icon('refresh') + ' Try now</button>',
        body: '<p style="margin-top:0">' + (API.offline ? 'There is no connection to the portal server. You can keep logging readings, chatting and completing maintenance — everything is saved on this device and sent automatically when the connection is back.' : 'Connected.') + '</p>' +
          '<p><b>' + API.outbox.length + '</b> change(s) waiting on this device.</p>' +
          (API.outbox.length ? '<ul class="perm-list">' + API.outbox.slice(0, 20).map((q) => '<li>' + esc(UI.dt(q.at)) + ' — ' + esc(q.method === 'DELETE' ? 'delete' : q.method === 'PUT' ? 'edit' : 'new') + ' ' + esc(q.path.split('/').filter((x) => !/_/.test(x)).join(' ')) + '</li>').join('') + '</ul>' : '') +
          (probs.length ? '<h4 style="margin:14px 0 6px;color:#ff9a9a">Not saved (' + probs.length + ')</h4><ul class="perm-list">' + probs.slice(-10).reverse().map((x) => '<li>' + esc(x.what) + ': ' + esc(x.error) + '</li>').join('') + '</ul><p class="hint">These were rejected by the server (for example a row someone else already deleted). Re-enter them if needed.</p>' : ''),
        onMount: (ov, close) => {
          $('[data-retry]', ov).addEventListener('click', async () => { await API.flush(); try { await API.net('GET', 'health'); API.setOffline(false); } catch (e) { /* still offline */ } close(); App.updateNet(); });
          const c = $('[data-clear]', ov); if (c) c.addEventListener('click', () => { API.clearProblems(); close(); });
        }
      });
    },
    async phoneModal() {
      let net = null;
      try { net = await API.get('network'); } catch (e) { /* demo / offline */ }
      const here = location.origin + location.pathname.replace(/index\.html$/, '');
      const urls = Array.from(new Set([here].concat(net ? net.urls : []))).filter((u) => !/localhost|127\.0\.0\.1/.test(u));
      const qr = (u) => { try { const q = qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { return ''; } };
      modal({
        title: 'Use on a phone or tablet', wide: true, footer: '<button class="btn primary" data-x>Done</button>',
        body: (API.mode !== 'server' ? '<div class="demo-note">This is demo mode (no server). Start <span class="kbd">start.bat</span> on a PC first.</div>' :
          (urls.length ? '<p style="margin-top:0">On the phone, connect to the <b>same network / Wi-Fi</b> as this server, then scan the code with the camera (or type the address):</p><div class="qr-grid">' +
            urls.map((u) => '<div class="qr-card"><div class="qr">' + qr(u) + '</div><div class="kbd" style="font-size:13px">' + esc(u) + '</div></div>').join('') + '</div>'
            : '<p>No network address found — make sure the server PC is connected to the network.</p>')) +
          '<h4 style="margin:16px 0 6px">Add it to the home screen</h4><ul class="perm-list">' +
          '<li><b>iPhone / iPad (Safari):</b> Share button → <b>Add to Home Screen</b></li>' +
          '<li><b>Android (Chrome):</b> ⋮ menu → <b>Install app</b> or <b>Add to Home screen</b></li></ul>' +
          '<h4 style="margin:16px 0 6px">Working offline on the phone</h4><p class="hint" style="margin:0">Once a phone has opened the portal, readings, chat and maintenance completions entered without signal are kept on the phone and sent automatically when it reconnects. ' +
          (net && net.secure ? 'This server uses HTTPS, so the app also opens with no signal at all.' : 'For the app to also <b>open</b> with no signal at all, phones need the portal on an <b>https://</b> address (ask IT to put it behind the company certificate — see README → Mobile). Over plain http:// keep the page open; queued changes still work.') + '</p>' +
          '<p class="hint">If the page does not load on the phone: allow port ' + (net ? net.port : 3000) + ' in the Windows firewall on the server PC (README → Mobile).</p>'
      });
    },

    /* ---------------- start ---------------- */
    async start() {
      if (!API.signedIn) { App.renderSignIn(); return; }
      let b;
      try { b = await API.get('bootstrap'); }
      catch (e) { App.renderSignIn(); return; }
      S.user = b.user; S.sites = b.sites; S.users = b.users; S.settings = b.settings || Core.DEFAULT_SETTINGS;
      try { S.notifs = await API.get('notifications'); } catch (e) { S.notifs = []; }
      Views.widgets.reload(true);
      const saved = API.store.get('mhp.site');
      const id = S.sites.find((s) => s.id === saved) ? saved : (S.sites[0] && S.sites[0].id);
      await App.loadSite(id || null);
      if (!location.hash || location.hash === '#/') location.hash = S.sites.length ? '#/dashboard' : '#/sites/list';
      App.parseHash();
      App.renderShell();
      App.render();
      API.connect();
      App.updateNet();
      if (API.offline) toast("You're offline — showing the copy saved on this device. New changes are sent when you reconnect.", 'warn');
      API.flush();
    }
  };
  window.App = App;

  window.addEventListener('hashchange', () => { if (S.user && $('#main')) App.render(); });
  document.addEventListener('focusout', () => { if (App._pending) setTimeout(() => { const a = document.activeElement; if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) { if (App._pending && !$('.overlay')) { App._pending = false; App.refresh({ type: 'pending' }); } } }, 50); });
  document.addEventListener('mhp:modalclosed', () => { if (App._pending && !$('.overlay')) { App._pending = false; App.refresh({ type: 'pending', force: true }); } });
  document.addEventListener('keydown', (e) => {
    // Ctrl+;  → today's date in a focused date field (Excel habit)
    if ((e.ctrlKey || e.metaKey) && e.key === ';') {
      const a = document.activeElement;
      if (a && a.type === 'date') { e.preventDefault(); a.value = Core.localDate(Date.now()); a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    if (e.key === 'Escape') { document.body.classList.remove('widget-open', 'side-open'); App.closePops(); const np = $('.notif-pop'); if (np) np.remove(); }
  });
  // countdown ticker
  setInterval(() => {
    const now = Date.now();
    $$('[data-cd]').forEach((n) => {
      const ms = Number(n.dataset.cd) - now;
      n.innerHTML = UI.countdown(ms);
    });
  }, 1000);

  // keep the app on the device (needs https:// or localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    // When a new version of the app takes over, reload once so the new files are used straight away
    // (not on the very first install, when nothing was controlling the page yet).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    // never throw away something being typed: if a form is open or filled in, wait until the app is in the background
    const busy = () => !!document.querySelector('.modal') ||
      Array.from(document.querySelectorAll('.entry-form input:not([type=date]):not([type=hidden]), form textarea, [data-annform] input')).some((i) => i.value && i.name !== 'shift');
    const reloadNow = () => { if (reloading) return; reloading = true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      if (!busy()) return reloadNow();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reloadNow(); });
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      // look for a new version whenever the app is brought back to the front (phones keep it open for days)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {}));
  }
  API.on((ev) => App.onEvent(ev));
  API.init().then(() => App.start());
})();
