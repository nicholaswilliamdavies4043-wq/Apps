// Older SharePoint sites: the v1.3 lists (MineLevels, BucketCounts, Inventory, InventoryMovements) do not exist yet.
// The portal must keep working, and start syncing them once they are created.
// Expects: mock on MOCK_PORT (default 3990) with all lists already created and filled by e2e-test.js on a STORAGE=sharepoint server.
// ROOT = this project folder. Starts its own server on 3996 with an empty data folder and SP_CREATE_LISTS=false.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.env.ROOT;
const MOCK = 'http://localhost:' + (process.env.MOCK_PORT || 3990);
const B = 'http://localhost:3996';
const OWNER = 'nicholas.william_davies_c@sandvik.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const AUTH = { headers: { Authorization: 'Bearer mock-token' } };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; } };
async function api(method, p, body, token) {
  const r = await fetch(B + '/api/' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const d = await j(r); if (!r.ok) { const e = new Error(d.error || r.status); e.status = r.status; throw e; } return d;
}
function start(dir, create) {
  const env = Object.assign({}, process.env, {
    PORT: '3996', DATA_DIR: dir, STORAGE: 'sharepoint', SP_TENANT_ID: 't', SP_CLIENT_ID: 'c', SP_CLIENT_SECRET: 's',
    SP_SITE_URL: 'https://contoso.sharepoint.com/sites/MachineHours', SP_GRAPH_BASE: MOCK + '/v1.0', SP_LOGIN_BASE: MOCK + '/login', SP_CREATE_LISTS: create ? 'true' : 'false'
  });
  let log = ''; const p = spawn('node', ['server.js'], { cwd: ROOT, env }); p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d)); p.log = () => log; return p;
}
const up = async () => { for (let i = 0; i < 60; i++) { try { await fetch(B + '/api/health'); return; } catch (e) { await sleep(250); } } };

(async () => {
  const NEW = ['MHP_MineLevels', 'MHP_BucketCounts', 'MHP_Inventory', 'MHP_InventoryMovements'];
  for (const n of NEW) await fetch(MOCK + '/v1.0/_test/droplist?list=' + n, Object.assign({ method: 'POST' }, AUTH));
  let st = await j(await fetch(MOCK + '/v1.0/_test/state', AUTH));
  ok(st.lists.length === 12 && !st.lists.some((l) => NEW.includes(l.name)), 'older site: only the 12 original lists');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhp-opt-'));
  let s = start(dir, false); await up(); await sleep(1500);
  const h = await j(await fetch(B + '/api/health'));
  ok(h.storage === 'sharepoint', 'server starts on SharePoint without the new lists (storage: ' + h.storage + ')');
  ok(/not yet created/.test(s.log()) && !/SharePoint not available/.test(s.log()), 'logs which lists are not created yet, and stays connected');
  const code = fs.readFileSync(path.join(dir, 'superuser-setup-codes.txt'), 'utf8').trim().split('\n').pop().split('→')[1].trim().split(' ')[0];
  const T = (await api('POST', 'auth/setup', { name: 'Nicholas Davies', email: OWNER, code, password: 'Quarry2026x' })).token;
  const storage = await api('GET', 'admin/storage', null, T);
  ok(storage.mode === 'sharepoint' && storage.connected, 'Data source page: SharePoint, connected');
  const sites = (await api('GET', 'bootstrap', null, T)).sites;
  ok(sites.length >= 1, 'existing data loads from SharePoint (' + sites.length + ' site)');
  const sid = sites[0].id;
  let data = await api('GET', 'sites/' + sid + '/data', null, T);
  ok(data.entries.length >= 240 && Array.isArray(data.inventory), 'shift rows load (' + data.entries.length + ') and the new collections are available');
  const it = await api('POST', 'sites/' + sid + '/inventory', { name: 'Test item', location: 'Store 1', quantity: 5 }, T);
  await api('POST', 'inventory/' + it.id + '/move', { kind: 'pick', qty: 2 }, T);
  await api('POST', 'sites/' + sid + '/entries', { date: '2030-01-01', shift: 'Day', machineId: data.machines.find((m) => m.active !== false).id, trEnd: 99999, rccEnd: 99999 }, T);
  await sleep(2500);
  st = await j(await fetch(MOCK + '/v1.0/_test/state', AUTH));
  ok(st.lists.find((l) => l.name === 'MHP_ShiftEntries').count === data.entries.length + 1, 'other changes still reach SharePoint');
  ok((await api('GET', 'sites/' + sid + '/data', null, T)).inventory.find((x) => x.id === it.id).quantity === 3, 'inventory works on the server meanwhile');
  s.kill(); await sleep(800);

  // a site owner creates the new lists (here: restart with SP_CREATE_LISTS=true, same data folder)
  s = start(dir, true); await up(); await sleep(3000);
  st = await j(await fetch(MOCK + '/v1.0/_test/state', AUTH));
  ok(st.lists.length === 16, 'after the lists are created: 16 lists');
  const invList = st.lists.find((l) => l.name === 'MHP_Inventory'), moves = st.lists.find((l) => l.name === 'MHP_InventoryMovements');
  ok(invList && invList.count >= 1 && moves && moves.count >= 2, 'inventory kept on the server is uploaded (' + (invList && invList.count) + ' items, ' + (moves && moves.count) + ' movements)');
  s.kill();
  console.log(fails ? '\nFAILED: ' + fails : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
