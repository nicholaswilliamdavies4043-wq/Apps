// Minimal in-memory imitation of the Microsoft Graph endpoints the portal uses (for tests only).
//   node tests/mock-graph.js 3990   → token: http://localhost:3990/login, graph: http://localhost:3990/v1.0
'use strict';
const http = require('http');
const PORT = Number(process.argv[2]) || 3990;
const SITE_ID = 'contoso.sharepoint.com,1111,2222';
const lists = {};   // id -> { id, displayName, columns:[{name}], items: Map(id -> {id, fields}) }
const files = {};   // path -> Buffer
let nextList = 1, nextItem = 1;
const stats = { requests: 0, batch: 0 };

function handle(method, url, body) {
  stats.requests++;
  const u = new URL(url, 'http://x');
  const p = decodeURIComponent(u.pathname).replace(/^\/v1\.0/, '');
  let m;
  if (method === 'GET' && /^\/sites\/[^/]+:\//.test(p)) return [200, { id: SITE_ID }];
  if ((m = p.match(/^\/sites\/([^/]+)\/lists$/))) {
    if (method === 'GET') return [200, { value: Object.values(lists).map((l) => ({ id: l.id, displayName: l.displayName, name: l.displayName })) }];
    if (method === 'POST') {
      const id = 'L' + nextList++;
      lists[id] = { id, displayName: body.displayName, columns: [{ name: 'Title' }].concat(body.columns || []), items: new Map() };
      return [201, { id, displayName: body.displayName }];
    }
  }
  if ((m = p.match(/^\/sites\/[^/]+\/lists\/([^/]+)\/columns$/))) {
    const l = lists[m[1]]; if (!l) return [404, { error: { message: 'list' } }];
    if (method === 'GET') return [200, { value: l.columns.map((c) => ({ name: c.name })) }];
    if (method === 'POST') { l.columns.push(body); return [201, body]; }
  }
  if ((m = p.match(/^\/sites\/[^/]+\/lists\/([^/]+)\/items$/))) {
    const l = lists[m[1]]; if (!l) return [404, { error: { message: 'list' } }];
    if (method === 'GET') {
      const all = Array.from(l.items.values());
      const top = Number(u.searchParams.get('$top')) || 200, skip = Number(u.searchParams.get('skip')) || 0;
      const page = all.slice(skip, skip + Math.min(top, 50)); // small pages to exercise paging
      const out = { value: page.map((i) => ({ id: i.id, fields: Object.assign({ id: i.id }, i.fields) })) };
      if (skip + page.length < all.length) out['@odata.nextLink'] = 'http://localhost:' + PORT + '/v1.0' + u.pathname.replace(/^\/v1\.0/, '') + '?$expand=fields&$top=' + top + '&skip=' + (skip + page.length);
      return [200, out];
    }
    if (method === 'POST') {
      const id = String(nextItem++);
      const fields = {}; for (const [k, v] of Object.entries(body.fields || {})) if (v != null) fields[k] = v;
      l.items.set(id, { id, fields });
      return [201, { id, fields }];
    }
  }
  if ((m = p.match(/^\/sites\/[^/]+\/lists\/([^/]+)\/items\/([^/]+)(\/fields)?$/))) {
    const l = lists[m[1]]; const it = l && l.items.get(m[2]);
    if (!it) return [404, { error: { message: 'item not found' } }];
    if (method === 'PATCH') { for (const [k, v] of Object.entries(body)) { if (v == null) delete it.fields[k]; else it.fields[k] = v; } return [200, it.fields]; }
    if (method === 'DELETE') { l.items.delete(m[2]); return [204, null]; }
  }
  if ((m = p.match(/^\/sites\/[^/]+\/drive\/root:\/(.+?):(\/content)?$/))) {
    if (method === 'PUT') { files[m[1]] = body; return [201, { name: m[1] }]; }
    if (method === 'GET') return files[m[1]] ? [200, files[m[1]], 'bin'] : [404, { error: { message: 'no file' } }];
    if (method === 'DELETE') { delete files[m[1]]; return [204, null]; }
  }
  // test helpers
  if (p === '/_test/droplist' && method === 'POST') { // simulate an older site that does not have a list yet
    const l = Object.values(lists).find((x) => x.displayName === u.searchParams.get('list'));
    if (l) delete lists[l.id];
    return [200, { dropped: !!l }];
  }
  if (p === '/_test/state') return [200, { stats, lists: Object.values(lists).map((l) => ({ name: l.displayName, count: l.items.size, columns: l.columns.length })), files: Object.keys(files) }];
  if (p === '/_test/items' && method === 'GET') { const l = Object.values(lists).find((x) => x.displayName === u.searchParams.get('list')); return [200, l ? Array.from(l.items.values()) : []]; }
  if (p === '/_test/edit' && method === 'POST') { // simulate a person editing a SharePoint item
    const l = Object.values(lists).find((x) => x.displayName === body.list);
    const it = Array.from(l.items.values()).find((i) => i.fields.AppId === body.appId);
    Object.assign(it.fields, body.fields); return [200, it.fields];
  }
  if (p === '/_test/add' && method === 'POST') {
    const l = Object.values(lists).find((x) => x.displayName === body.list);
    const id = String(nextItem++); l.items.set(id, { id, fields: body.fields }); return [201, { id }];
  }
  return [404, { error: { message: 'mock: no route ' + method + ' ' + p } }];
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (req.url.startsWith('/login/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }));
    }
    if (req.headers.authorization !== 'Bearer mock-token') { res.writeHead(401); return res.end('{}'); }
    let body = raw;
    if ((req.headers['content-type'] || '').includes('json') && raw.length) body = JSON.parse(raw.toString());
    if (req.url.replace(/^\/v1\.0/, '') === '/$batch') {
      stats.batch++;
      const responses = body.requests.map((r) => { const [status, b] = handle(r.method, r.url, r.body); return { id: r.id, status, body: b }; });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ responses }));
    }
    const [status, b, kind] = handle(req.method, req.url, body);
    if (kind === 'bin') { res.writeHead(status, { 'Content-Type': 'image/jpeg' }); return res.end(b); }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(b == null ? '' : JSON.stringify(b));
  });
}).listen(PORT, () => console.log('mock graph on ' + PORT));
