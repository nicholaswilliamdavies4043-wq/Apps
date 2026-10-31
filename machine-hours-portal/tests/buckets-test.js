// Bucket counter, buckets-per-truck and manual hours (API level).
// Needs a fresh server (file storage is fine) on BASE whose DATA_DIR is given (for the setup code).
'use strict';
const fs = require('fs');
const Core = require('../public/js/core.js');
const BASE = process.env.BASE || 'http://localhost:3998';
const DATA_DIR = process.env.DATA_DIR;
const OWNER = 'nicholas.william_davies_c@sandvik.com';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
async function api(method, p, body, token) {
  const r = await fetch(BASE + '/api/' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; }
  if (!r.ok) { const e = new Error(d.error || r.status); e.status = r.status; throw e; } return d;
}
const fails400 = async (fn) => { try { await fn(); return false; } catch (e) { return e.status === 400; } };

(async () => {
  const code = fs.readFileSync(DATA_DIR + '/superuser-setup-codes.txt', 'utf8').trim().split('\n').pop().split('→')[1].trim().split(' ')[0];
  const T = (await api('POST', 'auth/setup', { name: 'Nicholas', email: OWNER, code, password: 'Sandvik2026ok' })).token;
  const demo = await api('POST', 'demo', {}, T);
  const siteId = (demo.site || demo).id || (await api('GET', 'bootstrap', null, T)).sites[0].id;
  const U = (await api('POST', 'auth/signin', { name: 'Kofi', email: 'kofi@example.com' })).token; // regular user (operator)
  let data = await api('GET', 'sites/' + siteId + '/data', null, T);
  const L6 = data.machines.find((m) => m.name === 'Loader 6');
  ok(L6.type === 'Loader' && L6.bucketsPerTruck === 4 && (L6.bucketCount || 0) === 0, 'sample loader has type, 4 buckets/truck, counter 0');

  // counting (regular user may count)
  for (let i = 0; i < 3; i++) await api('POST', 'machines/' + L6.id + '/buckets', { delta: 1, opId: 'op_test_' + i }, U);
  let m = await api('POST', 'machines/' + L6.id + '/buckets', { delta: -1, opId: 'op_test_minus' }, U);
  ok(m.bucketCount === 2, 'operator counts +3 −1 → 2');
  m = await api('POST', 'machines/' + L6.id + '/buckets', { delta: 1, opId: 'op_test_0' }, U);
  ok(m.bucketCount === 2, 'replayed offline click (same opId) is not counted twice');
  for (let i = 0; i < 5; i++) m = await api('POST', 'machines/' + L6.id + '/buckets', { delta: -1, opId: 'op_dn_' + i }, U);
  ok(m.bucketCount === 0, 'count never goes below 0');
  ok(await fails400(() => api('POST', 'machines/' + L6.id + '/buckets', { delta: 1.5 }, U)), 'fractional change rejected');
  m = await api('POST', 'machines/' + L6.id + '/buckets', { set: 9, opId: 'op_set_9' }, U);
  ok(m.bucketCount === 9 && m.bucketCountBy === 'Kofi', 'set count; remembers who counted');
  const te = Core.truckEq(9, 4);
  ok(te.full === 2 && te.rest === 1 && te.trucks === 2.25, '9 buckets at 4/truck = 2 trucks + 1 bucket (2.25)');

  // machine type rules
  const truck = await api('POST', 'sites/' + siteId + '/machines', { name: 'Truck 1', type: 'Truck', openingTR: 0, openingRCC: 0 }, T);
  ok(await fails400(() => api('POST', 'machines/' + truck.id + '/buckets', { delta: 1 }, U)), 'no bucket counting on a truck');
  ok(await fails400(() => api('POST', 'sites/' + siteId + '/machines', { name: 'X', type: 'Spaceship' }, T)), 'unknown machine type rejected');
  ok(await fails400(() => api('PUT', 'machines/' + L6.id, { bucketsPerTruck: 0 }, T)), 'buckets per truck must be > 0');
  let denied = false; try { await api('PUT', 'machines/' + L6.id, { bucketsPerTruck: 5 }, U); } catch (e) { denied = e.status === 403; }
  ok(denied, 'regular user cannot change buckets per truck');

  // logging a shift takes the counted buckets off the counter
  const today = Core.localDate(Date.now());
  ok(await fails400(() => api('POST', 'sites/' + siteId + '/entries', { date: today, shift: 'Day', machineId: L6.id, trEnd: 99999, rccEnd: 99999, buckets: 2.5 }, U)), 'fractional buckets rejected');
  await api('POST', 'machines/' + L6.id + '/buckets', { delta: 1, opId: 'op_more' }, U); // counter now 10
  data = await api('GET', 'sites/' + siteId + '/data', null, T);
  const mt = Core.meters({ site: data.site, machines: data.machines, entries: data.entries })[L6.id];
  // tomorrow, so this row is the loader's latest (the sample already has today's rows)
  const e = await api('POST', 'sites/' + siteId + '/entries', { date: Core.addDays(today, 1), shift: 'Day', machineId: L6.id, trEnd: mt.tr + 7, rccEnd: mt.rcc + 1.5, buckets: 8, takeBuckets: true }, U);
  data = await api('GET', 'sites/' + siteId + '/data', null, T);
  ok(data.machines.find((x) => x.id === L6.id).bucketCount === 2, 'saving 8 of 10 counted buckets leaves 2 on the counter');

  // manual hours and trucks per row
  const c = Core.computeSite({ site: data.site, machines: data.machines, entries: data.entries });
  const row = c.rows.find((r) => r.id === e.id);
  ok(row.trHrs === 7 && row.rccHrs === 1.5 && row.manualHrs === 3.5, 'manual hrs = 12 − 7 TR − 1.5 RCC = 3.5 (got ' + row.manualHrs + ')');
  ok(row.trucks === 2, 'row: 8 buckets = 2 trucks');
  const A = Core.analytics({ site: data.site, machines: data.machines, entries: data.entries }, today.slice(0, 7), c);
  const pm = A.perMachine.find((p) => p.machine.id === L6.id);
  ok(pm.manual > 0 && pm.buckets > 0 && pm.trucks === Core.r2(pm.buckets / 4), 'month totals: manual ' + pm.manual + ' h, ' + pm.buckets + ' buckets ≈ ' + pm.trucks + ' trucks');
  const long = c.rows.find((r) => r.valid && r.total >= 12);
  ok(!long || long.manualHrs === 0, 'manual hrs never negative');

  console.log(fails ? '\nFAILED: ' + fails : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
