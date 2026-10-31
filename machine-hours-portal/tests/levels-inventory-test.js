// Mine levels + saved bucket counts per shift (06:00 / 18:00 GMT), and the inventory (API level).
// Part 1 runs the shift logic directly on core.js (no server). Part 2 needs a fresh server on BASE with its DATA_DIR.
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
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };

(async () => {
  console.log('Shift clock and end-of-shift rollover (core):');
  const at = (iso) => Core.shiftAt(Date.parse(iso));
  ok(at('2026-10-31T06:00:00Z').key === '2026-10-31|Day' && at('2026-10-31T17:59:59Z').key === '2026-10-31|Day', 'Day = 06:00–17:59 GMT');
  ok(at('2026-10-31T18:00:00Z').key === '2026-10-31|Night' && at('2026-11-01T05:59:59Z').key === '2026-10-31|Night', 'Night = 18:00–05:59 GMT, dated by its start');
  const db = Core.emptyDB();
  const m = { id: 'm_aaaaaaaa', siteId: 's_1', name: 'L1', type: 'Loader', bucketsPerTruck: 4, bucketCount: 7, bucketLevel: '420', bucketShiftKey: '2026-10-31|Day' };
  const m2 = { id: 'm_bbbbbbbb', siteId: 's_1', name: 'L2', type: 'Loader', bucketCount: 3, bucketLevel: null, bucketShiftKey: '2026-10-31|Day' };
  db.machines.push(m, m2);
  ok(Core.liveBuckets(m, Date.parse('2026-10-31T17:00:00Z')) === 7 && Core.liveBuckets(m, Date.parse('2026-10-31T18:00:00Z')) === 0, 'live count shows 0 once the shift has ended');
  let r = Core.rollBuckets(db, Date.parse('2026-10-31T17:59:00Z'));
  ok(!r.dirty && db.bucketLogs.length === 0, 'nothing happens before 18:00');
  r = Core.rollBuckets(db, Date.parse('2026-10-31T18:01:00Z'));
  const auto = db.bucketLogs.find((l) => l.machineId === m.id);
  ok(r.dirty && auto && auto.auto && auto.buckets === 7 && auto.level === '420' && auto.shiftKey === '2026-10-31|Day' && auto.perTruck === 4, 'at 18:00 the unsaved 7 buckets are auto-saved to level 420 for the Day shift');
  ok(db.bucketLogs.some((l) => l.machineId === m2.id && l.buckets === 3 && l.level === null), 'count without a level is kept (as "no level")');
  ok(m.bucketCount === 0 && m2.bucketCount === 0, 'counters reset to 0 for the Night shift');
  ok(!Core.rollBuckets(db, Date.parse('2026-10-31T18:02:00Z')).dirty, 'rollover runs once per shift change');

  console.log('Levels and saved bucket counts (server):');
  const code = fs.readFileSync(DATA_DIR + '/superuser-setup-codes.txt', 'utf8').trim().split('\n').pop().split('→')[1].trim().split(' ')[0];
  const T = (await api('POST', 'auth/setup', { name: 'Nicholas', email: OWNER, code, password: 'Sandvik2026ok' })).token;
  await api('POST', 'demo', {}, T);
  const siteId = (await api('GET', 'bootstrap', null, T)).sites[0].id;
  const U = (await api('POST', 'auth/signin', { name: 'Kofi', email: 'kofi@example.com' })).token;
  const U2 = (await api('POST', 'auth/signin', { name: 'Ama', email: 'ama@example.com' })).token;
  let data = await api('GET', 'sites/' + siteId + '/data', null, T);
  ok(data.levels.map((l) => l.name).join(',') === '420,445,470,495', 'sample site has levels 420, 445, 470, 495');
  ok(await status(() => api('POST', 'sites/' + siteId + '/levels', { name: '520' }, U)) === 200, 'regular user can add a level (same rule as operators/telehuts)');
  ok(await status(() => api('POST', 'sites/' + siteId + '/levels', { name: '520' }, T)) === 409, 'duplicate level rejected');
  const L9 = data.machines.find((x) => x.name === 'Loader 9');
  const B = 'machines/' + L9.id + '/buckets';
  for (let i = 0; i < 6; i++) await api('POST', B, { delta: 1, opId: 'op_lv_' + i }, U);
  ok(await status(() => api('POST', B + '/save', { id: 'bl_nolevel1' }, U)) === 400, 'save without a level is refused');
  ok(await status(() => api('POST', B, { level: '999' }, U)) === 400, 'unknown level refused');
  let mm = await api('POST', B, { level: '445' }, U);
  ok(mm.bucketLevel === '445', 'operator selects level 445 (shared with other devices)');
  const sv = await api('POST', B + '/save', { id: 'bl_save00001' }, U);
  const sh = Core.shiftAt(Date.now());
  ok(sv.log.buckets === 6 && sv.log.level === '445' && sv.log.shiftKey === sh.key && sv.log.perTruck === 4 && sv.machine.bucketCount === 0, 'Save stores 6 buckets for level 445 in the current shift (' + sh.key + ') and resets the counter');
  const again = await api('POST', B + '/save', { id: 'bl_save00001' }, U);
  data = await api('GET', 'sites/' + siteId + '/data', null, T);
  ok(again.log.id === 'bl_save00001' && data.bucketLogs.filter((l) => l.id === 'bl_save00001').length === 1, 'replayed offline save is stored once');
  ok(await status(() => api('POST', B + '/save', { id: 'bl_save00002' }, U)) === 400, 'saving a count of 0 is refused');
  for (let i = 0; i < 3; i++) await api('POST', B, { delta: 1, opId: 'op_lv2_' + i }, U);
  await api('POST', B + '/save', { id: 'bl_save00003', level: '470' }, U);
  data = await api('GET', 'sites/' + siteId + '/data', null, T);
  const mine = data.bucketLogs.filter((l) => l.machineId === L9.id && l.shiftKey === sh.key);
  ok(mine.length === 2 && mine.find((l) => l.level === '470').buckets === 3, 'second save this shift goes to level 470 (3 buckets)');
  ok(await status(() => api('POST', 'sites/' + siteId + '/bucketLogs', { level: '420', buckets: 5 }, U)) === 400, 'bucket counts can only be added with Save');
  ok(await status(() => api('DELETE', 'bucketLogs/bl_save00003', null, U2)) === 403, 'another operator cannot delete my saved count');
  ok(await status(() => api('DELETE', 'bucketLogs/bl_save00003', null, U)) === 200, 'I can delete my own saved count');

  console.log('Inventory (server):');
  const inv0 = data.inventory.length;
  ok(inv0 === 6 && data.invLog.length >= 9, 'sample site has 6 items and their movement history');
  const it = await api('POST', 'sites/' + siteId + '/inventory', { name: 'Grease cartridge', partNo: 'GR-400', location: 'Lube bay', unit: 'pcs', quantity: 10, minQty: 4 }, U);
  ok(it.quantity === 10, 'operator adds an item with 10 in stock');
  ok(await status(() => api('POST', 'sites/' + siteId + '/inventory', { name: 'grease cartridge', location: 'lube bay', quantity: 1 }, U)) === 409, 'same item at the same location is refused');
  const other = await api('POST', 'sites/' + siteId + '/inventory', { name: 'Grease cartridge', location: 'Workshop store A1', quantity: 2 }, U);
  ok(other.id !== it.id, 'same item at another location is a separate stock line');
  const IM = 'inventory/' + it.id + '/move';
  let mv = await api('POST', IM, { id: 'il_pick00001', kind: 'pick', qty: 3, machineId: L9.id, note: 'WO 4471' }, U2);
  ok(mv.item.quantity === 7 && mv.log.change === -3 && mv.log.qtyAfter === 7 && mv.log.machineId === L9.id && mv.log.by === 'Ama', 'pick 3 → 7 left, logged with machine, note and who');
  mv = await api('POST', IM, { id: 'il_pick00001', kind: 'pick', qty: 3 }, U2);
  ok(mv.item.quantity === 7, 'replayed offline pick is deducted once');
  ok(await status(() => api('POST', IM, { kind: 'pick', qty: 8 }, U2)) === 409, 'cannot pick more than is in stock');
  ok(await status(() => api('POST', IM, { kind: 'pick', qty: 0 }, U2)) === 400, 'pick of 0 refused');
  mv = await api('POST', IM, { kind: 'receive', qty: 5 }, U);
  ok(mv.item.quantity === 12, 'receive 5 → 12');
  mv = await api('POST', IM, { kind: 'count', qty: 11, note: 'monthly count' }, U);
  ok(mv.item.quantity === 11 && mv.log.change === -1, 'stock count sets 11 (change −1 logged)');
  await api('PUT', 'inventory/' + it.id, { quantity: 999, location: 'Lube bay shelf 2' }, U);
  data = await api('GET', 'sites/' + siteId + '/data', null, T);
  const it2 = data.inventory.find((x) => x.id === it.id);
  ok(it2.quantity === 11 && it2.location === 'Lube bay shelf 2', 'editing details cannot change the quantity');
  ok(data.invLog.filter((l) => l.itemId === it.id).length === 4, 'history: opening stock, pick, receive, count (4 rows; the replayed pick is not logged twice)');
  await api('PUT', 'admin/settings', { allowUserInventoryEdit: false }, T);
  ok(await status(() => api('POST', IM, { kind: 'receive', qty: 1 }, U)) === 403, 'setting off: regular user cannot receive');
  ok(await status(() => api('POST', 'sites/' + siteId + '/inventory', { name: 'X', quantity: 1 }, U)) === 403, 'setting off: regular user cannot add items');
  ok((await api('POST', IM, { kind: 'pick', qty: 1 }, U)).item.quantity === 10, 'setting off: picking still allowed');
  ok(await status(() => api('DELETE', 'inventory/' + it.id, null, U)) === 403, 'regular user cannot delete items');
  ok(await status(() => api('DELETE', 'inventory/' + it.id, null, T)) === 200, 'superuser deletes the item');
  data = await api('GET', 'sites/' + siteId + '/data', null, T);
  ok(!data.inventory.some((x) => x.id === it.id) && data.invLog.some((l) => l.itemId === it.id), 'history is kept after the item is deleted');

  console.log(fails ? '\nFAILED: ' + fails : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
