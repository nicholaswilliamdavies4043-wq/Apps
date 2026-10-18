// Headless end-to-end test. Start the server on port 3998 first (see README), then: node tests/e2e-test.js
const { JSDOM, VirtualConsole } = require('jsdom');
const ES = require('eventsource');
const BASE = process.env.BASE || 'http://localhost:3998/';
const DATA_DIR = process.env.DATA_DIR || '/tmp/mhd2';
const OWNER = 'nicholas.william_davies_c@sandvik.com';
const fs = require('fs');
const lastCode = (email) => { const l = fs.readFileSync(DATA_DIR + '/superuser-setup-codes.txt', 'utf8').trim().split('\n').filter((x) => x.includes(email)).pop(); return l.split('→')[1].trim().split(' ')[0]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function open(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented|getContext|Could not load img|Could not load link/.test(e.message)) errors.push(label + ' jsdomError: ' + e.message + '\n' + (e.detail && e.detail.stack || '')); });
  vc.on('error', (...a) => { const s = a.map(String).join(' '); if (!/acquire context|getContext/.test(s)) errors.push(label + ' console.error: ' + s); });
  const html = await (await fetch(BASE)).text();
  const dom = new JSDOM(html, {
    url: BASE, runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE), o);
      w.EventSource = function (u) { return new ES(new URL(u, BASE).href); };
      w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.scrollTo = () => {};
      w.URL.createObjectURL = () => 'blob:x';
      w.addEventListener('error', (e) => errors.push(label + ' window error: ' + e.message + ' ' + (e.error && e.error.stack)));
      w.addEventListener('unhandledrejection', (e) => errors.push(label + ' unhandled: ' + (e.reason && e.reason.stack || e.reason)));
    }
  });
  await sleep(1200);
  return dom.window;
}
const txt = (w, s) => { const e = w.document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
function setVal(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); }
async function signIn(w, name, email) {
  const f = w.document.querySelector('#si');
  if (!f) throw new Error('no sign-in form');
  f.elements.name.value = name; f.elements.email.value = email;
  f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(800);
}
const click = async (w, sel, ms) => { const e = w.document.querySelector(sel); if (!e) throw new Error('missing ' + sel); e.click(); await sleep(ms || 400); };
const go = async (w, h) => { w.location.hash = h; await sleep(500); };
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errors.push('ASSERT: ' + m); };

