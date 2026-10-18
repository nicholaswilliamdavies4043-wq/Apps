// One-click SharePoint connect test: file-mode server → Superuser connects via the API the UI uses → disconnect.
// Needs: mock-graph on MOCK_PORT, server (STORAGE=file, SP_GRAPH_BASE/SP_LOGIN_BASE → mock) on BASE, its DATA_DIR.
'use strict';
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3994';
const DATA_DIR = process.env.DATA_DIR;
const MOCK = 'http://localhost:' + (process.env.MOCK_PORT || 3990);
const OWNER = 'nicholas.william_davies_c@sandvik.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
async function api(method, p, body, token) {
  const r = await fetch(BASE + '/api/' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; }
  if (!r.ok) { const e = new Error(d.error || r.status); e.status = r.status; throw e; } return d;
}
(async () => {
  const code = fs.readFileSync(DATA_DIR + '/superuser-setup-codes.txt', 'utf8').trim().split('\n').pop().split('→')[1].trim().split(' ')[0];
  const su = await api('POST', 'auth/setup', { name: 'Nicholas', email: OWNER, code, password: 'Sandvik2026ok' });
  const T = su.token;
  await api('POST', 'demo', {}, T);
  const reg = await api('POST', 'auth/signin', { name: 'Kofi', email: 'kofi@example.com' });
  let st = await api('GET', 'admin/storage', null, T);
  ok(st.mode === 'file', 'starts on the local file');
  // regular users can't
  let denied = false; try { await api('POST', 'admin/storage/test', { siteUrl: 'https://contoso.sharepoint.com/sites/X' }, reg.token); } catch (e) { denied = e.status === 403; }
  ok(denied, 'regular user cannot connect SharePoint');
  // bad inputs explained
  let msg = ''; try { await api('POST', 'admin/storage/test', { siteUrl: 'https://example.com/x', clientId: 'x', clientSecret: 'y' }, T); } catch (e) { msg = e.message; }
  ok(/SharePoint site/.test(msg), 'wrong link explained: ' + msg);
  const form = { siteUrl: 'https://contoso.sharepoint.com/sites/MachineHours/Lists/Whatever/AllItems.aspx', clientId: '11111111-2222-3333-4444-555555555555', clientSecret: 'secret', createLists: true };
  // listen for the reload broadcast like a browser would
  const ES = require('eventsource'); const es = new ES(BASE + '/api/events?token=' + reg.token); let reload = null;
  es.onmessage = (m) => { const ev = JSON.parse(m.data); if (ev.type === 'reload-app') reload = ev; };
  const t = await api('POST', 'admin/storage/test', form, T);
  ok(t.ok && t.steps.length === 4 && t.steps.every((s) => s.ok), 'test: ' + t.steps.map((s) => s.label + ' (' + (s.info || '') + ')').join(' → '));
  const c = await api('POST', 'admin/storage/connect', form, T);
  ok(c.ok && c.migrated > 200, 'connected and copied ' + c.migrated + ' records to SharePoint');
  await sleep(1200);
  ok(reload && /SharePoint/.test(reload.reason), 'all open apps told to reload');
  st = await api('GET', 'admin/storage', null, T);
  ok(st.mode === 'sharepoint' && st.connected && st.config.siteUrl === 'https://contoso.sharepoint.com/sites/MachineHours' && st.config.tenantId === 'contoso.onmicrosoft.com' && st.config.secretSet && !JSON.stringify(st).includes('"secret"'),
    'status: SharePoint, link cleaned to the site, tenant worked out, secret not sent back');
  const ms = await (await fetch(MOCK + '/v1.0/_test/state', { headers: { Authorization: 'Bearer mock-token' } })).json();
  ok(ms.lists.length === 12 && ms.lists.find((l) => l.name === 'MHP_ShiftEntries').count === 240, 'lists created automatically and filled');
  ok(fs.readdirSync(DATA_DIR + '/backups').some((f) => f.startsWith('before-sharepoint-')), 'backup taken before switching');
  ok(fs.existsSync(DATA_DIR + '/storage.json'), 'connection saved for next start');
  // new data goes to SharePoint without restart
  const site = (await api('GET', 'bootstrap', null, reg.token)).sites[0];
  await api('POST', 'sites/' + site.id + '/messages', { channel: 'general', text: 'after one-click connect' }, reg.token);
  await sleep(2500);
  const msgs = await (await fetch(MOCK + '/v1.0/_test/items?list=MHP_ChatMessages', { headers: { Authorization: 'Bearer mock-token' } })).json();
  ok(msgs.some((m) => m.fields.MessageText === 'after one-click connect'), 'new changes go to SharePoint straight away (no restart)');
  // disconnect
  reload = null;
  await api('POST', 'admin/storage/disconnect', {}, T); await sleep(1000);
  st = await api('GET', 'admin/storage', null, T);
  ok(st.mode === 'file' && !fs.existsSync(DATA_DIR + '/storage.json') && reload, 'disconnected back to the local file (apps reloaded)');
  const d = await api('GET', 'sites/' + site.id + '/data', null, reg.token);
  ok(d.messages.some((m) => m.text === 'after one-click connect') && d.entries.length === 240, 'all data still there after disconnecting');
  es.close();
  const audit = await api('GET', 'admin/audit', null, T);
  ok(audit.some((a) => a.action === 'Connected data source to SharePoint') && audit.some((a) => a.action === 'Disconnected SharePoint'), 'connect/disconnect in audit log');
  console.log(fails ? 'FAILED ' + fails : 'ALL CONNECT CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
