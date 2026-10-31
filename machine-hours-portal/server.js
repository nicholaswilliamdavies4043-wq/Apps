/*
 * Machine Hours Portal — server
 * Zero required dependencies (Node 18+). Optional: `npm install nodemailer` for email.
 *
 *   node server.js                          → http://localhost:3000
 *   node server.js --reset-password=EMAIL   → print a new one-time setup code for a superuser
 *
 * Settings come from environment variables or a .env file (see .env.example):
 *   PORT, HOST, DATA_DIR, APP_URL, SUPERUSER_EMAILS, STORAGE=file|sharepoint|postgres, DATABASE_URL, DATABASE_SSL, SP_*, SMTP_*
 */
'use strict';
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('./public/js/core.js');
const Sec = require('./storage/security.js');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const APP_URL = process.env.APP_URL || ('http://localhost:' + PORT);
/** Owner superusers — always superusers, cannot be removed from inside the app. */
// The built-in owner (Core.DEFAULT_OWNERS) is always included; SUPERUSER_EMAILS adds more owners.
const OWNERS = Array.from(new Set(Core.DEFAULT_OWNERS.concat((process.env.SUPERUSER_EMAILS || '').split(','))
  .map((e) => e.trim().toLowerCase()).filter(Boolean)));
// With DATABASE_URL set and no explicit STORAGE, use PostgreSQL so data survives restarts/redeploys.
const STORAGE = (process.env.STORAGE || (process.env.DATABASE_URL ? 'postgres' : 'file')).toLowerCase();
if (!['file', 'sharepoint', 'postgres'].includes(STORAGE)) throw new Error('STORAGE must be file, sharepoint, or postgres');

fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

/* ------------------------------------------------------------ database (local copy / cache) */
let db;
try { db = Core.migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
catch (e) {
  if (fs.existsSync(DB_FILE)) {
    const bad = DB_FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(DB_FILE, bad);
    console.error('! Could not read db.json, a copy was saved as', bad);
  }
  db = Core.emptyDB();
}
let saveTimer = null, rev = 0;
let pgStore = null;
function save() {
  rev++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeLocal(); } catch (e) { console.error('Local cache write failed:', e.message); }
  }, 300);
  if (pgStore) pgStore.schedule(db);
  if (sp) sp.schedule(db);
}
function writeLocal() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function dailyBackup() {
  if (!fs.existsSync(DB_FILE)) return;
  const f = path.join(DATA_DIR, 'backups', 'db-' + Core.localDate(Date.now()) + '.json');
  if (!fs.existsSync(f)) fs.copyFileSync(DB_FILE, f);
  const files = fs.readdirSync(path.join(DATA_DIR, 'backups')).filter((x) => x.startsWith('db-')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(DATA_DIR, 'backups', files.shift()));
}