(async () => {
  const A = await open('A');
  ok(!!A.document.querySelector('#si'), 'sign-in screen shown');
  // owner superuser: first sign-in asks for the one-time setup code
  await signIn(A, 'Nicholas Davies', OWNER);
  ok(!A.document.querySelector('[data-setupbox]').classList.contains('hidden'), 'owner email → setup-code step shown');
  const sf = A.document.querySelector('#si');
  sf.elements.code.value = 'WRON-GCOD-E123'; sf.elements.newpw.value = 'Quarry2026x'; sf.elements.newpw2.value = 'Quarry2026x';
  sf.dispatchEvent(new A.Event('submit', { bubbles: true, cancelable: true })); await sleep(600);
  ok(!A.document.querySelector('.topbar'), 'wrong setup code rejected');
  sf.elements.code.value = lastCode(OWNER);
  sf.dispatchEvent(new A.Event('submit', { bubbles: true, cancelable: true })); await sleep(1200);
  ok(!!A.document.querySelector('.topbar'), 'shell rendered after superuser setup');
  ok(!!A.document.querySelector('.su-chip') && A.App.isSuper(), 'SUPERUSER mode active for owner');
  ok(!!A.document.querySelector('[data-nav=admin]'), 'Superuser nav visible');
  ok(/Welcome|Site Definition/.test(txt(A, '#main')), 'no-site landing shown: ' + txt(A, '.view-head h2'));
  await click(A, '[data-demo]', 1500);
  ok(txt(A, '.view-head h2') === 'Dashboard', 'dashboard after loading demo');
  ok(A.document.querySelectorAll('.kpi').length >= 6, 'KPI cards: ' + A.document.querySelectorAll('.kpi').length);
  await sleep(900);
  console.log('   KPIs:', [...A.document.querySelectorAll('.kpi')].map((k) => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  ok(/Loader 7 not yet in service/.test(txt(A, '#main')), 'inactive Loader 7 shown');
  ok(/TR End < Start/.test(txt(A, '#main')), 'flagged row listed');
  ok(A.document.querySelectorAll('.ann').length > 0, 'announcement strip shown');

  for (const h of ['#/fleet/overview', '#/fleet/log', '#/fleet/maintenance', '#/chat/general', '#/chat/announcements', '#/sites/list', '#/sites/setup']) {
    await go(A, h);
    ok(A.document.querySelector('.view') && A.document.querySelector('.view').children.length > 0, 'render ' + h + ' → ' + txt(A, '.view-head h2'));
  }
  // maintenance countdowns ticking
  await go(A, '#/fleet/maintenance');
  const cd1 = txt(A, '[data-cd]'); await sleep(2100); const cd2 = txt(A, '[data-cd]');
  ok(cd1 && cd1 !== cd2, 'countdown ticks: ' + cd1 + ' → ' + cd2);
  ok(A.document.querySelectorAll('.maint-card').length === 5, 'maintenance cards: ' + A.document.querySelectorAll('.maint-card').length);
  ok(A.document.querySelectorAll('.maint-card.overdue').length >= 1, 'overdue card present');

  // shift log entry
  await go(A, '#/fleet/log');
  const f = A.document.querySelector('.entry-form');
  const mSel = f.elements.machineId; const opt = [...mSel.options].find((o) => o.textContent === 'Loader 6');
  setVal(A, f.elements.date, A.Core.addDays(A.Core.localDate(Date.now()), 1));
  setVal(A, mSel, opt.value);
  await sleep(100);
  const pv = txt(A, '[data-preview]');
  ok(/TR start/.test(pv), 'preview shows start: ' + pv);
  const trStart = Number(pv.match(/TR start\s*([\d,\.]+)/)[1].replace(/,/g, ''));
  const rcStart = Number(pv.match(/RCC start\s*([\d,\.]+)/)[1].replace(/,/g, ''));
  setVal(A, f.elements.trEnd, String(trStart + 7.5)); setVal(A, f.elements.rccEnd, String(rcStart + 1));
  await sleep(100);
  ok(/Total hrs\s*8\.5/.test(txt(A, '[data-preview]')), 'preview total 8.5: ' + txt(A, '[data-preview]'));
  const before = A.App.S.data.entries.length;
  f.dispatchEvent(new A.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(900);
  ok(A.App.S.data.entries.length === before + 1, 'entry saved (' + before + ' → ' + A.App.S.data.entries.length + ')');

  // second user joins, chats; A sees it live
  const B = await open('B');
  await signIn(B, 'George Mensah', 'george@example.com');
  await sleep(800);
  ok(!B.App.isSuper() && !B.document.querySelector('[data-nav=admin]') && !B.document.querySelector('.su-chip'), 'regular user has no superuser UI');
  let denied = 0;
  for (const call of [() => B.API.post('sites', { name: 'Rogue' }), () => B.API.del('sites/' + A.App.S.siteId), () => B.API.post('sites/' + A.App.S.siteId + '/machines', { name: 'X' }),
    () => B.API.put('sites/' + A.App.S.siteId, { shiftHours: 99 }), () => B.API.get('admin/users'), () => B.API.put('admin/settings', { allowUserSiteCreate: true }),
    () => B.API.del('entries/' + A.App.S.data.entries[0].id), () => B.API.post('admin/superusers', { email: 'george@example.com' })]) {
    try { await call(); } catch (e) { if (e.status === 403) denied++; }
  }
  ok(denied === 8, 'regular user blocked from 8 critical actions (' + denied + '/8)');
  const mId = A.App.S.data.machines[0].id;
  let stOk = false; try { await B.API.put('machines/' + mId, { status: 'Standby' }); stOk = true; } catch (e) { /* */ }
  ok(stOk, 'regular user can still change machine status');
  await go(A, '#/chat/general');
  const siteId = A.App.S.siteId;
  await B.App.switchSite(siteId); await sleep(600);
  await go(B, '#/chat/general');
  const ta = B.document.querySelector('[data-compose] textarea');
  ta.value = 'Hi @Nicholas Davies, Loader 9 hose replaced.';
  B.document.querySelector('[data-compose]').dispatchEvent(new B.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1500);
  ok(/Loader 9 hose replaced/.test(txt(A, '[data-msgs]')), 'A received B\'s chat message live (SSE)');
  ok(A.App.S.notifs.some((n) => n.type === 'mention'), 'A got @mention notification');
  ok(!!A.document.querySelector('[data-msgs] .mention'), 'mention highlighted');

  // announcement from B → A notified
  await go(B, '#/chat/announcements');
  const af = B.document.querySelector('[data-annform]');
  af.elements.title.value = 'Shift change at 18:00'; af.elements.body.value = 'Please hand over at the telehut.'; af.elements.priority.value = 'important';
  af.dispatchEvent(new B.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1500);
  ok(A.App.S.notifs.some((n) => n.type === 'announcement'), 'A got announcement notification');

  // widget
  await click(A, '[data-act=widget]', 300);
  ok(A.document.body.classList.contains('widget-open'), 'widget panel opens');
  await click(A, '#widgetPanel [data-new]', 300);
  const ov = A.document.querySelector('.overlay');
  ov.querySelector('[name=title]').value = 'Workshop links';
  ov.querySelector('[data-l=label]').value = 'Sandvik'; ov.querySelector('[data-l=url]').value = 'www.home.sandvik';
  ov.querySelector('[data-ok]').click();
  await sleep(900);
  ok(/Workshop links/.test(txt(A, '#widgetPanel')), 'widget created and shown');
  ok(A.document.querySelector('#widgetPanel .wlink') && A.document.querySelector('#widgetPanel .wlink').href === 'https://www.home.sandvik/', 'link normalised to https: ' + (A.document.querySelector('#widgetPanel .wlink') || {}).href);
  const q = A.document.querySelector('#widgetPanel [data-q]'); setVal(A, q, 'hose'); await sleep(400);
  ok(A.document.querySelectorAll('#widgetPanel .wres').length > 0, 'global search finds chat: ' + A.document.querySelectorAll('#widgetPanel .wres').length);
  // built-in app widget opens the Underground Plan Calculator
  await click(A, '#widgetPanel [data-app=upc]', 300);
  const fr = A.document.querySelector('.app-frame iframe');
  ok(fr && /apps\/underground-plan-calculator\.html$/.test(fr.getAttribute('src')), 'app widget opens calculator in-app');
  ok(/Underground Plan Calculator/.test(txt(A, '.app-bar')), 'app bar title');
  const ar = await fetch(BASE + 'apps/underground-plan-calculator.html');
  ok(ar.status === 200 && /unsafe-inline/.test(ar.headers.get('content-security-policy')), 'app page served with app CSP');
  ok((await fetch(BASE + 'vendor/pdfjs/pdf.worker.min.js')).status === 200, 'pdf.js worker served locally');
  A.document.querySelector('.app-frame [data-close]').click(); await sleep(100);
  ok(!A.document.querySelector('.app-frame'), 'app closes');
  if (!A.document.body.classList.contains('widget-open')) await click(A, '[data-act=widget]', 300);
  // bad url rejected
  let rej = false; try { await A.API.post('widgets', { title: 'x', links: [{ url: 'javascript:alert(1)' }] }); } catch (e) { rej = true; }
  ok(rej, 'javascript: link rejected');

  // complete maintenance (recurring)
  await go(A, '#/fleet/maintenance');
  const firstDone = A.document.querySelector('[data-done]');
  const mid = firstDone.dataset.done;
  const was = A.App.S.data.maintenance.find((m) => m.id === mid);
  const wasDue = was.dueAt, wasRead = was.dueReading;
  firstDone.click(); await sleep(300);
  A.document.querySelector('.overlay [name=notes]').value = 'Done by test';
  A.document.querySelector('.overlay [data-ok]').click();
  await sleep(1000);
  const now = A.App.S.data.maintenance.find((m) => m.id === mid);
  ok(A.App.S.data.maintLog.length === 1, 'completion logged');
  ok(now.status === 'done' || now.dueAt !== wasDue || now.dueReading !== wasRead, 'recurring schedule reset: ' + was.title);

  // create a schedule through the modal (hours-based)
  await click(A, '[data-newm]', 300);
  const mo = A.document.querySelector('.overlay');
  setVal(A, mo.querySelector('[name=machineId]'), opt.value);
  mo.querySelector('[name=title]').value = 'Brake test';
  mo.querySelector('[data-bydate]').checked = false;
  mo.querySelector('[data-byhours]').checked = true;
  setVal(A, mo.querySelector('[data-inhours]'), '100');
  mo.querySelector('[data-ok]').click(); await sleep(900);
  ok(A.App.S.data.maintenance.some((m) => m.title === 'Brake test' && m.basis === 'total' && m.dueReading > 0), 'hours-based schedule created');

  // site setup: add operator, machine
  await go(A, '#/sites/setup');
  const of = A.document.querySelector('[data-addchip=operators]'); of.elements.name.value = 'Kwame';
  of.dispatchEvent(new A.Event('submit', { bubbles: true, cancelable: true })); await sleep(700);
  ok(A.App.S.data.operators.some((o) => o.name === 'Kwame'), 'operator added');
  // new site isolates data
  const s2 = await A.API.post('sites', { name: 'Second Mine' });
  await A.App.switchSite(s2.id); await sleep(500);
  await go(A, '#/dashboard');
  ok(A.App.S.data.entries.length === 0 && A.App.S.data.machines.length === 0, 'second site is a separate environment');
  ok(/No machines yet/.test(txt(A, '#main')), 'empty dashboard for new site');
  // owner promotes George → George is signed out, sets password with his code, gets superuser mode
  await go(A, '#/admin/users'); await sleep(500);
  ok(/george@example.com/.test(txt(A, '#main')), 'admin users list shows George');
  const add = A.document.querySelector('[data-add]'); add.elements.email.value = 'george@example.com';
  add.dispatchEvent(new A.Event('submit', { bubbles: true, cancelable: true })); await sleep(900);
  ok(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(txt(A, '.code-big') || ''), 'setup code shown to the owner');
  const gcode = txt(A, '.code-big');
  A.document.querySelector('.overlay [data-x]').click();
  await sleep(1200);
  ok(!!B.document.querySelector('#si'), 'promoted user was signed out');
  await signIn(B, 'George Mensah', 'george@example.com');
  const bf = B.document.querySelector('#si');
  bf.elements.code.value = gcode; bf.elements.newpw.value = 'Hauler2026y'; bf.elements.newpw2.value = 'Hauler2026y';
  bf.dispatchEvent(new B.Event('submit', { bubbles: true, cancelable: true })); await sleep(1200);
  ok(B.App.isSuper(), 'George is now a superuser');
  // settings
  await go(A, '#/admin/settings'); await sleep(500);
  ok(A.document.querySelectorAll('.toggle-row').length === 5, 'settings page shows 5 options');
  await go(A, '#/admin/audit'); await sleep(500);
  ok(/Added superuser/.test(txt(A, '#main')) && /Superuser password set/.test(txt(A, '#main')), 'audit log records superuser changes');
  await go(A, '#/admin/storage'); await sleep(500);
  ok(/Data source/.test(txt(A, '#main')), 'storage page renders: ' + (txt(A, '.kpi .v') || ''));
  console.log('\nERRORS (' + errors.length + '):\n' + errors.join('\n'));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e, '\n', errors.join('\n')); process.exit(2); });
