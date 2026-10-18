/*
 * API client. Talks to the Node server when it is reachable ("server" mode).
 * If the page is opened without the server (file:// or static hosting) it
 * falls back to "local" demo mode: same logic (Core.handle) with data kept
 * in this browser's localStorage and live updates across tabs.
 */
(function () {
  'use strict';
  const LS_DB = 'mhp.localdb.v1', LS_TOKEN = 'mhp.token', LS_LOCALUSER = 'mhp.localUser';
  const LS_OUTBOX = 'mhp.outbox.v1', LS_CACHE = 'mhp.cache.', LS_SERVER = 'mhp.serverSeen', LS_PROBLEMS = 'mhp.syncProblems';
  // reads that are kept on the device so the app opens and works without a connection
  const CACHEABLE = /^(bootstrap|notifications|widgets|sites\/[^/]+\/data)$/;
  // writes that can be queued while offline (the rest need a connection)
  const OFFLINE_OK = /^(sites\/[^/]+\/(entries|messages|announcements|maintenance|operators|telehuts)|(entries|messages|announcements|maintenance|machines|operators|telehuts)\/[^/]+(\/complete)?|widgets(\/[^/]+)?|notifications\/(read|clear))$/;
  const netErr = (m) => Object.assign(new Error(m || 'No connection'), { network: true });
  const listeners = new Set();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  const API = {
    mode: null,
    token: store.get(LS_TOKEN),
    online: true,
    store,

    offline: false,
    outbox: (() => { try { return JSON.parse(store.get(LS_OUTBOX) || '[]'); } catch (e) { return []; } })(),

    async init() {
      if (location.protocol === 'file:') { this.mode = 'local'; return this.initLocal(); }
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.mode === 'server') { this.mode = 'server'; store.set(LS_SERVER, '1'); this.startSyncLoop(); return; }
      } catch (e) {
        // no connection, but this device has used the server before → open from the device copy
        if (store.get(LS_SERVER)) { this.mode = 'server'; this.setOffline(true); this.startSyncLoop(); return; }
      }
      this.mode = 'local';
      this.initLocal();
    },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(ev) { listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } }); },

    get signedIn() { return this.mode === 'local' ? !!store.get(LS_LOCALUSER) : !!this.token; },

    /** one request to the server; throws {network:true} when there is no connection */
    async net(method, path, body) {
      let r;
      try {
        r = await fetch('api/' + path.replace(/^\//, ''), {
          method, cache: 'no-store',
          headers: Object.assign({ 'Content-Type': 'application/json' }, this.token ? { Authorization: 'Bearer ' + this.token } : {}),
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (e) { throw netErr(); }
      if (r.status === 502 || r.status === 503 || r.status === 504) throw netErr('Server unreachable');
      let data = null;
      try { data = await r.json(); } catch (e) { /* empty */ }
      if (r.status === 401 && !/^auth\//.test(path)) { this.signOutLocal(); this.emit({ type: 'signedout' }); }
      if (!r.ok) { const e = new Error((data && data.error) || ('Request failed (' + r.status + ')')); e.status = r.status; e.data = data; throw e; }
      return data;
    },
    async call(method, path, body) {
      if (this.mode === 'local') return this.localCall(method, path, body);
      path = path.replace(/^\//, '');
      if (method === 'GET') {
        try {
          const data = await this.net(method, path);
          if (CACHEABLE.test(path)) this.cacheSet(path, data);
          // keep the cached site list in step with sites opened on this device
          if (/^sites\/[^/]+\/data$/.test(path) && data && data.site) {
            const b = this.cacheGet('bootstrap');
            if (b) { const i = b.sites.findIndex((x) => x.id === data.site.id); if (i >= 0) b.sites[i] = data.site; else b.sites.push(data.site); this.cacheSet('bootstrap', b); }
          }
          if (this.offline) { this.setOffline(false); this.flush(); }
          return data;
        } catch (e) {
          if (!e.network) throw e;
          this.setOffline(true);
          const c = this.cacheGet(path);
          if (c !== null) return c;
          throw Object.assign(new Error("You're offline and this page hasn't been opened on this device before"), { offline: true });
        }
      }
      const canQueue = OFFLINE_OK.test(path);
      // keep the order: while anything is waiting, new changes join the queue
      if (canQueue && (this.offline || this.outbox.length)) return this.enqueue(method, path, body);
      try {
        return await this.net(method, path, body);
      } catch (e) {
        if (!e.network) throw e;
        this.setOffline(true);
        if (canQueue) return this.enqueue(method, path, body);
        throw Object.assign(new Error("You're offline — this needs a connection. Try again when you're back online."), { offline: true });
      }
    },

    /* ---------- offline: device copy, queue and replay ---------- */
    cacheGet(path) { try { const v = store.get(LS_CACHE + path); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    cacheSet(path, data) { if (!store.set(LS_CACHE + path, JSON.stringify(data))) this.emit({ type: 'storageFull' }); },
    setOffline(v) {
      if (this.offline === v) return;
      this.offline = v;
      this.emit({ type: v ? 'offline' : 'online' });
      this.emit({ type: 'outbox', count: this.outbox.length });
    },
    saveOutbox() { store.set(LS_OUTBOX, JSON.stringify(this.outbox)); this.emit({ type: 'outbox', count: this.outbox.length }); },
    problems() { try { return JSON.parse(store.get(LS_PROBLEMS) || '[]'); } catch (e) { return []; } },
    clearProblems() { store.del(LS_PROBLEMS); this.emit({ type: 'outbox', count: this.outbox.length }); },

    /** Save a change on this device: apply it to the device copy now, send it when online. */
    enqueue(method, path, body) {
      body = body ? JSON.parse(JSON.stringify(body)) : {};
      const seg = path.split('/');
      if (method === 'POST' && seg[0] === 'sites' && seg.length === 3 && !body.id) body.id = Core.uid(seg[2].slice(0, 2) + '_');
      if (method === 'POST' && seg[0] === 'widgets' && seg.length === 1 && !body.id) body.id = Core.uid('w_');
      if (method === 'POST' && seg[2] === 'complete' && !body.logId) body.logId = Core.uid('ml_');
      if (method === 'POST' && seg[0] === 'sites') body.clientAt = Date.now();
      const data = this.applyLocal(method, path, body); // throws on validation / permission errors → nothing queued
      this.outbox.push({ id: Core.uid('q_'), method, path, body, at: Date.now() });
      this.saveOutbox();
      return data;
    },
    applyLocal(method, path, body) {
      const boot = this.cacheGet('bootstrap');
      if (!boot) throw Object.assign(new Error("You're offline — open the app once while online first"), { offline: true });
      // which site does this change belong to?
      const seg = path.split('/');
      let siteId = seg[0] === 'sites' ? seg[1] : null;
      if (!siteId && !/^(widgets|notifications)/.test(path)) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const m = k && k.match(/^mhp\.cache\.sites\/([^/]+)\/data$/);
          if (!m) continue;
          const d = this.cacheGet('sites/' + m[1] + '/data');
          if (d && ['entries', 'messages', 'announcements', 'maintenance', 'machines', 'operators', 'telehuts'].some((c) => (d[c] || []).some((x) => x.id === seg[1]))) { siteId = m[1]; break; }
        }
      }
      const data = siteId ? this.cacheGet('sites/' + siteId + '/data') : null;
      const cols = ['machines', 'operators', 'telehuts', 'entries', 'maintenance', 'maintLog', 'announcements', 'messages'];
      const users = (boot.users || []).map((u) => Object.assign({}, u));
      if (!users.some((u) => u.id === boot.user.id)) users.push({ id: boot.user.id, name: boot.user.name });
      const me = users.find((u) => u.id === boot.user.id); me.email = boot.user.email;
      const db = Core.migrate({ users, sites: data ? [Object.assign({}, data.site)] : [], widgets: this.cacheGet('widgets') || [], settings: Object.assign({}, boot.settings || {}), notifications: [] });
      if (data) cols.forEach((c) => { db[c] = JSON.parse(JSON.stringify(data[c] || [])); });
      if (data && !data.site.members) db.sites[0].members = (data.members || []).map((m) => m.id);
      const out = Core.handle(db, { method, path, body, userId: boot.user.id, isSuper: !!boot.user.isSuper });
      if (data) { cols.forEach((c) => { data[c] = db[c]; }); this.cacheSet('sites/' + siteId + '/data', data); }
      if (/^widgets/.test(path)) this.cacheSet('widgets', db.widgets.filter((w) => w.userId === boot.user.id));
      setTimeout(() => out.events.filter((ev) => ev.type !== 'notify').forEach((ev) => this.emit(ev)), 0);
      return out.data;
    },
    /** send queued changes in order; stops at the first connection problem */
    async flush() {
      if (this._flushing || !this.outbox.length || this.mode !== 'server' || !this.token) return;
      this._flushing = true;
      this.emit({ type: 'syncing', count: this.outbox.length });
      let sent = 0;
      const problems = this.problems();
      try {
        while (this.outbox.length) {
          const q = this.outbox[0];
          try { await this.net(q.method, q.path, q.body); sent++; }
          catch (e) {
            if (e.network) { this.setOffline(true); break; }
            if (e.status === 401) break; // needs sign-in; keep the queue
            if (!(e.status === 404 && q.method === 'DELETE')) problems.push({ at: Date.now(), what: q.method + ' ' + q.path, error: e.message, body: q.body });
          }
          this.outbox.shift();
          this.saveOutbox();
        }
      } finally { this._flushing = false; }
      if (problems.length) store.set(LS_PROBLEMS, JSON.stringify(problems.slice(-50)));
      if (sent || problems.length) this.emit({ type: 'synced', sent, problems: problems.length });
      this.emit({ type: 'outbox', count: this.outbox.length });
      if (!this.outbox.length && sent) { this.setOffline(false); this.emit({ type: 'resync' }); }
    },
    startSyncLoop() {
      if (this._loop) return;
      const tick = async () => {
        if (!this.offline && !this.outbox.length) return;
        try { await this.net('GET', 'health'); this.setOffline(false); await this.flush(); if (!this.es && this.token) this.connect(); }
        catch (e) { if (e.network) this.setOffline(true); }
      };
      this._loop = setInterval(tick, 15000);
      window.addEventListener('online', () => setTimeout(tick, 500));
      window.addEventListener('offline', () => this.setOffline(true));
    },
    get: function (p) { return this.call('GET', p); },
    post: function (p, b) { return this.call('POST', p, b || {}); },
    put: function (p, b) { return this.call('PUT', p, b || {}); },
    del: function (p) { return this.call('DELETE', p); },

    async setup(name, email, code, password) {
      const res = await this.post('auth/setup', { name, email, code, password });
      this.token = res.token; store.set(LS_TOKEN, res.token);
      this.connect();
      return res.user;
    },
    async signIn(name, email, password) {
      const res = await this.post('auth/signin', { name, email, password });
      if (this.mode === 'local') { store.set(LS_LOCALUSER, res.id); return res; }
      this.token = res.token; store.set(LS_TOKEN, res.token);
      this.connect();
      return res.user;
    },
    async signOut() {
      if (this.mode === 'server') { try { await this.post('auth/signout'); } catch (e) { /* ignore */ } }
      this.signOutLocal();
    },
    signOutLocal() {
      this.token = null; store.del(LS_TOKEN); store.del(LS_LOCALUSER);
      // a different person may use this device next: drop the device copy (queued changes are kept)
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(LS_CACHE)) store.del(k); }
      if (this.es) { this.es.close(); this.es = null; }
    },

    /* ---------- live updates ---------- */
    connect() {
      if (this.mode !== 'server' || !this.token) return;
      if (this.es) this.es.close();
      const es = new EventSource('api/events?token=' + encodeURIComponent(this.token));
      this.es = es;
      es.onmessage = (m) => { try { this.emit(JSON.parse(m.data)); } catch (e) { /* ignore */ } };
      es.onopen = () => { if (this.offline) { this.setOffline(false); } this.flush(); };
      es.onerror = () => { if (es.readyState === 2) { this.es = null; } };
    },

    /* ---------- local demo mode ---------- */
    initLocal() {
      let db;
      try { db = JSON.parse(store.get(LS_DB) || 'null'); } catch (e) { db = null; }
      this.db = Core.migrate(db || Core.emptyDB());
      try {
        this.bc = new BroadcastChannel('mhp');
        this.bc.onmessage = (m) => {
          try { this.db = Core.migrate(JSON.parse(store.get(LS_DB) || 'null') || Core.emptyDB()); } catch (e) { /* ignore */ }
          (m.data || []).forEach((ev) => this.emit(ev));
        };
      } catch (e) { this.bc = null; }
      setInterval(() => {
        const out = Core.checkMaintenance(this.db, Date.now());
        if (out.dirty) this.persist(out.events);
        out.events.forEach((ev) => this.emit(ev));
      }, 60000);
    },
    persist(events) {
      if (!store.set(LS_DB, JSON.stringify(this.db))) this.emit({ type: 'storageFull' });
      if (this.bc) this.bc.postMessage(events || []);
    },
    async localCall(method, path, body) {
      const userId = store.get(LS_LOCALUSER);
      // deep-copy body so the stored db never shares references with UI objects
      const b = body ? JSON.parse(JSON.stringify(body)) : {};
      let out;
      // demo mode: superuser emails get superuser rights without a password (single browser only)
      const u = this.db.users.find((x) => x.id === userId);
      const isSuper = !!(u && Core.isSuperEmail(this.db, u.email));
      try { out = Core.handle(this.db, { method, path, body: b, userId, isSuper }); }
      catch (e) {
        if (e.status === 401) { this.signOutLocal(); this.emit({ type: 'signedout' }); }
        throw e;
      }
      if (out.dirty) this.persist(out.events);
      if (out.emails.length) console.info('[demo mode] emails that would be sent:', out.emails);
      const data = JSON.parse(JSON.stringify(out.data));
      setTimeout(() => out.events.forEach((ev) => this.emit(JSON.parse(JSON.stringify(ev)))), 0);
      return data;
    },
    resetLocal() { store.del(LS_DB); store.del(LS_LOCALUSER); }
  };
  window.API = API;
})();
