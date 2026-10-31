/*
 * SharePoint Online storage for the Machine Hours Portal (Microsoft Graph, app-only).
 *
 * How it works
 *  - The server keeps working from an in-memory copy (and data/db.json as an offline cache).
 *  - After every change, `schedule()` diffs the data against what is known to be in SharePoint
 *    and sends only the creates/updates/deletes (Graph $batch, 20 per call, with retry).
 *  - Every few minutes `pull()` re-reads the lists so edits made directly in SharePoint
 *    (or by another server) show up in the app.
 *  - If SharePoint is unreachable the app keeps running; pending changes are sent when it is back.
 *
 * Security data (sessions, superuser passwords/roles), notifications and app settings stay on the
 * server and are never written to SharePoint.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const Core = require('../public/js/core.js');
const { LISTS, listName, toFields, fromFields } = require('./sp-schema.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

function columnDef(name, type, indexed) {
  const c = { name };
  if (type === 'text') c.text = { maxLength: 255 };
  else if (type === 'note') c.text = { allowMultipleLines: true, linesForEditing: 6 };
  else if (type === 'number') c.number = {};
  else if (type === 'boolean') c.boolean = {};
  else if (type === 'dateTime') c.dateTime = { format: 'dateTime' };
  if (indexed) c.indexed = true;
  return c;
}
function allColumns(l) {
  return [['AppId', 'text', null, { indexed: true }], ['AppJson', 'note']].concat(l.cols);
}
/** canonical string of the fields we own — used to detect real differences */
function canon(l, f) {
  const out = [String(f.Title || ''), f.AppId || '', f.AppJson || ''];
  for (const [name, type] of l.cols) {
    let v = f[name];
    if (v === undefined || v === '') v = null;
    if (v != null) {
      if (type === 'dateTime') v = Math.floor(Date.parse(v) / 1000);
      else if (type === 'number') v = Math.round(Number(v) * 1000) / 1000;
      else if (type === 'boolean') v = !!v;
      else v = String(v).replace(/\r\n/g, '\n');
    }
    out.push(v);
  }
  return sha(JSON.stringify(out));
}

class SharePointStore {
  constructor(o) {
    this.o = Object.assign({ prefix: 'MHP_', graphBase: 'https://graph.microsoft.com/v1.0', loginBase: 'https://login.microsoftonline.com', log: console }, o);
    this.log = this.o.log;
    this.state = { siteId: null, lists: {}, map: {}, snap: {}, covers: {} };
    this.status = { mode: 'sharepoint', siteUrl: o.siteUrl, connected: false, lastPull: null, lastFlush: null, pending: 0, lastError: null, lastErrorAt: null, flushes: 0 };
    this._chain = Promise.resolve();
    this._timer = null;
    this.loadState();
  }