/* ------------------------------------------------------------ SharePoint storage (optional) */
let sp = null;
const { SharePointStore } = require('./storage/sharepoint.js');
const STORAGE_FILE = path.join(DATA_DIR, 'storage.json'); // written by Superuser → Data source
/** SharePoint settings: .env wins; otherwise what a superuser saved in the app */
function storageConfig() {
  if (STORAGE === 'postgres') return null;
  if (STORAGE === 'sharepoint') {
    return { source: 'env', siteUrl: process.env.SP_SITE_URL, siteId: process.env.SP_SITE_ID, tenantId: process.env.SP_TENANT_ID, clientId: process.env.SP_CLIENT_ID,
      clientSecret: process.env.SP_CLIENT_SECRET, prefix: process.env.SP_LIST_PREFIX != null ? process.env.SP_LIST_PREFIX : 'MHP_', createLists: process.env.SP_CREATE_LISTS === 'true' };
  }
  try { const c = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8')); if (c.mode === 'sharepoint') return Object.assign({ source: 'app' }, c); } catch (e) { /* none */ }
  return null;
}
/** sandvik.sharepoint.com → sandvik.onmicrosoft.com (Microsoft accepts the tenant domain instead of the GUID) */
function tenantFromSite(siteUrl) {
  try { const h = new URL(siteUrl).hostname.toLowerCase(); const m = h.match(/^([a-z0-9-]+?)(-my)?\.sharepoint\.com$/); return m ? m[1] + '.onmicrosoft.com' : null; } catch (e) { return null; }
}
function cleanSiteUrl(u) {
  u = String(u || '').trim();
  if (!/^https:\/\/[^/]+\.sharepoint\.com\//i.test(u + '/')) throw httpErr(400, 'Paste the address of a SharePoint site, e.g. https://sandvik.sharepoint.com/sites/MachineHours');
  const x = new URL(u);
  // keep only /sites/<name> or /teams/<name> (people often paste a page or list link)
  const m = x.pathname.match(/^\/(sites|teams)\/[^/]+/i);
  return x.origin + (m ? m[0] : '');
}
function makeStore(c) {
  const key = crypto.createHash('sha1').update((c.siteUrl || c.siteId) + '|' + (c.prefix || 'MHP_')).digest('hex').slice(0, 10);
  return new SharePointStore({
    tenantId: c.tenantId || tenantFromSite(c.siteUrl), clientId: c.clientId, clientSecret: c.clientSecret, siteUrl: c.siteUrl, siteId: c.siteId,
    prefix: c.prefix != null ? c.prefix : 'MHP_', createLists: !!c.createLists, stateFile: path.join(DATA_DIR, 'sharepoint-state-' + key + '.json'), owners: OWNERS,
    graphBase: process.env.SP_GRAPH_BASE || undefined, loginBase: process.env.SP_LOGIN_BASE || undefined
  });
}
/** Test a SharePoint configuration step by step (nothing is changed unless createLists is set). */
async function testSharePoint(c) {
  const steps = [], st = makeStore(c);
  const step = async (label, fn) => { try { const r = await fn(); steps.push({ ok: true, label, info: r && r.info }); return r; } catch (e) { steps.push({ ok: false, label, info: e.message }); throw e; } };
  try {
    await step('Signed in to Microsoft 365', async () => { await st.token(); return { info: 'tenant ' + (c.tenantId || tenantFromSite(c.siteUrl)) }; });
    await step('Found the SharePoint site', async () => ({ info: await st.resolveSite() }));
    const report = await step('Lists ready', async () => {
      const rep = await st.ensureLists(!!c.createLists);
      const bad = rep.filter((r) => /MISSING/.test(r.action));
      if (bad.length) throw new Error(bad.length + ' of ' + rep.length + ' lists are missing or incomplete: ' + bad.map((b) => b.list).join(', ') + (c.createLists ? ' (the app could not create them — it needs "Manage" permission on the site)' : ' — tick "Create the lists for me" or run the PowerShell script'));
      const made = rep.filter((r) => r.action !== 'ok').length;
      return { info: rep.length + ' lists' + (made ? ' (' + made + ' created/updated now)' : ''), rep };
    });
    const data = await step('Read the lists', async () => { const d = await st.readAll(); const n = Object.values(d).reduce((a, x) => a + x.length, 0); return { info: n ? n + ' records already in SharePoint' : 'empty — your current data will be uploaded', n }; });
    return { ok: true, steps, report: report.rep, existing: data.n, store: st };
  } catch (e) { return { ok: false, steps, error: e.message }; }
}
/** Switch the running server to SharePoint (no restart). */
async function connectSharePoint(c) {
  const t = await testSharePoint(c);
  if (!t.ok) return t;
  writeLocal();
  fs.copyFileSync(DB_FILE, path.join(DATA_DIR, 'backups', 'before-sharepoint-' + Date.now() + '.json'));
  const st = t.store;
  const r = await st.start(db);
  if (sp) sp.stop();
  sp = st;
  writeLocal();
  if (c.source !== 'env') fs.writeFileSync(STORAGE_FILE, JSON.stringify({ mode: 'sharepoint', siteUrl: c.siteUrl, tenantId: c.tenantId || null, clientId: c.clientId, clientSecret: c.clientSecret, prefix: c.prefix != null ? c.prefix : 'MHP_', createLists: !!c.createLists, connectedAt: Date.now() }, null, 2));
  return { ok: true, steps: t.steps, migrated: r.migrated, loaded: r.loaded };
}
if (STORAGE === 'sharepoint') {
  const need = ['SP_CLIENT_ID', 'SP_CLIENT_SECRET'].filter((k) => !process.env[k]);
  if (!process.env.SP_SITE_URL && !process.env.SP_SITE_ID) need.push('SP_SITE_URL');
  if (!process.env.SP_TENANT_ID && !tenantFromSite(process.env.SP_SITE_URL)) need.push('SP_TENANT_ID');
  if (need.length) { console.error('! STORAGE=sharepoint needs: ' + need.join(', ') + ' (see .env.example)'); process.exit(1); }
}
{ const c = storageConfig(); if (c) sp = makeStore(c); }

/* ------------------------------------------------------------ email */
let mailer = null;
if (process.env.SMTP_HOST) {
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  } catch (e) {
    console.warn('! SMTP_HOST is set but nodemailer is not installed. Run: npm install nodemailer');
  }
}
function sendEmails(list) {
  for (const m of list) {
    const text = m.text + '\n\nOpen the portal: ' + APP_URL;
    if (mailer) {
      mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: m.to, subject: m.subject, text })
        .catch((e) => console.error('Email failed to', m.to, e.message));
    } else {
      fs.appendFile(path.join(DATA_DIR, 'outbox.log'),
        '[' + new Date().toISOString() + '] TO: ' + m.to + '\nSUBJECT: ' + m.subject + '\n' + text + '\n----\n', () => {});
    }
  }
}

