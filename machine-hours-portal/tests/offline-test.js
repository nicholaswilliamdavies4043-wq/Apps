// Offline test (jsdom): work without a connection, then reconnect and check everything reached the server.
// Needs a running server on BASE (file storage is fine) whose DATA_DIR is given (for the setup code).
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const ES = require('eventsource');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3998/';
const DATA_DIR = process.env.DATA_DIR || '/tmp/mhd2';
const OWNER = 'nicholas.william_davies_c@sandvik.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = []; let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const lastCode = (email) => { const l = fs.readFileSync(DATA_DIR + '/superuser-setup-codes.txt', 'utf8').trim().split('\n').filter((x) => x.includes(email)).pop(); return l.split('→')[1].trim().split(' ')[0]; };

async function open(label, seedStorage, startOffline) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented|getContext|Could not load/.test(e.message)) errors.push(label + ': ' + e.message + ' ' + (e.detail && e.detail.stack || '')); });
  const html = await (await fetch(BASE)).text();
  const net = { offline: !!startOffline };
  const dom = new JSDOM(html, {
    url: BASE, runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      if (seedStorage) for (const [k, v] of Object.entries(seedStorage)) w.localStorage.setItem(k, v);
      // a fetch we can switch off to simulate losing signal (static files still load: they are the "cached app")
      w.fetch = (u, o) => { const url = new URL(u, BASE); if (net.offline && url.pathname.startsWith('/api/')) return Promise.reject(new TypeError('Failed to fetch')); return fetch(url, o); };
      w.EventSource = function (u) { if (net.offline) { const fake = { close() {}, readyState: 0 }; setTimeout(() => fake.onerror && fake.onerror(), 10); return fake; } return new ES(new URL(u, BASE).href); };
      w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.scrollTo = () => {};
      w.addEventListener('error', (e) => errors.push(label + ' window: ' + e.message));
    }
  });
  await sleep(1300);
  return { w: dom.window, net };
}
const txt = (w, s) => { const e = w.document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
const setVal = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));

