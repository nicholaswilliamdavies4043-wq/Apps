// SharePoint storage test against tests/mock-graph.js.
// Expects: mock on MOCK (default 3990) and server #1 (STORAGE=sharepoint) already populated by e2e-test.js on BASE1.
// Starts server #2 itself with an empty data folder to prove the data comes back from SharePoint.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const MOCK = 'http://localhost:' + (process.env.MOCK_PORT || 3990);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; } };
const mock = async (p, body) => j(await fetch(MOCK + '/v1.0' + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer mock-token', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
const OWNER = 'nicholas.william_davies_c@sandvik.com';

function startServer(port, dir) {
  const env = Object.assign({}, process.env, {
    PORT: String(port), DATA_DIR: dir, STORAGE: 'sharepoint', SP_TENANT_ID: 't', SP_CLIENT_ID: 'c', SP_CLIENT_SECRET: 's',
    SP_SITE_URL: 'https://contoso.sharepoint.com/sites/MachineHours', SP_GRAPH_BASE: MOCK + '/v1.0', SP_LOGIN_BASE: MOCK + '/login', SP_CREATE_LISTS: 'true'
  });
  const p = spawn('node', ['server.js'], { cwd: ROOT, env });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.log = () => log;
  return p;
}
async function api(base, method, p, body, token) {
  const r = await fetch(base + '/api/' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const d = await j(r); if (!r.ok) { const e = new Error(d.error || r.status); e.status = r.status; e.data = d; throw e; } return d;
}

(async () => {
  const st = await mock('/_test/state');
  const by = Object.fromEntries(st.lists.map((l) => [l.name, l]));
  ok(st.lists.length === 16, '16 SharePoint lists created: ' + st.lists.map((l) => l.name).join(', '));
  ok(by.MHP_ShiftEntries.count > 200, 'ShiftEntries rows in SharePoint: ' + by.MHP_ShiftEntries.count);
  ok(by.MHP_Sites.count === 2 && by.MHP_Machines.count === 4, 'sites ' + by.MHP_Sites.count + ', machines ' + by.MHP_Machines.count);
  ok(by.MHP_AuditLog.count > 3 && by.MHP_Users.count >= 2 && by.MHP_Widgets.count === 1, 'audit ' + by.MHP_AuditLog.count + ', users ' + by.MHP_Users.count + ', widgets ' + by.MHP_Widgets.count);
  ok(st.stats.batch > 0, 'writes went through $batch (' + st.stats.batch + ' batches)');
  const entries = await mock('/_test/items?list=MHP_ShiftEntries');
  const e1 = entries.find((x) => x.fields.TotalHours != null && x.fields.CheckResult === 'OK');
  ok(!!e1 && e1.fields.MachineName && e1.fields.TRStart != null && e1.fields.TRHours != null, 'computed columns written (start, hours, check, machine name): ' + (e1 && e1.fields.Title));
  ok(entries.some((x) => /^✗ TR End < Start/.test(x.fields.CheckResult || '')), 'flagged row has CheckResult ✗');
  const users = await mock('/_test/items?list=MHP_Users');
  ok(users.some((u) => u.fields.UserEmail === OWNER && u.fields.AppRole === 'Superuser'), 'owner shown as Superuser in Users list');
  ok(!JSON.stringify(users).includes('"hash"') && !JSON.stringify(await mock('/_test/state')).includes('creds'), 'no password data in SharePoint');

  // ---- a brand-new server with an EMPTY data folder loads everything from SharePoint
  const dir2 = fs.mkdtempSync('/tmp/mhd-sp2-');
  const s2 = startServer(3997, dir2);
  await sleep(2500);
  const B2 = 'http://localhost:3997';
  ok(/SharePoint connected/.test(s2.log()), 'server #2 connected to SharePoint');
  const reg = await api(B2, 'POST', 'auth/signin', { name: 'Kofi', email: 'kofi@example.com' });
  const boot = await api(B2, 'GET', 'bootstrap', null, reg.token);
  ok(boot.sites.length === 2, 'server #2 sees both sites from SharePoint');
  const demo = boot.sites.find((s) => /Demo/.test(s.name));
  const d2 = await api(B2, 'GET', 'sites/' + demo.id + '/data', null, reg.token);
  ok(d2.entries.length === by.MHP_ShiftEntries.count && d2.machines.length === 4 && d2.maintenance.length >= 5, 'server #2 has all rows: ' + d2.entries.length + ' entries, ' + d2.maintenance.length + ' schedules');
  ok(d2.entries.every((e) => typeof e.trEnd === 'number' && e.date), 'records round-trip intact');
  // owner superuser on server #2 (credentials are per server → new setup code)
  const codeLine = fs.readFileSync(path.join(dir2, 'superuser-setup-codes.txt'), 'utf8').trim().split('\n').pop();
  const code = codeLine.split('→')[1].trim().split(' ')[0];
  let need = null; try { await api(B2, 'POST', 'auth/signin', { name: 'Nicholas', email: OWNER }); } catch (e) { need = e.data; }
  ok(need && need.needSetup, 'owner email needs setup on new server');
  const su = await api(B2, 'POST', 'auth/setup', { name: 'Nicholas Davies', email: OWNER, code, password: 'Quarry2026x' });
  ok(su.user.isSuper, 'owner superuser on server #2');

  // ---- edit made directly in SharePoint shows up after sync
  const L6 = d2.machines.find((m) => m.name === 'Loader 6');
  await mock('/_test/edit', { list: 'MHP_Machines', appId: L6.id, fields: { Model: 'LH517i (edited in SharePoint)', OpeningTR: 4500 } });
  await mock('/_test/add', { list: 'MHP_Operators', fields: { Title: 'Kwesi (from SharePoint)', SiteId: demo.id } });
  const sync = await api(B2, 'POST', 'admin/storage/sync', {}, su.token);
  ok(sync.changed === true, 'sync picked up SharePoint changes');
  const d3 = await api(B2, 'GET', 'sites/' + demo.id + '/data', null, reg.token);
  const L6b = d3.machines.find((m) => m.id === L6.id);
  ok(L6b.model === 'LH517i (edited in SharePoint)' && L6b.openingTR === 4500, 'machine edit from SharePoint applied (model + opening reading)');
  ok(d3.operators.some((o) => o.name === 'Kwesi (from SharePoint)'), 'row added in SharePoint appears as operator');
  await sleep(2500);
  const ops = await mock('/_test/items?list=MHP_Operators');
  const kw = ops.find((o) => /Kwesi/.test(o.fields.Title));
  ok(kw && kw.fields.AppId && kw.fields.AppJson, 'app wrote AppId/AppJson back to the new SharePoint row');
  // ---- change in app → SharePoint
  await api(B2, 'POST', 'sites/' + demo.id + '/messages', { channel: 'general', text: 'hello from server 2' }, reg.token);
  await sleep(2500);
  const msgs = await mock('/_test/items?list=MHP_ChatMessages');
  ok(msgs.some((m) => m.fields.MessageText === 'hello from server 2' && m.fields.ChannelName === '#general'), 'new chat message written to SharePoint');
  // ---- delete in app → deleted in SharePoint
  const before = (await mock('/_test/items?list=MHP_Announcements')).length;
  const ann = d3.announcements[0];
  await api(B2, 'DELETE', 'announcements/' + ann.id, null, su.token);
  await sleep(2500);
  ok((await mock('/_test/items?list=MHP_Announcements')).length === before - 1, 'deleted announcement removed from SharePoint');
  const status = await api(B2, 'GET', 'admin/storage', null, su.token);
  ok(status.mode === 'sharepoint' && status.connected && !status.pending, 'storage status: connected, nothing pending');
  s2.kill();
  console.log(fails ? '\nFAILED ' + fails : '\nALL SHAREPOINT CHECKS PASSED');
  if (fails) console.log(s2.log());
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