/* ------------------------------------------------------------ superusers */
const supers = () => Core.superEmails(db, OWNERS);
const isSuperEmail = (email) => Core.isSuperEmail(db, email, OWNERS);
function setupCodeFor(email, reason) {
  const code = Sec.issueCode(db, email, 7);
  const line = '[' + new Date().toISOString() + '] ' + email + '  →  ' + code + '   (' + reason + ', valid 7 days)\n';
  fs.appendFileSync(path.join(DATA_DIR, 'superuser-setup-codes.txt'), line);
  return code;
}
/** owners/superusers without a password get a setup code at start-up (printed + written to data/) */
function ensureSetupCodes() {
  const out = [];
  for (const email of supers()) {
    if (db.security.creds[email]) continue;
    const c = db.security.codes[email];
    if (c && c.expires > Date.now()) continue;
    out.push([email, setupCodeFor(email, 'first-time setup')]);
  }
  if (out.length) save();
  return out;
}

/* ------------------------------------------------------------ live events (SSE) */
const clients = new Set();
function broadcast(events) {
  for (const ev of events) {
    const data = 'data: ' + JSON.stringify(ev) + '\n\n';
    for (const c of clients) {
      if (ev.userId && ['notify', 'widgets', 'role'].includes(ev.type) && c.userId !== ev.userId) continue;
      c.res.write(data);
    }
  }
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000);
function kickUser(userId) {
  for (const [t, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[t];
  broadcast([{ type: 'role', userId }]);
}

/* ------------------------------------------------------------ http */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mjs': 'text/javascript; charset=utf-8', '.map': 'application/json', '.woff2': 'font/woff2'
};
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'"
};
// Bundled tools in public/apps/ are standalone pages with inline scripts, so they get their own CSP
const APP_HEADERS = Object.assign({}, SEC_HEADERS, {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' data: blob:; frame-ancestors 'self'"
});

