/*
 * Machine Hours Portal — shared core
 * Used by BOTH the Node server (require) and the browser (window.Core).
 * Holds: data model, validation, calculations (start readings, hours, checks,
 * analytics, maintenance countdown) and the API router.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.2.0';
  const DAY = 86400000;

  /* ---------------------------------------------------------- helpers */
  const uid = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const r2 = (x) => Math.round(x * 100) / 100;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const pad = (n) => String(n).padStart(2, '0');
  function localDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return localDate(new Date(y, m - 1, d + n).getTime());
  }
  function daysInMonth(month) { // 'YYYY-MM'
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const err = (s, m) => new HttpError(s, m);

  function emptyDB() {
    return {
      version: 1, users: [], sessions: {}, sites: [], machines: [], operators: [], telehuts: [],
      entries: [], maintenance: [], maintLog: [], messages: [], announcements: [], widgets: [], notifications: [],
      audit: [],
      // security data never leaves the server (not synced to SharePoint, not sent to browsers)
      security: { superusers: [], creds: {}, codes: {} },
      settings: Object.assign({}, DEFAULT_SETTINGS)
    };
  }
  function migrate(db) {
    const base = emptyDB();
    for (const k of Object.keys(base)) if (db[k] == null) db[k] = base[k];
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (db.settings[k] == null) db.settings[k] = DEFAULT_SETTINGS[k];
    for (const k of ['superusers', 'creds', 'codes']) if (db.security[k] == null) db.security[k] = k === 'superusers' ? [] : {};
    return db;
  }

  /* ---------------------------------------------------------- superusers & settings */
  // The owner(s) can never be removed from the superuser list through the app.
  const DEFAULT_OWNERS = ['nicholas.william_davies_c@sandvik.com'];
  const DEFAULT_SETTINGS = {
    allowUserSiteCreate: false,   // regular users may create new mine sites
    allowUserListEdit: true,      // regular users may add/remove operators & telehuts
    allowUserMaintEdit: false,    // regular users may edit/delete maintenance schedules
    allowUserMaintCreate: true,   // regular users may create maintenance schedules
    entryEditHours: 24            // regular users may edit/delete their own shift rows for this many hours
  };
  const SETTING_TYPES = { allowUserSiteCreate: 'bool', allowUserListEdit: 'bool', allowUserMaintEdit: 'bool', allowUserMaintCreate: 'bool', entryEditHours: 'num' };
  function superEmails(db, owners) {
    const set = new Set((owners || DEFAULT_OWNERS).map((e) => e.toLowerCase()));
    ((db.security && db.security.superusers) || []).forEach((e) => set.add(String(e).toLowerCase()));
    return Array.from(set);
  }
  function isSuperEmail(db, email, owners) { return superEmails(db, owners).includes(String(email || '').toLowerCase()); }
  function audit(db, user, action, siteId, details) {
    const site = siteId ? db.sites.find((x) => x.id === siteId) : null;
    const a = { id: uid('au_'), at: Date.now(), action, userId: user ? user.id : null, userName: user ? user.name : 'system', userEmail: user ? user.email : null,
      siteId: siteId || null, siteName: site ? site.name : null, details: details ? String(details).slice(0, 1000) : null };
    db.audit.push(a);
    if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
    return a;
  }

  /* ---------------------------------------------------------- schema */
  const MACHINE_STATUS = ['Operating', 'Standby', 'Down', 'In maintenance'];
  const MACHINE_TYPES = ['Loader', 'Truck', 'Drill', 'Other'];
  // Machines saved before types existed are loaders (the portal was built for loaders).
  const isLoader = (m) => !!m && (!m.type || m.type === 'Loader');
  /** Bucket count → truck equivalent, e.g. { trucks: 2.33, full: 2, rest: 1 } (null without a ratio). */
  function truckEq(buckets, perTruck) {
    if (!isNum(buckets) || !isNum(perTruck) || perTruck <= 0) return null;
    return { trucks: r2(buckets / perTruck), full: Math.floor(buckets / perTruck + 1e-9), rest: r2(buckets - Math.floor(buckets / perTruck + 1e-9) * perTruck) };
  }
  const SCHEMA = {
    machines: { name: 'str!', model: 'str', type: 'str', bucketsPerTruck: 'num', active: 'bool', openingTR: 'num', openingRCC: 'num', status: 'str', notes: 'text' },
    operators: { name: 'str!' },
    telehuts: { name: 'str!' },
    entries: { date: 'date!', shift: 'str!', machineId: 'str!', telehut: 'str', operator: 'str', trEnd: 'num!', rccEnd: 'num!', buckets: 'num', remarks: 'text' },
    maintenance: {
      machineId: 'str!', title: 'str!', category: 'str', dueAt: 'num', basis: 'str', dueReading: 'num',
      intervalDays: 'num', intervalHours: 'num', leadDays: 'num', leadHours: 'num', notes: 'text', assignee: 'str'
    },
    announcements: { title: 'str!', body: 'text', priority: 'str', pinned: 'bool', expires: 'num', emailAll: 'bool' },
    messages: { channel: 'str!', text: 'text!' }
  };
  const SITE_SCHEMA = {
    name: 'str!', location: 'str', country: 'str', description: 'text', coverImage: 'img', color: 'str',
    shifts: 'list', shiftHours: 'num', leadDays: 'num', leadHours: 'num'
  };

  function clean(schema, body, partial) {
    const out = {};
    body = body || {};
    for (const [k, t] of Object.entries(schema)) {
      const req = t.endsWith('!');
      const type = t.replace('!', '');
      if (!(k in body)) {
        if (req && !partial) throw err(400, 'Missing field: ' + k);
        continue;
      }
      let v = body[k];
      if (v === '' || v === undefined) v = null;
      if (v !== null) {
        switch (type) {
          case 'str': v = String(v).trim().slice(0, 160); break;
          case 'text': v = String(v).trim().slice(0, 5000); break;
          case 'num': v = Number(v); if (!isFinite(v)) throw err(400, 'Invalid number: ' + k); break;
          case 'bool': v = v === true || v === 'true' || v === 1 || v === 'on'; break;
          case 'date': v = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw err(400, 'Invalid date: ' + k); break;
          case 'list': v = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 12); break;
          case 'img':
            v = String(v);
            if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v)) throw err(400, 'Cover must be an image');
            if (v.length > 4e6) throw err(413, 'Image too large');
            break;
        }
        if ((type === 'str' || type === 'text') && v === '') v = null;
      }
      if (req && v === null) throw err(400, 'Missing field: ' + k);
      out[k] = v;
    }
    return out;
  }

  /** Extra checks for the bucket / machine-type fields (after clean()). */
  function checkFields(col, v) {
    if (col === 'machines') {
      if (v.type != null && !MACHINE_TYPES.includes(v.type)) throw err(400, 'Machine type must be one of: ' + MACHINE_TYPES.join(', '));
      if (v.bucketsPerTruck != null && !(v.bucketsPerTruck > 0 && v.bucketsPerTruck <= 100)) throw err(400, 'Buckets per truck must be between 0 and 100');
    }
    if (col === 'entries' && v.buckets != null && !(Number.isInteger(v.buckets) && v.buckets >= 0 && v.buckets <= 10000))
      throw err(400, 'Buckets must be a whole number from 0 to 10000');
    return v;
  }

  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    if (!/^https?:\/\//i.test(u)) return null; // only http(s) links
    return u.slice(0, 1000);
  }

  /* ---------------------------------------------------------- calculations */
  /**
   * Chain each loader's rows in time order.
   * Start = that loader's previous valid End reading (first row = opening reading).
   * Rows where End < Start are flagged and excluded from totals; the chain
   * continues from the last good reading so one typo doesn't break later rows.
   */
  function computeSite(d) {
    const site = d.site || {};
    const shifts = site.shifts && site.shifts.length ? site.shifts : ['Day', 'Night'];
    const shiftHours = isNum(site.shiftHours) ? site.shiftHours : 12;
    const si = (s) => { const i = shifts.indexOf(s); return i < 0 ? 99 : i; };
    const mById = {};
    (d.machines || []).forEach((m) => (mById[m.id] = m));
    const sorted = (d.entries || []).slice().sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (si(a.shift) - si(b.shift)) || (a.createdAt - b.createdAt));
    const chain = {};
    const seen = {};
    const rows = [];
    for (const e of sorted) {
      const m = mById[e.machineId];
      const c = chain[e.machineId] || (chain[e.machineId] = {
        tr: m && isNum(m.openingTR) ? m.openingTR : null,
        rcc: m && isNum(m.openingRCC) ? m.openingRCC : null,
        lastOperator: null, lastDate: null
      });
      const r = Object.assign({}, e, { trStart: c.tr, rccStart: c.rcc, issues: [], warnings: [] });
      if (!m) r.issues.push('Unknown machine');
      // TR
      if (c.tr == null) { r.trHrs = null; r.issues.push('No opening TR reading'); c.tr = e.trEnd; }
      else {
        r.trHrs = r2(e.trEnd - c.tr);
        if (r.trHrs < 0) r.issues.push('TR End < Start'); else c.tr = e.trEnd;
      }
      // RCC
      if (c.rcc == null) { r.rccHrs = null; r.issues.push('No opening RCC reading'); c.rcc = e.rccEnd; }
      else {
        r.rccHrs = r2(e.rccEnd - c.rcc);
        if (r.rccHrs < 0) r.issues.push('RCC End < Start'); else c.rcc = e.rccEnd;
      }
      r.valid = r.issues.length === 0;
      r.total = r.valid ? r2(r.trHrs + r.rccHrs) : null;
      // Manual = what is left of the shift after tele-remote and RCC time.
      r.manualHrs = r.valid ? r2(Math.max(0, shiftHours - r.total)) : null;
      const te = truckEq(e.buckets, m && m.bucketsPerTruck);
      r.trucks = te ? te.trucks : null;
      if (r.valid && r.total > shiftHours) r.warnings.push('More than ' + shiftHours + ' h in one shift');
      const key = e.machineId + '|' + e.date + '|' + e.shift;
      if (seen[key]) r.warnings.push('Duplicate machine/shift');
      seen[key] = true;
      r.needsCheck = !r.valid || r.warnings.length > 0;
      if (e.operator) c.lastOperator = e.operator;
      c.lastDate = e.date;
      rows.push(r);
    }
    return { rows, chain, shifts };
  }

  /** Latest meters + average daily usage (last 14 days) per machine. */
  function meters(d, computed, now) {
    computed = computed || computeSite(d);
    const today = localDate(now || Date.now());
    const from = addDays(today, -14);
    const out = {};
    for (const m of d.machines || []) {
      const c = computed.chain[m.id];
      const tr = c ? c.tr : (isNum(m.openingTR) ? m.openingTR : null);
      const rcc = c ? c.rcc : (isNum(m.openingRCC) ? m.openingRCC : null);
      out[m.id] = {
        tr, rcc, total: tr != null && rcc != null ? r2(tr + rcc) : null,
        lastOperator: c ? c.lastOperator : null, lastDate: c ? c.lastDate : null,
        avg_tr: 0, avg_rcc: 0, avg_total: 0, cumTR: 0, cumRCC: 0
      };
    }
    for (const r of computed.rows) {
      const o = out[r.machineId];
      if (!o || !r.valid) continue;
      o.cumTR += r.trHrs; o.cumRCC += r.rccHrs;
      if (r.date > from && r.date <= today) { o.avg_tr += r.trHrs / 14; o.avg_rcc += r.rccHrs / 14; o.avg_total += r.total / 14; }
    }
    return out;
  }

  function analytics(d, month, computed) {
    computed = computed || computeSite(d);
    const rows = computed.rows.filter((r) => r.date.slice(0, 7) === month);
    const valid = rows.filter((r) => r.valid);
    const sum = (arr, k) => r2(arr.reduce((a, r) => a + (r[k] || 0), 0));
    const k = { tr: sum(valid, 'trHrs'), rcc: sum(valid, 'rccHrs') };
    k.total = r2(k.tr + k.rcc);
    k.manual = sum(valid, 'manualHrs');
    k.buckets = sum(rows, 'buckets');
    k.share = k.total ? k.tr / k.total : null;
    k.check = rows.filter((r) => r.needsCheck).length;
    k.errors = rows.filter((r) => !r.valid).length;
    k.shifts = valid.length;
    k.avgPerShift = valid.length ? r2(k.total / valid.length) : 0;

    const met = meters(d, computed);
    const perMachine = (d.machines || []).map((m) => {
      const mr = valid.filter((r) => r.machineId === m.id);
      const all = rows.filter((r) => r.machineId === m.id);
      const last = all[all.length - 1];
      const tr = sum(mr, 'trHrs'), rcc = sum(mr, 'rccHrs');
      const buckets = sum(all, 'buckets'), te = truckEq(buckets, m.bucketsPerTruck);
      return {
        machine: m, tr, rcc, total: r2(tr + rcc), shifts: mr.length, manual: sum(mr, 'manualHrs'), buckets, trucks: te ? te.trucks : null,
        latestTR: met[m.id] && met[m.id].tr, latestRCC: met[m.id] && met[m.id].rcc,
        lastOperator: last ? last.operator : (met[m.id] && met[m.id].lastOperator)
      };
    });
    const opMap = {};
    for (const r of valid) {
      const n = r.operator || '(unassigned)';
      const o = opMap[n] || (opMap[n] = { name: n, shifts: 0, tr: 0, rcc: 0, total: 0 });
      o.shifts++; o.tr += r.trHrs; o.rcc += r.rccHrs; o.total += r.total;
    }
    const known = (d.operators || []).map((o) => o.name);
    known.forEach((n) => { if (!opMap[n]) opMap[n] = { name: n, shifts: 0, tr: 0, rcc: 0, total: 0 }; });
    const perOperator = Object.values(opMap).map((o) => ({ ...o, tr: r2(o.tr), rcc: r2(o.rcc), total: r2(o.total) }))
      .sort((a, b) => b.total - a.total);

    const days = daysInMonth(month);
    const daily = [];
    for (let i = 1; i <= days; i++) {
      const ds = month + '-' + pad(i);
      const dr = valid.filter((r) => r.date === ds);
      daily.push({ date: ds, tr: sum(dr, 'trHrs'), rcc: sum(dr, 'rccHrs') });
    }
    const group = (key) => {
      const g = {};
      for (const r of valid) {
        const n = r[key] || '—';
        const o = g[n] || (g[n] = { name: n, tr: 0, rcc: 0, count: 0 });
        o.tr += r.trHrs; o.rcc += r.rccHrs; o.count++;
      }
      return Object.values(g).map((o) => ({ ...o, tr: r2(o.tr), rcc: r2(o.rcc) }));
    };
    return { month, kpi: k, perMachine, perOperator, daily, byShift: group('shift'), byTelehut: group('telehut'), rows };
  }

  /** Maintenance countdown / status for one schedule. */
  function maintStatus(m, met, site, now) {
    now = now || Date.now();
    site = site || {};
    const leadDays = isNum(m.leadDays) ? m.leadDays : isNum(site.leadDays) ? site.leadDays : 3;
    const leadHours = isNum(m.leadHours) ? m.leadHours : isNum(site.leadHours) ? site.leadHours : 25;
    const msLeft = isNum(m.dueAt) ? m.dueAt - now : null;
    let hrsLeft = null, estAt = null, cur = null, rate = 0;
    if (m.basis && m.basis !== 'none' && isNum(m.dueReading) && met) {
      cur = met[m.basis];
      rate = met['avg_' + m.basis] || 0;
      if (isNum(cur)) {
        hrsLeft = r2(m.dueReading - cur);
        if (rate > 0) estAt = now + (hrsLeft / rate) * DAY;
      }
    }
    const cands = [m.dueAt, estAt].filter(isNum);
    const nextAt = cands.length ? Math.min.apply(null, cands) : null;
    const overdue = (msLeft != null && msLeft <= 0) || (hrsLeft != null && hrsLeft <= 0);
    const soon = !overdue && ((msLeft != null && msLeft <= leadDays * DAY) || (hrsLeft != null && hrsLeft <= leadHours));
    let pct = 0;
    if (isNum(m.dueAt) && isNum(m.startAt) && m.dueAt > m.startAt) pct = Math.max(pct, (now - m.startAt) / (m.dueAt - m.startAt));
    if (hrsLeft != null && isNum(m.startReading) && m.dueReading > m.startReading) pct = Math.max(pct, (cur - m.startReading) / (m.dueReading - m.startReading));
    pct = Math.max(0, Math.min(1, pct));
    const status = m.status === 'done' ? 'done' : overdue ? 'overdue' : soon ? 'soon' : 'ok';
    return { status, msLeft, hrsLeft, estAt, nextAt, current: cur, rate: r2(rate), pct };
  }

  function siteBundle(db, siteId) {
    const f = (c) => db[c].filter((x) => x.siteId === siteId);
    return { site: db.sites.find((s) => s.id === siteId), machines: f('machines'), entries: f('entries'), operators: f('operators') };
  }

  /* ---------------------------------------------------------- notifications */
  function notify(db, out, siteId, userIds, n, email) {
    const site = db.sites.find((s) => s.id === siteId);
    for (const u of userIds) {
      const user = db.users.find((x) => x.id === u);
      if (!user) continue;
      const item = { id: uid('n_'), userId: u, siteId, type: n.type, title: n.title, body: n.body || '', link: n.link || null, ts: Date.now(), read: false };
      db.notifications.push(item);
      out.events.push({ type: 'notify', userId: u, item });
      if (email && user.email && user.notifyEmail !== false) {
        out.emails.push({
          to: user.email,
          subject: '[' + (site ? site.name : 'Machine Hours') + '] ' + n.title,
          text: 'Hi ' + user.name + ',\n\n' + n.title + '\n' + (n.body || '') + '\n\nSite: ' + (site ? site.name : '') + '\n\n— Machine Hours Portal'
        });
      }
    }
    // keep last 200 per user
    const counts = {};
    for (let i = db.notifications.length - 1; i >= 0; i--) {
      const x = db.notifications[i];
      counts[x.userId] = (counts[x.userId] || 0) + 1;
      if (counts[x.userId] > 200) db.notifications.splice(i, 1);
    }
  }

  function checkMaintenance(db, now) {
    now = now || Date.now();
    const out = { events: [], emails: [], dirty: false };
    for (const site of db.sites) {
      const b = siteBundle(db, site.id);
      const met = meters(b, null, now);
      for (const m of db.maintenance.filter((x) => x.siteId === site.id && x.status !== 'done')) {
        const st = maintStatus(m, met[m.machineId], site, now);
        m.notified = m.notified || {};
        const mach = b.machines.find((x) => x.id === m.machineId);
        const mName = mach ? mach.name : 'Machine';
        let n = null;
        if (st.status === 'overdue' && !m.notified.overdue) { m.notified.overdue = true; m.notified.soon = true; n = { title: 'OVERDUE: ' + m.title + ' — ' + mName }; }
        else if (st.status === 'soon' && !m.notified.soon) { m.notified.soon = true; n = { title: 'Due soon: ' + m.title + ' — ' + mName }; }
        if (n) {
          const parts = [];
          if (isNum(m.dueAt)) parts.push('Due date: ' + new Date(m.dueAt).toLocaleString());
          if (st.hrsLeft != null) parts.push('Hours remaining: ' + st.hrsLeft + ' h (' + m.basis.toUpperCase() + ' meter)');
          notify(db, out, site.id, site.members || [], { type: 'maintenance', title: n.title, body: parts.join(' · '), link: { tab: 'fleet', sub: 'maintenance' } }, true);
          out.events.push({ type: 'change', siteId: site.id, col: 'maintenance', action: 'upsert', item: m });
          out.dirty = true;
        }
      }
    }
    return out;
  }

  /* ---------------------------------------------------------- demo data */
  function seedDemo(db, userId, now) {
    now = now || Date.now();
    const siteId = uid('s_');
    const t0 = now;
    const site = {
      id: siteId, name: 'Demo Mine — AutoMine', location: 'Underground Level 3', country: 'Ghana',
      description: 'Sample environment with loaders 6, 7, 9 and 11 (from the v4 mockup).',
      shifts: ['Day', 'Night'], shiftHours: 12, leadDays: 3, leadHours: 25, color: '#A08C64',
      coverImage: null, createdBy: userId, createdAt: t0, members: [userId]
    };
    db.sites.push(site);
    const days = 40;
    const startDate = addDays(localDate(now), -days + 1);
    const mk = (name, model, active, tr, rcc, status) => {
      const m = { id: uid('m_'), siteId, name, model, type: 'Loader', bucketsPerTruck: 4, bucketCount: 0, active, openingTR: tr, openingRCC: rcc, status, notes: null, createdAt: t0 };
      db.machines.push(m); return m;
    };
    const L6 = mk('Loader 6', 'LH517i', true, 4520.0, 1180.0, 'Operating');
    const L7 = mk('Loader 7', 'LH517i', false, null, null, 'Standby');
    const L9 = mk('Loader 9', 'LH517i', true, 3700.5, 950.0, 'Operating');
    const L11 = mk('Loader 11', 'LH514', true, 1900.0, 520.5, 'Down');
    void L7;
    const ops = ['Baafi', 'O.T.', 'Amakyi', 'George', 'Bonsu', 'Agyeman'];
    ops.forEach((n) => db.operators.push({ id: uid('o_'), siteId, name: n, createdAt: t0 }));
    ['Telehut 1', 'Telehut 2'].forEach((n) => db.telehuts.push({ id: uid('t_'), siteId, name: n, createdAt: t0 }));
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const meter = {};
    [L6, L9, L11].forEach((m) => (meter[m.id] = { tr: m.openingTR, rcc: m.openingRCC }));
    let k = 0;
    for (let d = 0; d < days; d++) {
      const date = addDays(startDate, d);
      for (const shift of ['Day', 'Night']) {
        [L6, L9, L11].forEach((m, i) => {
          const mt = meter[m.id];
          let tr = r2(Math.round((5 + rnd() * 3) * 2) / 2), rcc = r2(Math.round((rnd() * 2.5) * 2) / 2), remarks = null;
          if (m === L11 && d >= days - 2) { tr = 0; rcc = 0; remarks = 'Down – scheduled service'; }
          else if (rnd() < 0.05) { tr = 0; rcc = 0; remarks = 'Down – breakdown'; }
          else if (rcc >= 2) remarks = 'RCC tram to workshop';
          mt.tr = r2(mt.tr + tr); mt.rcc = r2(mt.rcc + rcc);
          db.entries.push({
            id: uid('e_'), siteId, date, shift, machineId: m.id, telehut: i === 1 ? 'Telehut 2' : 'Telehut 1',
            operator: ops[(k++ + d) % ops.length], trEnd: mt.tr, rccEnd: mt.rcc, buckets: Math.round(tr * 4), remarks,
            createdBy: userId, createdAt: t0 + k
          });
        });
      }
    }
    // one typo row on the last night shift (End < Start) to show the check
    const last = db.entries.filter((e) => e.siteId === siteId && e.machineId === L9.id).pop();
    last.trEnd = r2(last.trEnd - 13); last.remarks = null;
    const b = siteBundle(db, siteId);
    const met = meters(b, null, now);
    const addM = (machine, title, cat, o) => {
      const m = Object.assign({
        id: uid('mt_'), siteId, machineId: machine.id, title, category: cat, dueAt: null, basis: 'none', dueReading: null,
        intervalDays: null, intervalHours: null, leadDays: null, leadHours: null, notes: null, assignee: null,
        status: 'open', startAt: now - 5 * DAY, startReading: null, notified: {}, createdBy: userId, createdAt: now
      }, o);
      db.maintenance.push(m);
    };
    addM(L6, '250 h service', 'Service', { basis: 'total', dueReading: r2(met[L6.id].total + 40), startReading: r2(met[L6.id].total - 210), intervalHours: 250, assignee: 'Workshop A' });
    addM(L9, 'Tyre & rim inspection', 'Inspection', { dueAt: now + 3 * DAY + 5 * 3600000, intervalDays: 14, startAt: now - 11 * DAY });
    addM(L11, 'Scheduled service', 'Service', { dueAt: now - 1 * DAY, startAt: now - 30 * DAY, intervalDays: 30, notes: 'Machine parked at workshop bay 2' });
    addM(L6, 'Tele-remote camera & radio check', 'Automation', { dueAt: now + 6 * DAY, intervalDays: 7, startAt: now - 1 * DAY });
    addM(L9, 'Hydraulic oil sample', 'Service', { basis: 'tr', dueReading: r2(met[L9.id].tr + 120), startReading: r2(met[L9.id].tr - 380), dueAt: now + 20 * DAY, startAt: now - 25 * DAY });
    db.announcements.push({
      id: uid('a_'), siteId, title: 'Welcome to the Machine Hours Portal', priority: 'info', pinned: true, expires: null, emailAll: false,
      body: 'Enter only the END readings at shift end — START fills itself in from the loader\'s previous reading.',
      userId, userName: (db.users.find((u) => u.id === userId) || {}).name || 'System', createdAt: now
    });
    db.announcements.push({
      id: uid('a_'), siteId, title: 'Loader 11 down for scheduled service', priority: 'important', pinned: false, expires: null, emailAll: false,
      body: 'Loader 11 is parked in workshop bay 2. Expected back in service in 2 shifts.', userId, userName: 'Workshop', createdAt: now - 3600000
    });
    const msg = (channel, userName, text, ago) => db.messages.push({ id: uid('c_'), siteId, channel, text, userId: null, userName, createdAt: now - ago });
    msg('general', 'George', 'Night shift handover done. Loader 6 running fine.', 5 * 3600000);
    msg('general', 'Bonsu', 'Telehut 2 screen 3 is flickering, raised a ticket.', 4 * 3600000);
    msg(L9.id, 'O.T.', 'Took Loader 9 to the workshop on RCC for a hose check.', 3 * 3600000);
    return site;
  }

  /* ---------------------------------------------------------- router */
  const pub = (u) => ({ id: u.id, name: u.name });
  const me = (u, r) => ({ id: u.id, name: u.name, email: u.email, notifyEmail: u.notifyEmail !== false, createdAt: u.createdAt,
    isSuper: !!(r && r.isSuper), isOwner: !!(r && (r.owners || DEFAULT_OWNERS).map((e) => e.toLowerCase()).includes(u.email)),
    superEmail: !!(r && r.db && isSuperEmail(r.db, u.email, r.owners)) });
  function siteSummary(db, s) {
    return Object.assign({}, s, {
      machineCount: db.machines.filter((m) => m.siteId === s.id).length,
      entryCount: db.entries.filter((e) => e.siteId === s.id).length,
      memberCount: (s.members || []).length
    });
  }

  function handle(db, req) {
    const method = req.method.toUpperCase();
    const seg = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const body = req.body || {};
    const out = { status: 200, data: null, events: [], emails: [], dirty: false };
    const now = Date.now();
    const ok = (data, status) => { out.data = data; if (status) out.status = status; return out; };
    const mut = () => { out.dirty = true; };

    // --- sign in (name + email, no password) ---
    if (seg[0] === 'auth' && seg[1] === 'signin' && method === 'POST') {
      const name = String(body.name || '').trim().slice(0, 80);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
      if (!name) throw err(400, 'Please enter your name');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'Please enter a valid email');
      let u = db.users.find((x) => x.email === email);
      if (u && u.disabled) throw err(403, 'This account has been disabled. Contact a superuser.');
      if (!u) { u = { id: uid('u_'), name, email, notifyEmail: true, createdAt: now }; db.users.push(u); }
      else u.name = name;
      u.lastSeen = now;
      mut();
      out.events.push({ type: 'users', item: pub(u) });
      return ok(me(u, Object.assign({ db }, req)));
    }

    const user = db.users.find((u) => u.id === req.userId);
    if (!user) throw err(401, 'Sign in required');
    if (user.disabled) throw err(401, 'This account has been disabled');
    const isSuper = !!req.isSuper;
    const S = db.settings;
    const mreq = Object.assign({ db }, req);
    /** throws 403 unless the user is a superuser or `allowed` is true */
    const need = (allowed, what) => { if (!isSuper && !allowed) throw err(403, 'Only superusers can ' + (what || 'do this')); };
    const log = (action, siteId, details) => { audit(db, user, action, siteId, details); };

    const getSite = (id) => { const s = db.sites.find((x) => x.id === id); if (!s) throw err(404, 'Site not found'); return s; };
    const join = (s) => { s.members = s.members || []; if (!s.members.includes(user.id)) { s.members.push(user.id); mut(); } };

    // --- profile ---
    if (seg[0] === 'me') {
      if (method === 'GET') return ok(me(user, mreq));
      if (method === 'PUT') {
        if (body.name) user.name = String(body.name).trim().slice(0, 80);
        if ('notifyEmail' in body) user.notifyEmail = !!body.notifyEmail;
        mut(); out.events.push({ type: 'users', item: pub(user) });
        return ok(me(user, mreq));
      }
    }

    if (seg[0] === 'bootstrap' && method === 'GET') {
      return ok({ user: me(user, mreq), sites: db.sites.map((s) => siteSummary(db, s)), users: db.users.filter((u) => !u.disabled).map(pub), settings: Object.assign({}, S), version: VERSION });
    }

    // --- superuser: app settings & audit log ---
    if (seg[0] === 'admin' && seg[1] === 'settings') {
      need(false, 'view or change app settings');
      if (method === 'GET') return ok(Object.assign({}, S));
      if (method === 'PUT') {
        const changed = [];
        for (const [k, t] of Object.entries(SETTING_TYPES)) {
          if (!(k in body)) continue;
          const v = t === 'bool' ? !!body[k] : Math.max(0, Math.min(24 * 365, Number(body[k]) || 0));
          if (S[k] !== v) { changed.push(k + ': ' + S[k] + ' → ' + v); S[k] = v; }
        }
        if (changed.length) { log('Changed app settings', null, changed.join('; ')); mut(); out.events.push({ type: 'settings', item: Object.assign({}, S) }); }
        return ok(Object.assign({}, S));
      }
    }
    if (seg[0] === 'admin' && seg[1] === 'audit' && method === 'GET') {
      need(false, 'view the audit log');
      return ok(db.audit.slice(-1000).reverse());
    }

    if (seg[0] === 'demo' && method === 'POST') {
      need(S.allowUserSiteCreate, 'load the sample site');
      const s = seedDemo(db, user.id, now); mut();
      log('Loaded sample site', s.id, s.name);
      out.events.push({ type: 'sites', action: 'upsert', item: siteSummary(db, s) });
      mergeOut(out, checkMaintenance(db, now));
      return ok(siteSummary(db, s), 201);
    }

    // --- sites ---
    if (seg[0] === 'sites') {
      if (seg.length === 1 && method === 'GET') return ok(db.sites.map((s) => siteSummary(db, s)));
      if (seg.length === 1 && method === 'POST') {
        need(S.allowUserSiteCreate, 'create mine sites');
        const v = clean(SITE_SCHEMA, body);
        const s = Object.assign({ id: uid('s_'), shifts: ['Day', 'Night'], shiftHours: 12, leadDays: 3, leadHours: 25, color: '#A08C64' }, v,
          { createdBy: user.id, createdAt: now, members: [user.id] });
        if (!s.shifts || !s.shifts.length) s.shifts = ['Day', 'Night'];
        db.sites.push(s); mut();
        log('Created site', s.id, s.name);
        out.events.push({ type: 'sites', action: 'upsert', item: siteSummary(db, s) });
        return ok(siteSummary(db, s), 201);
      }
      const s = getSite(seg[1]);
      if (seg.length === 2 && method === 'PUT') {
        need(false, 'change site settings');
        const v = clean(SITE_SCHEMA, body, true);
        if ('coverImage' in body && body.coverImage === null) v.coverImage = null;
        const diff = Object.keys(v).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(v[k])).map((k) => k === 'coverImage' ? 'cover photo' : k + ': ' + JSON.stringify(s[k]) + ' → ' + JSON.stringify(v[k]));
        Object.assign(s, v, { updatedAt: now }); mut();
        if (diff.length) log('Changed site settings', s.id, diff.join('; '));
        out.events.push({ type: 'sites', action: 'upsert', item: siteSummary(db, s) });
        return ok(siteSummary(db, s));
      }
      if (seg.length === 2 && method === 'DELETE') {
        need(false, 'delete mine sites');
        log('Deleted site', s.id, s.name + ' (' + db.entries.filter((e) => e.siteId === s.id).length + ' log rows)');
        for (const c of ['machines', 'operators', 'telehuts', 'entries', 'maintenance', 'maintLog', 'messages', 'announcements', 'notifications'])
          db[c] = db[c].filter((x) => x.siteId !== s.id);
        db.sites = db.sites.filter((x) => x.id !== s.id); mut();
        out.events.push({ type: 'sites', action: 'delete', id: s.id });
        return ok({ deleted: s.id });
      }
      if (seg[2] === 'data' && method === 'GET') {
        join(s);
        const f = (c) => db[c].filter((x) => x.siteId === s.id);
        return ok({
          site: siteSummary(db, s), machines: f('machines'), operators: f('operators'), telehuts: f('telehuts'), entries: f('entries'),
          maintenance: f('maintenance'), maintLog: f('maintLog'), announcements: f('announcements'), messages: f('messages').slice(-1000),
          members: (s.members || []).map((id) => db.users.find((u) => u.id === id)).filter(Boolean).map(pub)
        });
      }
      // create in a site collection
      const col = seg[2];
      if (SCHEMA[col] && seg.length === 3 && method === 'POST') {
        if (col === 'machines') need(false, 'add machines');
        if (col === 'operators' || col === 'telehuts') need(S.allowUserListEdit, 'change the ' + col + ' list');
        if (col === 'maintenance') need(S.allowUserMaintCreate, 'schedule maintenance');
        if (col === 'announcements' && (body.priority === 'critical' || body.pinned)) need(false, 'post critical or pinned announcements');
        join(s);
        // devices that were offline send their own id, so replaying a queued change twice is harmless
        const cid = clientId(body.id);
        if (cid) { const ex = db[col].find((x) => x.id === cid); if (ex) return ok(ex); }
        const v = checkFields(col, clean(SCHEMA[col], body));
        const item = Object.assign({ id: cid || uid(col.slice(0, 2) + '_'), siteId: s.id }, v, { createdBy: user.id, createdAt: now });
        if (isNum(body.clientAt) && body.clientAt < now && now - body.clientAt < 30 * DAY) item.loggedOfflineAt = body.clientAt;
        if (col === 'machines') { if (item.active == null) item.active = true; if (!item.status) item.status = 'Operating'; }
        if (col === 'entries') {
          const mach = db.machines.find((m) => m.id === item.machineId && m.siteId === s.id);
          if (!mach) throw err(400, 'Unknown machine');
          item.createdByName = user.name;
          // buckets taken from the live counter come off it (anything counted since stays on)
          if (body.takeBuckets === true && isNum(item.buckets) && item.buckets > 0 && isNum(mach.bucketCount)) {
            mach.bucketCount = Math.max(0, mach.bucketCount - item.buckets); mach.bucketCountAt = now; mach.bucketCountBy = user.name;
            out.events.push({ type: 'change', siteId: s.id, col: 'machines', action: 'upsert', item: mach });
          }
        }
        if (col === 'messages' || col === 'announcements') { item.userId = user.id; item.userName = user.name; }
        if (col === 'announcements' && !item.priority) item.priority = 'info';
        if (col === 'maintenance') {
          if (!db.machines.find((m) => m.id === item.machineId && m.siteId === s.id)) throw err(400, 'Unknown machine');
          if (!item.basis) item.basis = 'none';
          if (item.dueAt == null && (item.basis === 'none' || item.dueReading == null)) throw err(400, 'Give a due date or a due meter reading');
          const met = meters(siteBundle(db, s.id), null, now)[item.machineId];
          item.status = 'open'; item.startAt = now; item.notified = {};
          item.startReading = item.basis !== 'none' && met ? met[item.basis] : null;
        }
        if ((col === 'operators' || col === 'telehuts') && db[col].some((x) => x.siteId === s.id && x.name.toLowerCase() === item.name.toLowerCase()))
          throw err(409, item.name + ' already exists');
        db[col].push(item); mut();
        if (col === 'machines') log('Added machine', s.id, item.name + ' (opening TR ' + item.openingTR + ', RCC ' + item.openingRCC + ')');
        if (col === 'announcements' && item.priority === 'critical') log('Posted critical announcement', s.id, item.title);
        out.events.push({ type: 'change', siteId: s.id, col, action: 'upsert', item });
        if (col === 'announcements') {
          notify(db, out, s.id, (s.members || []).filter((id) => id !== user.id),
            { type: 'announcement', title: (item.priority === 'critical' ? 'CRITICAL: ' : '') + item.title, body: item.body, link: { tab: 'chat', channel: 'announcements' } },
            !!item.emailAll || item.priority === 'critical');
        }
        if (col === 'messages') {
          const low = item.text.toLowerCase();
          const hit = db.users.filter((u) => u.id !== user.id && low.includes('@' + u.name.toLowerCase()));
          if (hit.length) notify(db, out, s.id, hit.map((u) => u.id),
            { type: 'mention', title: user.name + ' mentioned you', body: item.text.slice(0, 200), link: { tab: 'chat', channel: item.channel } }, true);
        }
        if (col === 'entries' || col === 'maintenance') mergeOut(out, checkMaintenance(db, now));
        return ok(item, 201);
      }
    }

    // --- item update / delete ---
    if (SCHEMA[seg[0]] && seg[1]) {
      const col = seg[0];
      const item = db[col].find((x) => x.id === seg[1]);
      if (!item) throw err(404, 'Not found');
      const own = item.userId === user.id || item.createdBy === user.id;
      const recent = now - (item.createdAt || 0) <= (Number(S.entryEditHours) || 0) * 3600000;
      if (col === 'messages' && !own && !(isSuper && method === 'DELETE')) throw err(403, 'You can only change your own messages');
      if (method === 'PUT' || method === 'DELETE') {
        const del = method === 'DELETE';
        if (col === 'machines') {
          const keys = Object.keys(body);
          need(!del && keys.length > 0 && keys.every((k) => k === 'status'), del ? 'delete machines' : 'change machine details');
        }
        if (col === 'operators' || col === 'telehuts') need(S.allowUserListEdit, 'change the ' + col + ' list');
        if (col === 'entries') need(own && recent, (del ? 'delete' : 'edit') + ' this row (you can change your own rows for ' + S.entryEditHours + ' h)');
        if (col === 'maintenance') need(S.allowUserMaintEdit, (del ? 'delete' : 'edit') + ' maintenance schedules');
        if (col === 'announcements') {
          need(own, (del ? 'delete' : 'edit') + " other people's announcements");
          if (!del && (body.priority === 'critical' || body.pinned === true || (('pinned' in body) && body.pinned !== item.pinned))) need(false, 'pin or mark announcements critical');
        }
      }

      if (col === 'maintenance' && seg[2] === 'complete' && method === 'POST') {
        const lid = clientId(body.logId);
        if (lid) { const ex = db.maintLog.find((x) => x.id === lid); if (ex) return ok({ item, log: ex }); }
        const met = meters(siteBundle(db, item.siteId), null, now)[item.machineId] || {};
        const log = {
          id: lid || uid('ml_'), siteId: item.siteId, maintId: item.id, machineId: item.machineId, title: item.title, category: item.category,
          dueAt: item.dueAt, dueReading: item.dueReading, basis: item.basis, doneAt: now, doneBy: user.name,
          readingTR: met.tr, readingRCC: met.rcc, notes: body.notes ? String(body.notes).slice(0, 2000) : null
        };
        db.maintLog.push(log);
        item.lastDoneAt = now; item.notified = {}; item.startAt = now;
        let recurring = false;
        if (isNum(item.intervalDays) && item.intervalDays > 0) { item.dueAt = now + item.intervalDays * DAY; recurring = true; }
        if (isNum(item.intervalHours) && item.intervalHours > 0 && item.basis !== 'none' && isNum(met[item.basis])) {
          item.startReading = met[item.basis]; item.dueReading = r2(met[item.basis] + item.intervalHours); recurring = true;
        }
        if (!recurring) item.status = 'done';
        mut();
        out.events.push({ type: 'change', siteId: item.siteId, col: 'maintenance', action: 'upsert', item });
        out.events.push({ type: 'change', siteId: item.siteId, col: 'maintLog', action: 'upsert', item: log });
        return ok({ item, log });
      }

      // live bucket counter on a loader: { delta: ±n } or { set: n }; opId makes a replayed offline click harmless
      if (col === 'machines' && seg[2] === 'buckets' && seg.length === 3 && method === 'POST') {
        if (!isLoader(item)) throw err(400, 'Bucket counting is only for loaders');
        const opId = typeof body.opId === 'string' && /^[a-z0-9_-]{6,40}$/i.test(body.opId) ? body.opId : null;
        const seen = item.bucketOps || [];
        if (opId && seen.includes(opId)) return ok(item);
        let next;
        if (body.set != null) { next = Number(body.set); if (!Number.isInteger(next) || next < 0 || next > 10000) throw err(400, 'Count must be a whole number from 0 to 10000'); }
        else { const d = Number(body.delta); if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100) throw err(400, 'Invalid bucket change'); next = Math.min(10000, Math.max(0, (item.bucketCount || 0) + d)); }
        item.bucketCount = next; item.bucketCountAt = now; item.bucketCountBy = user.name;
        if (opId) item.bucketOps = seen.concat(opId).slice(-30);
        mut();
        out.events.push({ type: 'change', siteId: item.siteId, col: 'machines', action: 'upsert', item });
        return ok(item);
      }

      if (method === 'PUT' && seg.length === 2) {
        const v = checkFields(col, clean(SCHEMA[col], body, true));
        Object.assign(item, v, { updatedAt: now, updatedBy: user.name });
        if (col === 'maintenance') {
          item.notified = {};
          if (body.reopen) item.status = 'open';
          const met = meters(siteBundle(db, item.siteId), null, now)[item.machineId];
          if ('basis' in v || 'dueReading' in v) item.startReading = item.basis !== 'none' && met ? met[item.basis] : null;
        }
        mut();
        if (col === 'machines' && Object.keys(v).some((k) => k !== 'status')) log('Changed machine', item.siteId, item.name + ': ' + Object.keys(v).join(', '));
        if (col === 'entries' && !own) log('Edited shift row', item.siteId, item.date + ' ' + item.shift + ' (logged by ' + (item.createdByName || '?') + ')');
        if (col === 'maintenance') log('Edited maintenance schedule', item.siteId, item.title);
        out.events.push({ type: 'change', siteId: item.siteId, col, action: 'upsert', item });
        if (col === 'entries' || col === 'maintenance' || col === 'machines') mergeOut(out, checkMaintenance(db, now));
        return ok(item);
      }
      if (method === 'DELETE' && seg.length === 2) {
        const label = { machines: 'machine', entries: 'shift row', maintenance: 'maintenance schedule', messages: 'chat message', announcements: 'announcement', operators: 'operator', telehuts: 'telehut' }[col];
        if (['machines', 'maintenance'].includes(col) || (col === 'entries' && !own) || (col === 'messages' && !own) || (col === 'announcements' && !own))
          log('Deleted ' + label, item.siteId, item.name || item.title || (item.date ? item.date + ' ' + item.shift : '') || (item.text || '').slice(0, 80));
        db[col] = db[col].filter((x) => x.id !== item.id);
        if (col === 'machines') {
          for (const c of ['entries', 'maintenance', 'maintLog']) db[c] = db[c].filter((x) => x.machineId !== item.id);
          out.events.push({ type: 'reload', siteId: item.siteId });
        }
        mut();
        out.events.push({ type: 'change', siteId: item.siteId, col, action: 'delete', id: item.id });
        return ok({ deleted: item.id });
      }
    }
    if (seg[0] === 'maintLog' && seg[1] && method === 'DELETE') {
      const l = db.maintLog.find((x) => x.id === seg[1]);
      if (!l) throw err(404, 'Not found');
      need(false, 'delete maintenance history');
      log('Deleted maintenance record', l.siteId, l.title + ' done ' + new Date(l.doneAt).toISOString());
      db.maintLog = db.maintLog.filter((x) => x !== l); mut();
      out.events.push({ type: 'change', siteId: l.siteId, col: 'maintLog', action: 'delete', id: l.id });
      return ok({ deleted: l.id });
    }

    // --- personal widgets (link collections) ---
    if (seg[0] === 'widgets') {
      const mine = () => db.widgets.filter((w) => w.userId === user.id).sort((a, b) => (a.order || 0) - (b.order || 0));
      const cleanW = (b) => {
        const w = {};
        if ('title' in b) { w.title = String(b.title || '').trim().slice(0, 60); if (!w.title) throw err(400, 'Widget needs a title'); }
        if ('color' in b) w.color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#A08C64';
        if ('icon' in b) w.icon = String(b.icon || 'link').slice(0, 20);
        if ('collapsed' in b) w.collapsed = !!b.collapsed;
        if ('order' in b) w.order = Number(b.order) || 0;
        if ('links' in b) {
          w.links = (Array.isArray(b.links) ? b.links : []).slice(0, 30).map((l) => {
            const url = normUrl(l.url);
            if (!url) throw err(400, 'Links must be http(s) addresses: ' + (l.url || '(empty)'));
            return { id: l.id || uid('l_'), label: String(l.label || '').trim().slice(0, 60) || url.replace(/^https?:\/\//, '').split('/')[0], url };
          });
        }
        return w;
      };
      if (seg.length === 1 && method === 'GET') return ok(mine());
      if (seg.length === 1 && method === 'POST') {
        const wid = clientId(body.id);
        if (wid) { const ex = db.widgets.find((x) => x.id === wid); if (ex) return ok(ex); }
        const w = Object.assign({ id: wid || uid('w_'), userId: user.id, color: '#A08C64', icon: 'link', links: [], order: mine().length, createdAt: now }, cleanW(body));
        if (!w.title) throw err(400, 'Widget needs a title');
        db.widgets.push(w); mut();
        out.events.push({ type: 'widgets', userId: user.id });
        return ok(w, 201);
      }
      const w = db.widgets.find((x) => x.id === seg[1] && x.userId === user.id);
      if (!w) throw err(404, 'Widget not found');
      if (method === 'PUT') { Object.assign(w, cleanW(body)); mut(); out.events.push({ type: 'widgets', userId: user.id }); return ok(w); }
      if (method === 'DELETE') { db.widgets = db.widgets.filter((x) => x !== w); mut(); out.events.push({ type: 'widgets', userId: user.id }); return ok({ deleted: w.id }); }
    }

    // --- notifications ---
    if (seg[0] === 'notifications') {
      const mine = db.notifications.filter((n) => n.userId === user.id);
      if (method === 'GET') return ok(mine.slice(-100).reverse());
      if (seg[1] === 'read' && method === 'POST') {
        const ids = Array.isArray(body.ids) ? body.ids : null;
        mine.forEach((n) => { if (!ids || ids.includes(n.id)) n.read = true; });
        mut(); return ok({ ok: true });
      }
      if (seg[1] === 'clear' && method === 'POST') {
        db.notifications = db.notifications.filter((n) => n.userId !== user.id); mut(); return ok({ ok: true });
      }
    }

    throw err(404, 'No route: ' + method + ' /' + seg.join('/'));
  }

  function clientId(v) { return typeof v === 'string' && /^[a-z]{1,3}_[a-z0-9]{6,32}$/.test(v) ? v : null; }

  function mergeOut(a, b) {
    a.events.push.apply(a.events, b.events);
    a.emails.push.apply(a.emails, b.emails);
    if (b.dirty) a.dirty = true;
  }

  return {
    VERSION, DAY, uid, r2, localDate, addDays, daysInMonth, emptyDB, migrate, MACHINE_STATUS, MACHINE_TYPES, isLoader, truckEq,
    DEFAULT_OWNERS, DEFAULT_SETTINGS, superEmails, isSuperEmail, audit, pub,
    computeSite, meters, analytics, maintStatus, checkMaintenance, seedDemo, handle, HttpError, normUrl
  };
});
