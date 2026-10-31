// "Remember me" sessions (30 days / 12 hours), sessions surviving a restart (file and PostgreSQL), and the keep-alive ping.
// Starts its own servers on port 3995. ROOT = this project folder. Optional: DATABASE_URL for the PostgreSQL part.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const B = 'http://localhost:3995';
const OWNER = 'nicholas.william_davies_c@sandvik.com';
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
async function api(method, p, body, token) {
  const r = await fetch(B + '/api/' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; }
  if (!r.ok) { const e = new Error(d.error || r.status); e.status = r.status; throw e; } return d;
}
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };
function start(dir, env) {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3995', DATA_DIR: dir, DATABASE_URL: '', STORAGE: 'file', KEEP_ALIVE_URL: '', RENDER_EXTERNAL_URL: '' }, env || {}) });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d)); p.log = () => log; return p;
}
const up = async () => { for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/health'); return; } catch (e) { await sleep(250); } } };
const stop = async (p) => { p.kill('SIGTERM'); await new Promise((r) => p.on('exit', r)); };

(async () => {
  console.log('Remember me (file storage):');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-sess-'));
  let s = start(dir); await up();
  const t0 = Date.now();
  const long = await api('POST', 'auth/signin', { name: 'Kofi', email: 'kofi@example.com', remember: true });
  const short = await api('POST', 'auth/signin', { name: 'Ama', email: 'ama@example.com', remember: false });
  const legacy = await api('POST', 'auth/signin', { name: 'Yaw', email: 'yaw@example.com' });
  ok(Math.abs(long.expiresAt - (t0 + 30 * DAY)) < 60000, 'Remember me → signed in for 30 days');
  ok(Math.abs(short.expiresAt - (t0 + 12 * 3600000)) < 60000, 'not ticked → 12 hours (one shift)');
  ok(Math.abs(legacy.expiresAt - (t0 + 12 * 3600000)) < 60000, 'no choice sent → 12 hours');
  ok((await api('GET', 'bootstrap', null, long.token)).user.name === 'Kofi', 'token works');
  await stop(s);
  s = start(dir); await up();
  ok((await api('GET', 'bootstrap', null, long.token)).user.name === 'Kofi', 'still signed in after a server restart');
  await stop(s);
  // expire both sessions in the saved data, as if the time had passed
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  for (const x of Object.values(db.sessions)) x.expiresAt = Date.now() - 1000;
  const legacyTok = Object.keys(db.sessions)[0];
  db.sessions['old' + legacyTok.slice(3)] = { userId: db.users[0].id, createdAt: Date.now() - 31 * DAY, lastSeen: Date.now() - DAY }; // signed in before this change
  db.sessions['new' + legacyTok.slice(3)] = { userId: db.users[0].id, createdAt: Date.now() - 2 * DAY, lastSeen: Date.now() - DAY };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
  s = start(dir); await up();
  ok(await status(() => api('GET', 'bootstrap', null, long.token)) === 401, 'after 30 days the user is asked to sign in again');
  ok(await status(() => api('GET', 'bootstrap', null, 'old' + legacyTok.slice(3))) === 401, 'sessions from before this change end 30 days after sign-in');
  ok(await status(() => api('GET', 'bootstrap', null, 'new' + legacyTok.slice(3))) === 200, '…and keep working until then (no one is signed out by the update)');
  // superuser with remember
  const code = fs.readFileSync(path.join(dir, 'superuser-setup-codes.txt'), 'utf8').trim().split('\n').pop().split('→')[1].trim().split(' ')[0];
  const su = await api('POST', 'auth/setup', { name: 'Nicholas', email: OWNER, code, password: 'Sandvik2026ok', remember: true });
  ok(Math.abs(su.expiresAt - (Date.now() + 30 * DAY)) < 60000, 'superuser sign-in honours Remember me too');
  const su2 = await api('POST', 'auth/signin', { name: 'Nicholas', email: OWNER, password: 'Sandvik2026ok', remember: false });
  ok(Math.abs(su2.expiresAt - (Date.now() + 12 * 3600000)) < 60000, 'superuser without Remember me → 12 hours');
  const h = await api('GET', 'health');
  ok(h.keepAlive === false, 'keep-alive off when no public address is configured');
  await stop(s);

  console.log('Keep-alive:');
  s = start(fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-ka-')), { KEEP_ALIVE_URL: B + '/', KEEP_ALIVE_MINUTES: '10' }); await up();
  ok(/Keep-alive: pinging http:\/\/localhost:3995 every 10 min/.test(s.log()), 'server announces the keep-alive (every 10 min)');
  await sleep(32000); // first ping 30 s after start
  const k = (await api('GET', 'health')).keepAlive;
  ok(k && k.everyMinutes === 10 && k.ok === true && Date.now() - Date.parse(k.lastPing) < 10000, 'first ping reached the public address (health shows ok)');
  await stop(s);
  s = start(fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-ka-')), { RENDER_EXTERNAL_URL: B }); await up();
  ok((await api('GET', 'health')).keepAlive.everyMinutes === 10, 'on Render it switches on by itself (RENDER_EXTERNAL_URL)');
  await stop(s);
  s = start(fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-ka-')), { RENDER_EXTERNAL_URL: B, KEEP_ALIVE: 'off' }); await up();
  ok((await api('GET', 'health')).keepAlive === false, 'KEEP_ALIVE=off turns it off');
  await stop(s);

  if (process.env.DATABASE_URL_TEST) {
    console.log('PostgreSQL (Render-style restart with an empty disk):');
    const env = { STORAGE: 'postgres', DATABASE_URL: process.env.DATABASE_URL_TEST };
    s = start(fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-pg-')), env); await up();
    const t = (await api('POST', 'auth/signin', { name: 'Esi', email: 'esi@example.com', remember: true })).token;
    await sleep(800); await stop(s);
    s = start(fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-pg-')), env); await up();
    ok((await api('GET', 'bootstrap', null, t)).user.name === 'Esi', 'still signed in after a restart on a wiped disk (session kept in PostgreSQL)');
    await stop(s);
  }
  console.log(fails ? '\nFAILED: ' + fails : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