  /* ---------------- state file (ids + hashes of what is in SharePoint) ---------------- */
  loadState() {
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(this.o.stateFile, 'utf8'))); } catch (e) { /* first run */ }
    for (const l of LISTS) { this.state.map[l.key] = this.state.map[l.key] || {}; this.state.snap[l.key] = this.state.snap[l.key] || {}; }
  }
  saveState() {
    if (!this.o.stateFile) return;
    const tmp = this.o.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.o.stateFile);
  }
  stop() { clearTimeout(this._timer); clearTimeout(this._retry); this._stopped = true; }
  get hasState() { return Object.values(this.state.map).some((m) => Object.keys(m).length > 0); }

  /* ---------------- Graph plumbing ---------------- */
  async token() {
    if (this._tok && this._tok.exp > Date.now() + 60000) return this._tok.value;
    const r = await fetch(this.o.loginBase + '/' + encodeURIComponent(this.o.tenantId) + '/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error('Microsoft sign-in failed: ' + (j.error_description || j.error || r.status));
    this._tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return this._tok.value;
  }
  async g(method, url, body, extra) {
    extra = extra || {};
    const full = /^https?:/.test(url) ? url : this.o.graphBase + url;
    for (let attempt = 0; ; attempt++) {
      const headers = Object.assign({ Authorization: 'Bearer ' + (await this.token()) }, extra.headers || {});
      let payload = body;
      if (body !== undefined && !Buffer.isBuffer(body)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      let r;
      try { r = await fetch(full, { method, headers, body: payload }); }
      catch (e) { if (attempt < 3) { await sleep(1000 * 2 ** attempt); continue; } throw new Error('Cannot reach Microsoft Graph: ' + e.message); }
      if ((r.status === 429 || r.status === 503 || r.status === 504) && attempt < 5) {
        const wait = Number(r.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
        await sleep(Math.min(wait, 30000)); continue;
      }
      if (r.status === 401 && attempt === 0) { this._tok = null; continue; }
      if (extra.raw) return r;
      const text = await r.text();
      let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = text; }
      if (!r.ok) {
        const e = new Error('Graph ' + method + ' ' + url.split('?')[0] + ' → ' + r.status + ' ' + ((j && j.error && j.error.message) || ''));
        e.status = r.status; throw e;
      }
      return j;
    }
  }
  async pages(url) {
    const out = [];
    let next = url;
    while (next) { const j = await this.g('GET', next); out.push(...(j.value || [])); next = j['@odata.nextLink'] || null; }
    return out;
  }
  /** run up to 20 sub-requests per $batch; returns responses by id */
  async batch(reqs) {
    const res = {};
    for (let i = 0; i < reqs.length; i += 20) {
      const chunk = reqs.slice(i, i + 20);
      const j = await this.g('POST', '/$batch', { requests: chunk.map((r) => ({ id: r.id, method: r.method, url: r.url, body: r.body, headers: r.body ? { 'Content-Type': 'application/json' } : undefined })) });
      for (const x of (j && j.responses) || []) res[x.id] = x;
    }
    return res;
  }

  /* ---------------- site + lists ---------------- */
  async resolveSite() {
    if (this.o.siteId) { this.state.siteId = this.o.siteId; return this.o.siteId; }
    const u = new URL(this.o.siteUrl);
    const j = await this.g('GET', '/sites/' + u.hostname + ':' + (u.pathname.replace(/\/$/, '') || '/'));
    this.state.siteId = j.id;
    return j.id;
  }
  /** Find (and optionally create) every list and column. Returns a report. */
  async ensureLists(create) {
    const sid = await this.resolveSite();
    const existing = await this.pages('/sites/' + sid + '/lists?$select=id,displayName,name&$top=999');
    const report = [];
    for (const l of LISTS) {
      const name = listName(this.o.prefix, l);
      let list = existing.find((x) => x.displayName === name || x.name === name);
      if (!list && create) {
        list = await this.g('POST', '/sites/' + sid + '/lists', {
          displayName: name, description: 'Machine Hours Portal — ' + l.desc,
          columns: allColumns(l).map(([n, t, , o]) => columnDef(n, t, o && o.indexed)), list: { template: 'genericList' }
        });
        report.push({ list: name, action: 'created', columns: allColumns(l).length, optional: !!l.optional });
      } else if (list) {
        const cols = await this.pages('/sites/' + sid + '/lists/' + list.id + '/columns?$select=name&$top=999');
        const have = new Set(cols.map((c) => c.name));
        const missing = allColumns(l).filter(([n]) => !have.has(n));
        if (missing.length && create) for (const [n, t, , o] of missing) await this.g('POST', '/sites/' + sid + '/lists/' + list.id + '/columns', columnDef(n, t, o && o.indexed));
        report.push({ list: name, action: missing.length ? (create ? 'added ' + missing.length + ' columns' : 'MISSING columns: ' + missing.map((m) => m[0]).join(', ')) : 'ok', optional: !!l.optional });
      } else report.push({ list: name, action: 'MISSING', optional: !!l.optional });
      if (list) this.state.lists[l.key] = list.id;
    }
    this.saveState();
    return report;
  }

  /* ---------------- context for computed columns ---------------- */
  ctx(db) {
    const sites = {}, machines = {}, users = {}, rows = {}, mstat = {};
    db.sites.forEach((s) => (sites[s.id] = s.name));
    db.machines.forEach((m) => (machines[m.id] = m.name));
    db.users.forEach((u) => (users[u.id] = u.name));
    const now = Date.now();
    for (const s of db.sites) {
      const b = { site: s, machines: db.machines.filter((m) => m.siteId === s.id), entries: db.entries.filter((e) => e.siteId === s.id) };
      const comp = Core.computeSite(b);
      comp.rows.forEach((r) => (rows[r.id] = r));
      const met = Core.meters(b, comp, now);
      db.maintenance.filter((m) => m.siteId === s.id).forEach((m) => (mstat[m.id] = Core.maintStatus(m, met[m.machineId], s, now).status));
    }
    const label = { ok: 'On track', soon: 'Due soon', overdue: 'Overdue', done: 'Completed' };
    return {
      siteName: (id) => sites[id] || '', machineName: (id) => machines[id] || (id ? '(removed)' : ''), userName: (id) => users[id] || '',
      row: (id, k) => (rows[id] ? rows[id][k] : null),
      check: (id) => { const r = rows[id]; if (!r) return null; return !r.valid ? '✗ ' + r.issues.join(', ') : r.warnings.length ? '⚠ ' + r.warnings.join(', ') : 'OK'; },
      maintStatus: (m) => label[mstat[m.id]] || null,
      isSuper: (email) => Core.isSuperEmail(db, email, this.o.owners)
    };
  }

  /* ---------------- push local changes ---------------- */
  schedule(db, delay) {
    if (this._stopped) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(db).catch(() => {}), delay == null ? 1500 : delay);
  }
  flush(db) {
    this._chain = this._chain.then(() => this._flush(db)).catch((e) => this.fail(e));
    return this._chain;
  }
  fail(e) {
    this.status.connected = false;
    this.status.lastError = e.message; this.status.lastErrorAt = Date.now();
    this.log.error('[SharePoint] ' + e.message);
    // retry later
    clearTimeout(this._retry);
    if (this._stopped) return;
    this._retry = setTimeout(() => this.flush(this._db).catch(() => {}), 30000);
  }
  async _flush(db) {
    this._db = db;
    const sid = this.state.siteId || (await this.resolveSite());
    if (LISTS.some((l) => !this.state.lists[l.key])) await this.ensureLists(false);
    const ctx = this.ctx(db);
    const reqs = [], meta = {};
    let n = 0;
    for (const l of LISTS) {
      const lid = this.state.lists[l.key];
      if (!lid) continue;
      const map = this.state.map[l.key], snap = this.state.snap[l.key];
      const seen = new Set();
      for (const item of db[l.key] || []) {
        if (!item || !item.id) continue;
        seen.add(item.id);
        const f = toFields(l, item, ctx);
        const h = canon(l, f);
        if (snap[item.id] === h) continue;
        const id = 'r' + n++;
        if (map[item.id]) {
          reqs.push({ id, method: 'PATCH', url: '/sites/' + sid + '/lists/' + lid + '/items/' + map[item.id] + '/fields', body: f });
        } else {
          const c = {}; for (const k of Object.keys(f)) if (f[k] != null) c[k] = f[k];
          reqs.push({ id, method: 'POST', url: '/sites/' + sid + '/lists/' + lid + '/items', body: { fields: c } });
        }
        meta[id] = { l, appId: item.id, h };
      }
      for (const appId of Object.keys(map)) {
        if (seen.has(appId)) continue;
        const id = 'r' + n++;
        reqs.push({ id, method: 'DELETE', url: '/sites/' + sid + '/lists/' + lid + '/items/' + map[appId] });
        meta[id] = { l, appId, del: true };
      }
    }
    this.status.pending = reqs.length;
    let failed = 0;
    if (reqs.length) {
      const res = await this.batch(reqs);
      for (const r of reqs) {
        const x = res[r.id], m = meta[r.id];
        const st = x ? x.status : 0;
        const map = this.state.map[m.l.key], snap = this.state.snap[m.l.key];
        if (m.del) {
          if ((st >= 200 && st < 300) || st === 404) { delete map[m.appId]; delete snap[m.appId]; } else failed++;
        } else if (st >= 200 && st < 300) {
          if (r.method === 'POST' && x.body && x.body.id) map[m.appId] = x.body.id;
          snap[m.appId] = m.h;
        } else if (st === 404 && r.method === 'PATCH') { delete map[m.appId]; delete snap[m.appId]; failed++; } // deleted in SharePoint → re-create next time
        else { failed++; if (x && x.body && x.body.error) this.status.lastError = m.l.name + ': ' + x.body.error.message; }
      }
    }
    await this.syncCovers(db, sid);
    this.saveState();
    this.status.pending = failed;
    this.status.lastFlush = Date.now(); this.status.flushes++;
    this.status.connected = true;
    if (!failed) this.status.lastError = null;
    if (failed) { this.status.lastErrorAt = Date.now(); clearTimeout(this._retry); this._retry = setTimeout(() => this.flush(db).catch(() => {}), 30000); }
    return { sent: reqs.length, failed };
  }

  async syncCovers(db, sid) {
    for (const s of db.sites) {
      const h = s.coverImage ? sha(s.coverImage) : null;
      if ((this.state.covers[s.id] || null) === h) continue;
      const path = '/sites/' + sid + '/drive/root:/MachineHoursPortal/covers/' + s.id + '.jpg:';
      try {
        if (h) {
          const buf = Buffer.from(s.coverImage.split(',')[1] || '', 'base64');
          await this.g('PUT', path + '/content', buf, { headers: { 'Content-Type': 'image/jpeg' } });
        } else await this.g('DELETE', path).catch((e) => { if (e.status !== 404) throw e; });
        this.state.covers[s.id] = h;
      } catch (e) { this.status.lastError = 'Cover photo: ' + e.message; }
    }
    for (const id of Object.keys(this.state.covers)) {
      if (db.sites.some((s) => s.id === id)) continue;
      try { await this.g('DELETE', '/sites/' + sid + '/drive/root:/MachineHoursPortal/covers/' + id + '.jpg:'); } catch (e) { /* ignore */ }
      delete this.state.covers[id];
    }
  }

  /* ---------------- read SharePoint ---------------- */
  async readAll() {
    const sid = this.state.siteId || (await this.resolveSite());
    if (LISTS.some((l) => !this.state.lists[l.key])) await this.ensureLists(false);
    const data = {};
    for (const l of LISTS) {
      const lid = this.state.lists[l.key];
      if (!lid && l.optional) { data[l.key] = null; continue; } // not created yet: these records stay on the server
      if (!lid) throw new Error('SharePoint list ' + listName(this.o.prefix, l) + ' is missing. Run: node scripts/sharepoint-setup.js --create');
      data[l.key] = await this.pages('/sites/' + sid + '/lists/' + lid + '/items?$expand=fields&$top=999');
    }
    return data;
  }
  /** Replace the synced collections in db with what is in SharePoint. Returns true if anything changed. */
  async apply(db, data) {
    const map = {}, snap = {}, next = {};
    const prefixes = { sites: 's_', machines: 'm_', operators: 'o_', telehuts: 't_', entries: 'e_', maintenance: 'mt_', maintLog: 'ml_', announcements: 'a_', messages: 'c_', users: 'u_', widgets: 'w_', audit: 'au_', levels: 'lv_', bucketLogs: 'bl_', inventory: 'iv_', invLog: 'il_' };
    for (const l of LISTS) {
      if (data[l.key] == null) { map[l.key] = this.state.map[l.key] || {}; snap[l.key] = this.state.snap[l.key] || {}; next[l.key] = db[l.key] || []; continue; }
      map[l.key] = {}; snap[l.key] = {}; next[l.key] = [];
      for (const it of data[l.key]) {
        const f = it.fields || {};
        const { item, fresh } = fromFields(l, f);
        if (!item.id) item.id = f.AppId || Core.uid(prefixes[l.key]);
        if (map[l.key][item.id]) continue; // duplicate AppId — keep the first
        if (fresh) { item.createdAt = item.createdAt || Date.now(); if (l.key === 'machines' && item.active == null) item.active = true; }
        map[l.key][item.id] = it.id;
        if (!fresh) snap[l.key][item.id] = canon(l, f); // fresh rows get their AppId/AppJson written on next flush
        next[l.key].push(item);
      }
    }
    // keep cover photos we already have; download missing ones
    const sid = this.state.siteId;
    for (const s of next.sites) {
      const old = db.sites.find((x) => x.id === s.id);
      if (old && old.coverImage) { s.coverImage = old.coverImage; continue; }
      const f = (data.sites.find((x) => (x.fields || {}).AppId === s.id) || {}).fields || {};
      if (!f.CoverFile) continue;
      try {
        const r = await this.g('GET', '/sites/' + sid + '/drive/root:/MachineHoursPortal/covers/' + s.id + '.jpg:/content', undefined, { raw: true });
        if (r.ok) { s.coverImage = 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); this.state.covers[s.id] = sha(s.coverImage); }
      } catch (e) { /* keep going without the photo */ }
    }
    let changed = false;
    for (const l of LISTS) {
      if (JSON.stringify(db[l.key]) !== JSON.stringify(next[l.key])) changed = true;
      db[l.key] = next[l.key];
    }
    this.state.map = map; this.state.snap = snap;
    this.saveState();
    this.status.lastPull = Date.now(); this.status.connected = true;
    return changed;
  }

  /**
   * Start-up: send changes made while offline, then load SharePoint.
   * First connection to empty lists uploads the local data (migration).
   */
  async start(db) {
    await this.resolveSite();
    const report = await this.ensureLists(!!this.o.createLists);
    const missing = report.filter((r) => /MISSING/.test(r.action) && !r.optional);
    const later = report.filter((r) => /MISSING/.test(r.action) && r.optional);
    if (later.length) this.log.log('[SharePoint] not yet created (kept on this server until they are): ' + later.map((m) => m.list).join(', '));
    if (missing.length) throw new Error('SharePoint lists/columns missing: ' + missing.map((m) => m.list + ' (' + m.action + ')').join('; ') + '. Run: node scripts/sharepoint-setup.js --create  (or sharepoint/create-lists.ps1)');
    if (this.hasState) await this._flush(db);
    const data = await this.readAll();
    const spEmpty = LISTS.every((l) => !data[l.key] || data[l.key].length === 0);
    const localHas = LISTS.some((l) => (db[l.key] || []).length > 0);
    if (spEmpty && localHas) {
      this.log.log('[SharePoint] lists are empty — uploading the local data');
      for (const l of LISTS) { this.state.map[l.key] = {}; this.state.snap[l.key] = {}; }
      const r = await this._flush(db);
      this.log.log('[SharePoint] uploaded ' + r.sent + ' records' + (r.failed ? ', ' + r.failed + ' failed (will retry)' : ''));
      return { migrated: r.sent };
    }
    await this.apply(db, data);
    return { loaded: LISTS.reduce((a, l) => a + (data[l.key] ? data[l.key].length : 0), 0) };
  }

  /** Periodic refresh. `revFn()` returns the server's change counter. */
  async pull(db, revFn) {
    if (this.status.pending) return false;
    const rev = revFn();
    await this.flush(db);
    const data = await this.readAll();
    if (revFn() !== rev) return false; // someone changed data meanwhile — try next round
    return this.apply(db, data);
  }
}

module.exports = { SharePointStore, LISTS, columnDef, allColumns };