function send(res, status, obj) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 6e6) { reject(new Core.HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Core.HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function sessionOf(token) {
  const s = token && db.sessions[token];
  if (!s) return null;
  const u = db.users.find((x) => x.id === s.userId);
  if (!u || u.disabled) { delete db.sessions[token]; return null; }
  s.lastSeen = Date.now();
  u.lastSeen = s.lastSeen;
  // A superuser email must sign in with its password. Sessions opened before the email became a
  // superuser (or without the password) are ended so the next sign-in asks for password / setup code.
  if (isSuperEmail(u.email) && !s.super) { delete db.sessions[token]; save(); return null; }
  return { token, userId: s.userId, user: u, isSuper: !!s.super && isSuperEmail(u.email) };
}
function newSession(userId, isSuper) {
  const t = crypto.randomBytes(24).toString('hex');
  db.sessions[t] = { userId, super: !!isSuper, createdAt: Date.now(), lastSeen: Date.now() };
  return t;
}
const httpErr = (s, m, extra) => Object.assign(new Core.HttpError(s, m), { extra });
const normEmail = (e) => String(e || '').trim().toLowerCase();

function run(req, s, p, body) {
  const out = Core.handle(db, { method: req.method, path: p, body, userId: s && s.userId, isSuper: s && s.isSuper, owners: OWNERS });
  if (out.dirty) save();
  if (out.events.length) broadcast(out.events);
  if (out.emails.length) sendEmails(out.emails);
  return out;
}
function signedIn(req, s, name, email, isSuper) {
  const out = run({ method: 'POST' }, null, '/auth/signin', { name, email });
  const token = newSession(out.data.id, isSuper);
  out.data.isSuper = !!isSuper;
  save();
  return { user: out.data, token };
}

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  if (p === '/health') return send(res, 200, { ok: true, mode: 'server', version: Core.VERSION, storage: pgStore ? 'postgres' : (sp ? 'sharepoint' : 'file'), databaseConnected: pgStore ? pgStore.status.connected : undefined });
  if (p === '/network') {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    const proto = TLS ? 'https' : 'http';
    return send(res, 200, { port: PORT, secure: !!TLS, appUrl: process.env.APP_URL || null, hostname: os.hostname(),
      urls: [process.env.APP_URL].filter(Boolean).concat(ips.map((ip) => proto + '://' + ip + ':' + PORT)) });
  }

  if (p === '/events') {
    const s = sessionOf(url.searchParams.get('token'));
    if (!s) return send(res, 401, { error: 'Sign in required' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const c = { res, userId: s.userId };
    clients.add(c);
    req.on('close', () => clients.delete(c));
    return;
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
  const s = sessionOf(token);

  /* ---------- auth ---------- */
  if (p === '/auth/signout' && req.method === 'POST') {
    if (token) { delete db.sessions[token]; save(); }
    return send(res, 200, { ok: true });
  }
  if (p === '/auth/signin' && req.method === 'POST') {
    const email = normEmail(body.email), name = String(body.name || '').trim();
    if (!isSuperEmail(email)) return send(res, 200, signedIn(req, s, name, email, false));
    // superuser email → password (or first-time setup code) required
    const u = db.users.find((x) => x.email === email);
    if (u && u.disabled) throw httpErr(403, 'This account has been disabled');
    const mins = Sec.locked(email);
    if (mins) throw httpErr(429, 'Too many attempts. Try again in ' + mins + ' min.');
    if (!db.security.creds[email]) throw httpErr(401, 'Superuser account — enter your one-time setup code to create a password', { needSetup: true });
    if (!body.password) throw httpErr(401, 'Superuser account — enter your password', { needPassword: true });
    if (!Sec.verifyPassword(body.password, db.security.creds[email])) {
      Sec.failed(email);
      Core.audit(db, u || { name: name || email, email }, 'Failed superuser sign-in', null, 'Wrong password'); save();
      throw httpErr(401, 'Incorrect password', { needPassword: true });
    }
    Sec.succeeded(email);
    return send(res, 200, signedIn(req, s, name || (u && u.name) || email, email, true));
  }
  if (p === '/auth/setup' && req.method === 'POST') {
    const email = normEmail(body.email), name = String(body.name || '').trim();
    if (!isSuperEmail(email)) throw httpErr(400, 'This email is not a superuser');
    const mins = Sec.locked(email);
    if (mins) throw httpErr(429, 'Too many attempts. Try again in ' + mins + ' min.');
    if (!Sec.checkCode(db, email, body.code)) { Sec.failed(email); throw httpErr(401, 'Setup code is wrong or has expired', { needSetup: true }); }
    const prob = Sec.passwordProblem(body.password);
    if (prob) throw httpErr(400, prob, { needSetup: true });
    db.security.creds[email] = Sec.hashPassword(body.password);
    delete db.security.codes[email];
    Sec.succeeded(email);
    const r = signedIn(req, s, name || email, email, true);
    Core.audit(db, db.users.find((x) => x.email === email), 'Superuser password set', null, email); save();
    return send(res, 200, r);
  }
  if (p === '/auth/password' && req.method === 'POST') {
    if (!s || !s.isSuper) throw httpErr(403, 'Only superusers have a password');
    const email = s.user.email;
    if (!Sec.verifyPassword(body.current, db.security.creds[email])) { Sec.failed(email); throw httpErr(401, 'Current password is incorrect'); }
    const prob = Sec.passwordProblem(body.password);
    if (prob) throw httpErr(400, prob);
    db.security.creds[email] = Sec.hashPassword(body.password);
    for (const [t, x] of Object.entries(db.sessions)) if (x.userId === s.userId && t !== token) delete db.sessions[t];
    Core.audit(db, s.user, 'Changed own superuser password', null, null); save();
    return send(res, 200, { ok: true });
  }

  /* ---------- superuser administration ---------- */
  if (p.startsWith('/admin/users') || p.startsWith('/admin/superusers') || p.startsWith('/admin/storage')) {
    if (!s) throw httpErr(401, 'Sign in required');
    if (!s.isSuper) throw httpErr(403, 'Only superusers can manage users and storage');
    const seg = p.split('/').filter(Boolean); // admin, users|superusers|storage, ...
    const log = (a, d) => Core.audit(db, s.user, a, null, d);

    if (seg[1] === 'users' && seg.length === 2 && req.method === 'GET') {
      const sup = new Set(supers());
      const lastSeen = {};
      for (const x of Object.values(db.sessions)) lastSeen[x.userId] = Math.max(lastSeen[x.userId] || 0, x.lastSeen || 0);
      const list = db.users.map((u) => ({
        id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, lastSeen: lastSeen[u.id] || u.lastSeen || null, disabled: !!u.disabled,
        role: OWNERS.includes(u.email) ? 'owner' : sup.has(u.email) ? 'superuser' : 'user',
        hasPassword: !!db.security.creds[u.email], setupPending: sup.has(u.email) && !db.security.creds[u.email]
      }));
      // superusers added by email who have not signed in yet
      for (const e of sup) if (!db.users.some((u) => u.email === e)) list.push({ id: null, name: '(not signed in yet)', email: e, role: OWNERS.includes(e) ? 'owner' : 'superuser', hasPassword: !!db.security.creds[e], setupPending: !db.security.creds[e] });
      return send(res, 200, { users: list, owners: OWNERS });
    }
    if (seg[1] === 'superusers' && seg.length === 2 && req.method === 'POST') {
      const email = normEmail(body.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpErr(400, 'Enter a valid email');
      if (isSuperEmail(email)) throw httpErr(409, email + ' is already a superuser');
      db.security.superusers.push(email);
      const code = db.security.creds[email] ? null : setupCodeFor(email, 'added by ' + s.user.email);
      log('Added superuser', email);
      const u = db.users.find((x) => x.email === email);
      if (u) kickUser(u.id); // they sign in again to get superuser rights
      if (code) sendEmails([{ to: email, subject: 'You are now a Machine Hours Portal superuser', text: s.user.name + ' made you a superuser.\n\nSign in with this email, then enter this one-time setup code to create your password:\n\n    ' + code + '\n\nThe code is valid for 7 days.' }]);
      save();
      return send(res, 201, { email, code });
    }
    if (seg[1] === 'superusers' && seg[2]) {
      const email = normEmail(decodeURIComponent(seg[2]));
      if (req.method === 'DELETE') {
        if (OWNERS.includes(email)) throw httpErr(400, 'Owner superusers are set in the server configuration (SUPERUSER_EMAILS) and cannot be removed here');
        if (!db.security.superusers.includes(email)) throw httpErr(404, email + ' is not a superuser');
        db.security.superusers = db.security.superusers.filter((e) => e !== email);
        delete db.security.creds[email]; delete db.security.codes[email];
        const u = db.users.find((x) => x.email === email);
        if (u) kickUser(u.id);
        log('Removed superuser', email); save();
        return send(res, 200, { ok: true });
      }
      if (seg[3] === 'reset' && req.method === 'POST') {
        if (!isSuperEmail(email)) throw httpErr(404, email + ' is not a superuser');
        if (OWNERS.includes(email) && email !== s.user.email && !OWNERS.includes(s.user.email)) throw httpErr(403, 'Only an owner can reset an owner password');
        delete db.security.creds[email];
        const code = setupCodeFor(email, 'reset by ' + s.user.email);
        const u = db.users.find((x) => x.email === email);
        if (u && email !== s.user.email) kickUser(u.id);
        log('Reset superuser password', email); save();
        sendEmails([{ to: email, subject: 'Machine Hours Portal — password reset', text: 'Your superuser password was reset by ' + s.user.name + '.\n\nSetup code: ' + code + ' (valid 7 days)' }]);
        return send(res, 200, { email, code });
      }
    }
    if (seg[1] === 'users' && seg[2] && req.method === 'POST') {
      const u = db.users.find((x) => x.id === seg[2]);
      if (!u) throw httpErr(404, 'User not found');
      if (seg[3] === 'disable') {
        if (OWNERS.includes(u.email)) throw httpErr(400, 'Owner accounts cannot be disabled');
        if (u.id === s.userId) throw httpErr(400, 'You cannot disable yourself');
        u.disabled = body.disabled !== false;
        if (u.disabled) kickUser(u.id);
        log(u.disabled ? 'Disabled user' : 'Enabled user', u.email); save();
        broadcast([{ type: 'users', item: Core.pub(u) }]);
        return send(res, 200, { ok: true, disabled: u.disabled });
      }
      if (seg[3] === 'signout') { kickUser(u.id); log('Signed out user everywhere', u.email); save(); return send(res, 200, { ok: true }); }
    }
    if (seg[1] === 'storage') {
      const cfg = storageConfig();
      if (req.method === 'GET' && !seg[2]) {
        const conf = cfg ? { source: cfg.source, siteUrl: cfg.siteUrl, clientId: cfg.clientId, tenantId: cfg.tenantId || tenantFromSite(cfg.siteUrl), prefix: cfg.prefix, secretSet: !!cfg.clientSecret } : null;
        if (pgStore) {
          // name the database without exposing the user name or password from DATABASE_URL
          let database = null; try { const u = new URL(process.env.DATABASE_URL); database = u.pathname.replace(/^\//, '') + ' @ ' + u.hostname; } catch (e) { /* unparsable */ }
          return send(res, 200, Object.assign({ mode: 'postgres', database, cacheFile: DB_FILE, config: null }, pgStore.status));
        }
        return send(res, 200, sp ? Object.assign({}, sp.status, { prefix: sp.o.prefix, config: conf }) : { mode: 'file', file: DB_FILE, connected: true, config: conf });
      }
      if (seg[2] === 'script' && req.method === 'GET') {
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="create-lists.ps1"' }, SEC_HEADERS));
        return res.end(fs.readFileSync(path.join(__dirname, 'sharepoint', 'create-lists.ps1')));
      }
      if ((seg[2] === 'test' || seg[2] === 'connect') && req.method === 'POST' && pgStore) throw httpErr(400, 'This server keeps its data in PostgreSQL (DATABASE_URL). Remove DATABASE_URL and STORAGE=postgres from the server environment first.');
      if ((seg[2] === 'test' || seg[2] === 'connect') && req.method === 'POST') {
        if (cfg && cfg.source === 'env') throw httpErr(400, 'SharePoint is configured in the server .env file — change it there');
        const old = cfg || {};
        const c = {
          siteUrl: cleanSiteUrl(body.siteUrl), clientId: String(body.clientId || old.clientId || '').trim(),
          clientSecret: String(body.clientSecret || '').trim() || old.clientSecret || '', tenantId: String(body.tenantId || '').trim() || null,
          prefix: body.prefix != null && body.prefix !== '' ? String(body.prefix).replace(/[^A-Za-z0-9_]/g, '') : 'MHP_', createLists: !!body.createLists
        };
        if (!/^[0-9a-f-]{36}$/i.test(c.clientId)) throw httpErr(400, 'Client ID should look like 00000000-0000-0000-0000-000000000000 (IT gives you this)');
        if (!c.clientSecret) throw httpErr(400, 'Enter the client secret (IT gives you this)');
        if (!c.tenantId && !tenantFromSite(c.siteUrl)) throw httpErr(400, 'Could not work out your Microsoft 365 tenant from that link — enter the Tenant ID');
        if (seg[2] === 'test') { const t = await testSharePoint(c); delete t.store; return send(res, 200, t); }
        const r = await connectSharePoint(c);
        delete r.store;
        if (r.ok) {
          log('Connected data source to SharePoint', c.siteUrl + (r.migrated != null ? ' — uploaded ' + r.migrated + ' records' : ' — loaded ' + r.loaded + ' records'));
          save();
          setTimeout(() => broadcast([{ type: 'reload-app', reason: 'The data source was switched to SharePoint' }]), 300);
        }
        return send(res, 200, r);
      }
      if (seg[2] === 'disconnect' && req.method === 'POST') {
        if (cfg && cfg.source === 'env') throw httpErr(400, 'SharePoint is configured in the server .env file — remove STORAGE=sharepoint there');
        if (sp) { try { await sp.flush(db); } catch (e) { /* keep local copy anyway */ } sp.stop(); }
        sp = null;
        try { fs.unlinkSync(STORAGE_FILE); } catch (e) { /* none */ }
        writeLocal();
        log('Disconnected SharePoint', 'data source is now the local file');
        save();
        setTimeout(() => broadcast([{ type: 'reload-app', reason: 'The data source was switched to the local file' }]), 300);
        return send(res, 200, { ok: true });
      }
      if (seg[2] === 'sync' && req.method === 'POST') {
        if (!sp) return send(res, 200, { mode: 'file', ok: true });
        const changed = await sp.pull(db, () => rev).catch((e) => { sp.fail(e); throw httpErr(502, e.message); });
        if (changed) { writeLocal(); broadcast([{ type: 'resync' }]); }
        log('Synced with SharePoint', changed ? 'changes loaded' : 'no changes'); save();
        return send(res, 200, Object.assign({ changed }, sp.status));
      }
      if (seg[2] === 'check' && req.method === 'POST') {
        if (!sp) return send(res, 200, { mode: 'file' });
        const report = await sp.ensureLists(false).catch((e) => { throw httpErr(502, e.message); });
        return send(res, 200, { report });
      }
    }
    throw httpErr(404, 'No route');
  }

  /* ---------- everything else ---------- */
  const out = run(req, s, p, body);
  send(res, out.status, out.data);
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (e, st) => {
    if (!e && st.isDirectory()) file = path.join(file, 'index.html');
    else if (e) {
      if (path.extname(file)) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
      file = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
    }
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, Object.assign({
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' || path.basename(file) === 'sw.js' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=300'
      }, file.startsWith(path.join(PUBLIC_DIR, 'apps') + path.sep) ? APP_HEADERS : SEC_HEADERS));
      res.end(buf);
    });
  });
}

// Optional HTTPS (needed for offline use and "install" on phones): TLS_PFX (+TLS_PASSPHRASE) or TLS_CERT + TLS_KEY
const TLS = (() => {
  try {
    if (process.env.TLS_PFX) return { pfx: fs.readFileSync(process.env.TLS_PFX), passphrase: process.env.TLS_PASSPHRASE || undefined };
    if (process.env.TLS_CERT && process.env.TLS_KEY) return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) };
  } catch (e) { console.error('! Could not read the TLS certificate: ' + e.message); }
  return null;
})();
const handler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, Object.assign({ error: status === 500 ? 'Server error' : e.message }, e.extra || {}));
  }
};
const server = TLS ? https.createServer(TLS, handler) : http.createServer(handler);