(async () => {
  // --- sign in as owner and load the sample site (online)
  let { w, net } = await open('A');
  const f = w.document.querySelector('#si');
  f.elements.name.value = 'Nicholas'; f.elements.email.value = OWNER; submit(w, f); await sleep(600);
  f.elements.code.value = lastCode(OWNER); f.elements.newpw.value = 'Sandvik2026ok'; f.elements.newpw2.value = 'Sandvik2026ok'; submit(w, f); await sleep(1200);
  ok(w.App.isSuper(), 'owner signed in');
  w.document.querySelector('[data-demo]').click(); await sleep(1500);
  const siteId = w.App.S.siteId;
  const before = w.App.S.data.entries.length;
  w.location.hash = '#/fleet/log'; await sleep(500);

  // --- lose signal
  net.offline = true;
  window_dispatch(w, 'offline'); await sleep(200);
  ok(w.API.offline && !w.document.querySelector('#netPill').classList.contains('hidden') && /Offline/.test(txt(w, '#netPill')), 'offline pill shown: ' + txt(w, '#netPill'));
  // log a shift row offline
  const ef = w.document.querySelector('.entry-form');
  setVal(w, ef.elements.date, w.Core.addDays(w.Core.localDate(Date.now()), 1));
  const L6 = [...ef.elements.machineId.options].find((o) => o.textContent === 'Loader 6').value;
  setVal(w, ef.elements.machineId, L6); await sleep(50);
  const pv = txt(w, '[data-preview]');
  const trS = Number(pv.match(/TR start\s*([\d,.]+)/)[1].replace(/,/g, '')), rcS = Number(pv.match(/RCC start\s*([\d,.]+)/)[1].replace(/,/g, ''));
  setVal(w, ef.elements.trEnd, String(trS + 7)); setVal(w, ef.elements.rccEnd, String(rcS + 1));
  submit(w, ef); await sleep(600);
  ok(w.App.S.data.entries.length === before + 1, 'shift row saved on the device while offline');
  ok(w.API.outbox.length === 1 && /1 waiting/.test(txt(w, '#netPill')), 'queued: ' + txt(w, '#netPill'));
  // chat + maintenance completion offline
  w.location.hash = '#/chat/general'; await sleep(400);
  const ta = w.document.querySelector('[data-compose] textarea'); ta.value = 'written underground, no signal';
  submit(w, w.document.querySelector('[data-compose]')); await sleep(400);
  ok(/written underground/.test(txt(w, '[data-msgs]')), 'chat message shows immediately offline');
  const mt = w.App.S.data.maintenance.find((m) => m.status !== 'done');
  await w.API.post('maintenance/' + mt.id + '/complete', { notes: 'done offline' }); await sleep(200);
  ok(w.API.outbox.length === 3, '3 changes waiting (' + w.API.outbox.length + ')');
  let blocked = false; try { await w.API.post('sites', { name: 'X' }); } catch (e) { blocked = !!e.offline || e.status === 403; }
  ok(blocked, 'actions that need the server explain they need a connection');

  // --- app reopened with no signal (device copy + queue survive)
  const seed = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); seed[k] = w.localStorage.getItem(k); }
  const B = await open('B', seed, true);
  ok(B.w.API.mode === 'server' && B.w.API.offline, 'reopened offline in server mode (not demo)');
  ok(!!B.w.document.querySelector('.topbar') && B.w.App.S.data && B.w.App.S.data.entries.length === before + 1, 'opens from the device copy incl. the offline row');
  ok(B.w.API.outbox.length === 3, 'queue survived reopening');

  // --- signal back: B sends everything
  B.net.offline = false;
  window_dispatch(B.w, 'online'); await sleep(2500);
  ok(B.w.API.outbox.length === 0, 'queue sent after reconnecting');
  const tok = B.w.API.token;
  const data = await (await fetch(BASE + 'api/sites/' + siteId + '/data', { headers: { Authorization: 'Bearer ' + tok } })).json();
  ok(data.entries.length === before + 1, 'server has the offline shift row (' + data.entries.length + ')');
  ok(data.messages.some((m) => m.text === 'written underground, no signal'), 'server has the offline chat message');
  ok(data.maintLog.some((l) => l.notes === 'done offline'), 'server has the offline maintenance completion');
  const row = data.entries.find((e) => !w.App.S.data.entries.slice(0, before).some((x) => x.id === e.id));
  ok(row && row.loggedOfflineAt, 'row keeps the time it was logged offline');
  // replaying the same queued item again is harmless
  const q = JSON.parse(seed['mhp.outbox.v1'])[0];
  await fetch(BASE + 'api/' + q.path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(q.body) });
  const data2 = await (await fetch(BASE + 'api/sites/' + siteId + '/data', { headers: { Authorization: 'Bearer ' + tok } })).json();
  ok(data2.entries.length === before + 1, 'sending the same change twice does not duplicate it');
  // A also reconnects: its own queue is the same changes → no duplicates either
  net.offline = false; window_dispatch(w, 'online'); await sleep(2500);
  const data3 = await (await fetch(BASE + 'api/sites/' + siteId + '/data', { headers: { Authorization: 'Bearer ' + tok } })).json();
  ok(data3.entries.length === before + 1 && data3.messages.filter((m) => m.text === 'written underground, no signal').length === 1, 'second device replay also de-duplicated');
  // phone page
  const nw = await (await fetch(BASE + 'api/network')).json();
  ok(Array.isArray(nw.urls), 'network endpoint lists addresses: ' + nw.urls.join(', '));
  B.w.App.phoneModal(); await sleep(400);
  ok(!!B.w.document.querySelector('.qr svg') || nw.urls.length === 0, 'QR code rendered in "Use on phone" dialog');
  const sw = await fetch(BASE + 'sw.js');
  ok(sw.status === 200 && /no-cache/.test(sw.headers.get('cache-control')), 'service worker served (no-cache)');
  console.log('\nERRORS (' + errors.length + '):\n' + errors.join('\n'));
  console.log(fails || errors.length ? 'FAILED ' + fails : 'ALL OFFLINE CHECKS PASSED');
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e, errors); process.exit(2); });

function window_dispatch(w, type) { w.dispatchEvent(new w.Event(type)); }
