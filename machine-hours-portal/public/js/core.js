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

  const VERSION = '1.3.1';
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
      levels: [], bucketLogs: [], inventory: [], invLog: [],
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
    entryEditHours: 24,           // regular users may edit/delete their own shift rows for this many hours
    allowUserInventoryEdit: true  // regular users may add inventory items, receive stock and correct counts (picking is always allowed)
  };
  const SETTING_TYPES = { allowUserSiteCreate: 'bool', allowUserListEdit: 'bool', allowUserMaintEdit: 'bool', allowUserMaintCreate: 'bool', entryEditHours: 'num', allowUserInventoryEdit: 'bool' };
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
  /*
   * Shift clock for bucket counting: Day 06:00–18:00 GMT, Night 18:00–06:00 GMT.
   * A night shift belongs to the date it started on (00:30 on the 1st is the Night shift of the 31st).
   */
  const SHIFT_START_HOUR_GMT = 6, SHIFT_LENGTH_H = 12;
  function shiftAt(ms) {
    const t = new Date(ms == null ? Date.now() : ms);
    const h = t.getUTCHours();
    const day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    let start, shift;
    if (h >= SHIFT_START_HOUR_GMT && h < SHIFT_START_HOUR_GMT + SHIFT_LENGTH_H) { shift = 'Day'; start = day + SHIFT_START_HOUR_GMT * 3600000; }
    else if (h >= SHIFT_START_HOUR_GMT + SHIFT_LENGTH_H) { shift = 'Night'; start = day + (SHIFT_START_HOUR_GMT + SHIFT_LENGTH_H) * 3600000; }
    else { shift = 'Night'; start = day - DAY + (SHIFT_START_HOUR_GMT + SHIFT_LENGTH_H) * 3600000; }
    const date = new Date(start).toISOString().slice(0, 10);
    return { date, shift, key: date + '|' + shift, start, end: start + SHIFT_LENGTH_H * 3600000 };
  }
  /** The machine's live bucket count — 0 once its shift has ended. */
  function liveBuckets(m, now) { return m && m.bucketShiftKey === shiftAt(now).key ? (m.bucketCount || 0) : 0; }

  const SCHEMA = {
    levels: { name: 'str!' },
    bucketLogs: { level: 'str', buckets: 'num', note: 'text' },
    inventory: { name: 'str!', partNo: 'str', location: 'str', unit: 'str', minQty: 'num', notes: 'text' },
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
    if ((col === 'entries' || col === 'bucketLogs') && v.buckets != null && !(Number.isInteger(v.buckets) && v.buckets >= 0 && v.buckets <= 10000))
      throw err(400, 'Buckets must be a whole number from 0 to 10000');
    if (col === 'inventory' && v.minQty != null && !(v.minQty >= 0)) throw err(400, 'Minimum quantity cannot be negative');
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

  /* ---------------------------------------------------------- bucket logs */
  function newBucketLog(m, o) {
    return {
      id: o.id || uid('bl_'), siteId: m.siteId, machineId: m.id, level: o.level || null, buckets: o.buckets,
      perTruck: isNum(m.bucketsPerTruck) ? m.bucketsPerTruck : null, date: o.date, shift: o.shift, shiftKey: o.date + '|' + o.shift,
      auto: !!o.auto, createdBy: o.userId || null, createdByName: o.userName || 'System', createdAt: o.at
    };
  }
  /** At the end of a shift: save any count that was not saved (to the selected level) and reset the counter. */
  function rollBuckets(db, now) {
    now = now || Date.now();
    const out = { events: [], dirty: false };
    const cur = shiftAt(now).key;
    for (const m of db.machines) {
      if (!m.bucketShiftKey || m.bucketShiftKey === cur) continue;
      if ((m.bucketCount || 0) > 0) {
        const [date, shift] = m.bucketShiftKey.split('|');
        const log = newBucketLog(m, { level: m.bucketLevel, buckets: m.bucketCount, date, shift, auto: true, at: now });
        db.bucketLogs.push(log);
        out.events.push({ type: 'change', siteId: m.siteId, col: 'bucketLogs', action: 'upsert', item: log });
      }
      m.bucketCount = 0; m.bucketShiftKey = null; out.dirty = true;
      out.events.push({ type: 'change', siteId: m.siteId, col: 'machines', action: 'upsert', item: m });
    }
    return out;
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
    ['420', '445', '470', '495'].forEach((n) => db.levels.push({ id: uid('lv_'), siteId, name: n, createdAt: t0 }));
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
    // sample bucket counts per level for the last few shifts, and a small parts store
    const lv = ['420', '445', '470'];
    for (let d = 3; d >= 1; d--) {
      const sh = shiftAt(now - d * 12 * 3600000);
      [L6, L9].forEach((m, i) => lv.slice(i, i + 2).forEach((level, j) => db.bucketLogs.push(newBucketLog(m, {
        level, buckets: 8 + ((d * 7 + i * 5 + j * 3) % 9), date: sh.date, shift: sh.shift, userId, userName: ops[(d + i + j) % ops.length], at: sh.start + (4 + j * 3) * 3600000
      }))));
    }
    const inv = [['Bucket teeth (LH517)', 'BT-517-01', 'Workshop store A3', 'pcs', 24, 8], ['Hydraulic hose 3/4"', 'HH-075', 'Workshop store B1', 'm', 60, 20],
      ['Engine oil 15W-40', 'OIL-1540', 'Lube bay', 'L', 180, 100], ['Air filter element', 'AF-2230', 'Workshop store A1', 'pcs', 3, 4],
      ['Tyre valve kit', 'TV-KIT', 'Tyre bay', 'kits', 10, 2], ['Remote control battery', 'RC-BAT', 'Telehut 1 cabinet', 'pcs', 6, 4]];
    inv.forEach(([name, partNo, location, unit, q, minQty]) => {
      const it = { id: uid('iv_'), siteId, name, partNo, location, unit, minQty, quantity: q, notes: null, createdBy: userId, createdAt: t0 };
      db.inventory.push(it);
      db.invLog.push({ id: uid('il_'), siteId, itemId: it.id, itemName: name, location, kind: 'receive', change: q, qtyAfter: q, note: 'Opening stock', machineId: null, userId, by: 'Workshop', at: t0 });
    });
    const pick = (name, q, m, d) => { const it = db.inventory.find((x) => x.siteId === siteId && x.name === name); it.quantity = r2(it.quantity - q);
      db.invLog.push({ id: uid('il_'), siteId, itemId: it.id, itemName: name, location: it.location, kind: 'pick', change: -q, qtyAfter: it.quantity, note: null, machineId: m.id, userId, by: ops[d % ops.length], at: now - d * 3600000 }); };
    pick('Bucket teeth (LH517)', 4, L6, 30); pick('Hydraulic hose 3/4"', 6, L9, 20); pick('Engine oil 15W-40', 40, L11, 8);
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
        for (const c of ['machines', 'operators', 'telehuts', 'entries', 'maintenance', 'maintLog', 'messages', 'announcements', 'notifications', 'levels', 'bucketLogs', 'inventory', 'invLog'])
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
          levels: f('levels'), bucketLogs: f('bucketLogs'), inventory: f('inventory'), invLog: f('invLog').slice(-3000),
          members: (s.members || []).map((id) => db.users.find((u) => u.id === id)).filter(Boolean).map(pub)
        });
      }
      // create in a site collection
      const col = seg[2];
      if (SCHEMA[col] && seg.length === 3 && method === 'POST') {
        if (col === 'machines') need(false, 'add machines');
        if (col === 'operators' || col === 'telehuts' || col === 'levels') need(S.allowUserListEdit, 'change the ' + col + ' list');
        if (col === 'maintenance') need(S.allowUserMaintCreate, 'schedule maintenance');
        if (col === 'inventory') need(S.allowUserInventoryEdit !== false, 'add inventory items');
        if (col === 'bucketLogs') throw err(400, 'Bucket counts are saved with the Save button on the loader card');
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
        if ((col === 'operators' || col === 'telehuts' || col === 'levels') && db[col].some((x) => x.siteId === s.id && x.name.toLowerCase() === item.name.toLowerCase()))
          throw err(409, item.name + ' already exists');
        if (col === 'inventory') {
          const loc = (item.location || '').toLowerCase();
          if (db.inventory.some((x) => x.siteId === s.id && x.name.toLowerCase() === item.name.toLowerCase() && (x.location || '').toLowerCase() === loc))
            throw err(409, item.name + (item.location ? ' at ' + item.location : '') + ' already exists — use Receive to add stock');
          const q = body.quantity == null || body.quantity === '' ? 0 : Number(body.quantity);
          if (!(q >= 0) || q > 1e7) throw err(400, 'Quantity must be 0 or more');
          item.quantity = q;
          if (q > 0) {
            const lg = { id: uid('il_'), siteId: s.id, itemId: item.id, itemName: item.name, location: item.location || null, kind: 'receive', change: q, qtyAfter: q, note: 'Opening stock', machineId: null, userId: user.id, by: user.name, at: now };
            db.invLog.push(lg);
            out.events.push({ type: 'change', siteId: s.id, col: 'invLog', action: 'upsert', item: lg });
          }
        }
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
        if (col === 'operators' || col === 'telehuts' || col === 'levels') need(S.allowUserListEdit, 'change the ' + col + ' list');
        if (col === 'entries' || col === 'bucketLogs') need(own && recent, (del ? 'delete' : 'edit') + ' this row (you can change your own rows for ' + S.entryEditHours + ' h)');
        if (col === 'inventory') need(!del && S.allowUserInventoryEdit !== false, del ? 'delete inventory items' : 'edit inventory items');
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
      if (col === 'machines' && seg[2] === 'buckets' && method === 'POST' && (seg.length === 3 || (seg.length === 4 && seg[3] === 'save'))) {
        if (!isLoader(item)) throw err(400, 'Bucket counting is only for loaders');
        const roll = rollBuckets(db, now); // a finished shift's count is saved and cleared first
        if (roll.dirty) { mut(); out.events.push(...roll.events); }
        const cur = shiftAt(now);
        const levelOk = (name) => db.levels.some((l) => l.siteId === item.siteId && l.name === name);
        if (seg[3] === 'save') {
          // save the counted buckets for a mine level, then start again from 0
          const lid = clientId(body.id);
          if (lid) { const ex = db.bucketLogs.find((x) => x.id === lid); if (ex) return ok({ machine: item, log: ex }); }
          const level = body.level != null ? String(body.level) : item.bucketLevel;
          if (!level) throw err(400, 'Choose the mine level first');
          if (!levelOk(level)) throw err(400, 'Unknown level: ' + level);
          const n = liveBuckets(item, now);
          if (!n) throw err(400, 'Nothing to save — the count is 0');
          const log = newBucketLog(item, { id: lid, level, buckets: n, date: cur.date, shift: cur.shift, userId: user.id, userName: user.name, at: now });
          db.bucketLogs.push(log);
          item.bucketCount = 0; item.bucketLevel = level; item.bucketShiftKey = cur.key; item.bucketCountAt = now; item.bucketCountBy = user.name;
          mut();
          out.events.push({ type: 'change', siteId: item.siteId, col: 'bucketLogs', action: 'upsert', item: log });
          out.events.push({ type: 'change', siteId: item.siteId, col: 'machines', action: 'upsert', item });
          return ok({ machine: item, log });
        }
        if ('level' in body && body.delta == null && body.set == null) {
          const level = body.level ? String(body.level) : null;
          if (level && !levelOk(level)) throw err(400, 'Unknown level: ' + level);
          item.bucketLevel = level; mut();
          out.events.push({ type: 'change', siteId: item.siteId, col: 'machines', action: 'upsert', item });
          return ok(item);
        }
        const opId = typeof body.opId === 'string' && /^[a-z0-9_-]{6,40}$/i.test(body.opId) ? body.opId : null;
        const seen = item.bucketOps || [];
        if (opId && seen.includes(opId)) return ok(item);
        if (item.bucketShiftKey !== cur.key) { item.bucketCount = 0; item.bucketShiftKey = cur.key; }
        let next;
        if (body.set != null) { next = Number(body.set); if (!Number.isInteger(next) || next < 0 || next > 10000) throw err(400, 'Count must be a whole number from 0 to 10000'); }
        else { const d = Number(body.delta); if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100) throw err(400, 'Invalid bucket change'); next = Math.min(10000, Math.max(0, (item.bucketCount || 0) + d)); }
        item.bucketCount = next; item.bucketCountAt = now; item.bucketCountBy = user.name;
        if (opId) item.bucketOps = seen.concat(opId).slice(-30);
        mut();
        out.events.push({ type: 'change', siteId: item.siteId, col: 'machines', action: 'upsert', item });
        return ok(item);
      }

      // inventory stock: pick (take out), receive (put in), count (set the counted quantity)
      if (col === 'inventory' && seg[2] === 'move' && seg.length === 3 && method === 'POST') {
        const lid = clientId(body.id);
        if (lid) { const ex = db.invLog.find((x) => x.id === lid); if (ex) return ok({ item, log: ex }); }
        const kind = String(body.kind || '');
        if (!['pick', 'receive', 'count'].includes(kind)) throw err(400, 'Unknown stock change');
        if (kind !== 'pick') need(S.allowUserInventoryEdit !== false, kind === 'receive' ? 'receive stock' : 'correct stock counts');
        const q = Number(body.qty);
        if (!isFinite(q) || q < 0 || q > 1e7 || (kind !== 'count' && q === 0)) throw err(400, 'Enter a quantity' + (kind === 'count' ? ' of 0 or more' : ' above 0'));
        const before = item.quantity || 0;
        let change;
        if (kind === 'pick') {
          if (q > before + 1e-9) throw err(409, 'Only ' + r2(before) + (item.unit ? ' ' + item.unit : '') + ' of ' + item.name + ' left' + (item.location ? ' at ' + item.location : ''));
          change = -q;
        } else if (kind === 'receive') change = q;
        else change = q - before;
        const machineId = body.machineId && db.machines.some((m) => m.id === body.machineId && m.siteId === item.siteId) ? body.machineId : null;
        item.quantity = r2(before + change); item.updatedAt = now; item.updatedBy = user.name;
        const lg = { id: lid || uid('il_'), siteId: item.siteId, itemId: item.id, itemName: item.name, location: item.location || null, kind, change: r2(change), qtyAfter: item.quantity,
          note: body.note ? String(body.note).trim().slice(0, 500) || null : null, machineId, userId: user.id, by: user.name, at: now };
        if (isNum(body.clientAt) && body.clientAt < now && now - body.clientAt < 30 * DAY) lg.loggedOfflineAt = body.clientAt;
        db.invLog.push(lg); mut();
        if (kind === 'count') log('Corrected stock count', item.siteId, item.name + ': ' + r2(before) + ' → ' + item.quantity);
        out.events.push({ type: 'change', siteId: item.siteId, col: 'inventory', action: 'upsert', item });
        out.events.push({ type: 'change', siteId: item.siteId, col: 'invLog', action: 'upsert', item: lg });
        return ok({ item, log: lg });
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
        const label = { inventory: 'inventory item', bucketLogs: 'bucket count', levels: 'level', machines: 'machine', entries: 'shift row', maintenance: 'maintenance schedule', messages: 'chat message', announcements: 'announcement', operators: 'operator', telehuts: 'telehut' }[col];
        if (['machines', 'maintenance', 'inventory'].includes(col) || ((col === 'entries' || col === 'bucketLogs') && !own) || (col === 'messages' && !own) || (col === 'announcements' && !own))
          log('Deleted ' + label, item.siteId, item.name || item.title || (item.date ? item.date + ' ' + item.shift : '') || (item.text || '').slice(0, 80));
        db[col] = db[col].filter((x) => x.id !== item.id);
        if (col === 'machines') {
          for (const c of ['entries', 'maintenance', 'maintLog', 'bucketLogs']) db[c] = db[c].filter((x) => x.machineId !== item.id);
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
    VERSION, DAY, uid, r2, localDate, addDays, daysInMonth, emptyDB, migrate, MACHINE_STATUS, MACHINE_TYPES, isLoader, truckEq, shiftAt, liveBuckets, rollBuckets,
    DEFAULT_OWNERS, DEFAULT_SETTINGS, superEmails, isSuperEmail, audit, pub,
    computeSite, meters, analytics, maintStatus, checkMaintenance, seedDemo, handle, HttpError, normUrl
  };
});