/* ------------------------------------------------------------ scheduler */
function tick() {
  try {
    const out = Core.checkMaintenance(db, Date.now());
    if (out.dirty) save();
    if (out.events.length) broadcast(out.events);
    // shift change (06:00 / 18:00 GMT): unsaved bucket counts are saved to their level and the counters start again
    const roll = Core.rollBuckets(db, Date.now());
    if (roll.dirty) { save(); broadcast(roll.events); }
    if (out.emails.length) sendEmails(out.emails);
    const cutoff = Date.now() - 90 * Core.DAY; // expire sessions idle > 90 days
    for (const [t, x] of Object.entries(db.sessions)) if ((x.lastSeen || x.createdAt) < cutoff) { delete db.sessions[t]; save(); }
    dailyBackup();
  } catch (e) { console.error('Scheduler error', e); }
}
setInterval(tick, 60 * 1000);
setTimeout(tick, 2000);

const PULL_MIN = Number(process.env.SP_PULL_MINUTES) || 5;
setInterval(async () => {
  if (!sp) return;
  try { if (await sp.pull(db, () => rev)) { writeLocal(); broadcast([{ type: 'resync' }]); } }
  catch (e) { if (sp) sp.fail(e); }
}, PULL_MIN * 60000);

async function flushAndExit() {
  clearTimeout(saveTimer);
  try { writeLocal(); } catch (e) { console.error('Final local cache write failed:', e.message); }
  try { if (pgStore) { await pgStore.flush(db); await pgStore.close(); } } catch (e) { console.error('Final PostgreSQL save failed:', e.message); }
  try { if (sp) await sp.flush(db); } catch (e) { console.error('Final SharePoint save failed:', e.message); }
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);

/* ------------------------------------------------------------ start */
(async () => {
  if (STORAGE === 'postgres') {
    if (!process.env.DATABASE_URL) throw new Error('STORAGE=postgres requires the DATABASE_URL environment variable');
    const { PostgresStore } = require('./storage/postgres.js');
    pgStore = new PostgresStore({ connectionString: process.env.DATABASE_URL });
    const persisted = await pgStore.start(db);
    if (persisted) db = Core.migrate(persisted);
    writeLocal();
    console.log('  ✓ PostgreSQL connected — ' + (persisted ? 'loaded persistent data' : 'initialized from the local data file'));
  }
  const resetArg = process.argv.find((a) => a.startsWith('--reset-password='));
  if (resetArg) {
    const email = normEmail(resetArg.split('=')[1]);
    if (!isSuperEmail(email)) { console.error('! ' + email + ' is not a superuser'); process.exit(1); }
    delete db.security.creds[email];
    const code = setupCodeFor(email, 'reset from the server console');
    writeLocal();
    console.log('\n  New setup code for ' + email + ':  ' + code + '   (valid 7 days)\n');
  }
  if (sp) {
    try {
      const r = await sp.start(db);
      console.log('  ✓ SharePoint connected (' + (sp.o.siteUrl || sp.o.siteId) + ') — ' + (r.migrated != null ? 'uploaded ' + r.migrated + ' local records' : 'loaded ' + r.loaded + ' records'));
      writeLocal();
    } catch (e) {
      sp.fail(e);
      console.error('  ! SharePoint not available — running from the local copy (' + DB_FILE + '). Changes will be sent when it is reachable.\n    ' + e.message);
    }
  }
  const codes = ensureSetupCodes();
  server.listen(PORT, HOST, () => {
    console.log('\n  Machine Hours Portal v' + Core.VERSION);
    console.log('  → ' + (TLS ? 'https' : 'http') + '://localhost:' + PORT);
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('    phones/tablets on the same network: ' + (TLS ? 'https' : 'http') + '://' + a.address + ':' + PORT);
    console.log('  Storage: ' + (pgStore ? 'PostgreSQL (local cache ' + DB_FILE + ')' : (sp ? 'SharePoint (local cache ' + DB_FILE + ')' : DB_FILE)));
    console.log('  Email:   ' + (mailer ? 'SMTP ' + process.env.SMTP_HOST : 'not configured — messages are written to data/outbox.log'));
    console.log('  Superusers (owners): ' + OWNERS.join(', '));
    for (const [email, code] of codes) console.log('\n  ► First-time superuser setup for ' + email + '\n    Sign in with that email and enter this one-time code:  ' + code + '\n    (also saved in data/superuser-setup-codes.txt, valid 7 days)');
    console.log('');
  });
})();

function loadEnvFile(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
