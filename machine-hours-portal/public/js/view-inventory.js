/* Inventory: items with location and quantity; pick (take out), receive (put in) and stock counts, with a full movement log. */
(function () {
  'use strict';
  const { icon, esc, $, $$, toast, modal, num1, dt, confirmBox } = UI;
  const Views = (window.Views = window.Views || {});

  const fmtQ = (q) => (q == null ? '–' : Number.isInteger(q) ? String(q) : num1(q));
  const low = (it) => it.minQty != null && (it.quantity || 0) <= it.minQty;
  const KIND = { pick: 'Picked', receive: 'Received', count: 'Stock count' };
  const filter = { q: '', location: '', lowOnly: false };
  const moveFilter = { item: '', kind: '', from: null, to: null };

  function head(sub) {
    return '<div class="view-head"><div><h2>Inventory</h2><div class="sub">' + esc(App.site.name) + ' · items, store locations and quantities — pick to take out, receive to put in</div></div>' +
      '<div class="head-actions"><div class="subtabs">' + [['items', 'Items'], ['moves', 'Movements']].map(([k, l]) =>
        '<button data-sub="' + k + '" class="' + (sub === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div></div>';
  }

  /* ---------------------------------------------------------- items */
  function renderItems(wrap) {
    const S = App.S, items = S.data.inventory || [];
    const locations = Array.from(new Set(items.map((i) => i.location).filter(Boolean))).sort();
    const nLow = items.filter(low).length;
    wrap.insertAdjacentHTML('beforeend',
      '<div class="grid g-kpi">' +
      '<div class="card kpi" style="--c:var(--sv-gold)"><div class="l">' + icon('box') + 'Items</div><div class="v">' + items.length + '</div></div>' +
      '<div class="card kpi" style="--c:var(--info)"><div class="l">Locations</div><div class="v">' + locations.length + '</div></div>' +
      '<div class="card kpi ' + (nLow ? 'warn' : '') + '" style="--c:var(--warn)"><div class="l">' + icon('alert') + 'Low stock</div><div class="v">' + nLow + '</div><div class="s">at or below minimum</div></div>' +
      '<div class="card kpi" style="--c:var(--ok)"><div class="l">Picks (7 days)</div><div class="v">' + (S.data.invLog || []).filter((l) => l.kind === 'pick' && l.at > Date.now() - 7 * Core.DAY).length + '</div></div>' +
      '</div>' +
      '<div class="card mt"><div class="card-h"><h3>' + icon('box') + 'Items</h3><div class="row"><button class="btn sm" data-csv>' + icon('download') + ' CSV</button>' +
      '<button class="btn sm primary" data-perm="invEdit" data-additem>' + icon('plus') + ' Add item</button></div></div>' +
      '<div class="filters" style="margin-bottom:12px">' +
      '<label class="field" style="flex:1;min-width:200px"><span>Search</span><input class="inp" data-f="q" placeholder="Item, part no., location…" value="' + esc(filter.q) + '"></label>' +
      '<label class="field"><span>Location</span><select class="inp" data-f="location"><option value="">All</option>' + locations.map((l) => '<option ' + (l === filter.location ? 'selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>' +
      '<label class="check" style="min-height:42px"><input type="checkbox" data-f="lowOnly" ' + (filter.lowOnly ? 'checked' : '') + '> Low stock only</label></div>' +
      '<div data-table></div></div>');
    let shown = [];
    const draw = () => {
      const q = filter.q.toLowerCase();
      shown = items.filter((i) => (!filter.location || i.location === filter.location) && (!filter.lowOnly || low(i)) &&
        (!q || [i.name, i.partNo, i.location, i.notes].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => (low(b) - low(a)) || a.name.localeCompare(b.name));
      $('[data-table]', wrap).innerHTML = !items.length
        ? '<div class="empty">' + icon('box') + '<div>No items yet. Add your spare parts, consumables and tools with their store location and quantity.</div></div>'
        : !shown.length ? '<div class="empty">' + icon('search') + '<div>No items match.</div></div>'
        : '<div class="hint" style="margin-bottom:6px">' + shown.length + ' items</div><div class="tbl-wrap" style="max-height:65vh"><table class="tbl inv-tbl"><thead><tr><th>Item</th><th>Part no.</th><th>Location</th><th class="n">Quantity</th><th class="n">Min</th><th></th></tr></thead><tbody>' +
          shown.map((i) => '<tr class="' + (low(i) ? 'low' : '') + '"><td class="strong wrap">' + esc(i.name) + (i.notes ? '<div class="faint" style="font-size:11.5px;font-weight:400">' + esc(i.notes) + '</div>' : '') + '</td>' +
            '<td>' + esc(i.partNo || '–') + '</td><td>' + esc(i.location || '–') + '</td>' +
            '<td class="n strong">' + fmtQ(i.quantity) + (i.unit ? ' <span class="faint">' + esc(i.unit) + '</span>' : '') + (low(i) ? ' <span class="pill soon">low</span>' : '') + '</td>' +
            '<td class="n muted">' + fmtQ(i.minQty) + '</td>' +
            '<td class="acts"><button class="btn sm primary" data-pick="' + i.id + '" ' + ((i.quantity || 0) > 0 ? '' : 'disabled') + '>Pick</button>' +
            '<button class="btn sm" data-perm="invEdit" data-receive="' + i.id + '">' + icon('plus') + ' Receive</button>' +
            '<button class="btn icon sm ghost" data-hist="' + i.id + '" title="History">' + icon('clock') + '</button>' +
            '<button class="btn icon sm ghost" data-perm="invEdit" data-edit="' + i.id + '" title="Edit">' + icon('pencil') + '</button>' +
            '<button class="btn icon sm ghost" data-perm="super" data-del="' + i.id + '" title="Delete">' + icon('trash') + '</button></td></tr>').join('') +
          '</tbody></table></div>';
      App.applyPerms($('[data-table]', wrap));
    };
    draw();
    wrap.addEventListener('input', UI.debounce((e) => { if (e.target.dataset.f === 'q') { filter.q = e.target.value; draw(); } }, 200));
    wrap.addEventListener('change', (e) => {
      const f = e.target.dataset.f; if (!f || f === 'q') return;
      filter[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; draw();
    });
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const it = (id) => S.data.inventory.find((x) => x.id === id);
      if ('additem' in b.dataset) itemModal();
      if (b.dataset.edit) itemModal(it(b.dataset.edit));
      if (b.dataset.pick) moveModal(it(b.dataset.pick), 'pick');
      if (b.dataset.receive) moveModal(it(b.dataset.receive), 'receive');
      if (b.dataset.hist) historyModal(it(b.dataset.hist));
      if (b.dataset.del) {
        const i = it(b.dataset.del);
        if (i && await confirmBox('Delete ' + i.name + (i.location ? ' at ' + i.location : '') + ' from the inventory? Its movement history is kept.', { danger: true, okText: 'Delete' })) {
          try { await API.del('inventory/' + i.id); toast('Item deleted'); } catch (er) { toast(er.message, 'err'); }
        }
      }
      if ('csv' in b.dataset) {
        const rows = [['Item', 'Part no.', 'Location', 'Quantity', 'Unit', 'Min quantity', 'Low stock', 'Notes']];
        shown.forEach((i) => rows.push([i.name, i.partNo, i.location, i.quantity, i.unit, i.minQty, low(i) ? 'yes' : '', i.notes]));
        UI.downloadCSV('inventory_' + App.site.name.replace(/[^\w-]+/g, '_') + '.csv', rows);
      }
    });
  }

  function itemModal(item) {
    const i = item || {};
    const S = App.S;
    const locations = Array.from(new Set((S.data.inventory || []).map((x) => x.location).filter(Boolean))).sort();
    modal({
      title: item ? 'Edit ' + i.name : 'Add inventory item', okText: item ? 'Save' : 'Add item',
      body: '<div class="form-grid two">' +
        '<label class="field full"><span>Item name *</span><input class="inp" name="name" required value="' + esc(i.name || '') + '" placeholder="e.g. Bucket teeth (LH517)"></label>' +
        '<label class="field"><span>Part no.</span><input class="inp" name="partNo" value="' + esc(i.partNo || '') + '"></label>' +
        '<label class="field"><span>Location</span><input class="inp" name="location" list="inv-locs" value="' + esc(i.location || '') + '" placeholder="e.g. Workshop store A3"><datalist id="inv-locs">' + locations.map((l) => '<option value="' + esc(l) + '">').join('') + '</datalist></label>' +
        (item ? '' : '<label class="field"><span>Quantity in stock</span><input class="inp" type="number" min="0" step="any" name="quantity" value="0"></label>') +
        '<label class="field"><span>Unit</span><input class="inp" name="unit" value="' + esc(i.unit || '') + '" placeholder="pcs, m, L…"></label>' +
        '<label class="field"><span>Minimum quantity</span><input class="inp" type="number" min="0" step="any" name="minQty" value="' + (i.minQty != null ? i.minQty : '') + '" placeholder="warn at or below"></label>' +
        '<label class="field full"><span>Notes</span><textarea class="inp" name="notes" rows="2">' + esc(i.notes || '') + '</textarea></label></div>' +
        (item ? '<p class="hint">Quantity changes only through Pick, Receive or a stock count, so every change is in the history. Current: <b>' + fmtQ(i.quantity) + ' ' + esc(i.unit || '') + '</b>. ' +
          '<a href="#" data-count>Correct the quantity after a stock count</a></p>' : ''),
      onMount: (ov, close) => {
        const c = $('[data-count]', ov);
        if (c) c.addEventListener('click', (e) => { e.preventDefault(); close(); moveModal(item, 'count'); });
      },
      onOk: async (ov) => {
        const f = UI.formData($('.modal-b', ov));
        if (!f.name || !f.name.trim()) throw new Error('Item name is required');
        if (item) await API.put('inventory/' + item.id, { name: f.name, partNo: f.partNo, location: f.location, unit: f.unit, minQty: f.minQty, notes: f.notes });
        else await API.post('sites/' + S.siteId + '/inventory', f);
        toast(item ? 'Item saved' : f.name + ' added');
      }
    });
  }

  /** pick = take out (anyone), receive = put in, count = set the counted quantity */
  function moveModal(item, kind) {
    if (!item) return;
    const S = App.S;
    const u = item.unit ? ' ' + esc(item.unit) : '';
    const title = { pick: 'Pick ', receive: 'Receive ', count: 'Stock count: ' }[kind] + item.name;
    modal({
      title, okText: { pick: 'Pick', receive: 'Receive', count: 'Save count' }[kind],
      body: '<p style="margin-top:0"><b>' + esc(item.name) + '</b>' + (item.location ? ' · ' + esc(item.location) : '') + ' · in stock: <b data-instock>' + fmtQ(item.quantity) + u + '</b></p>' +
        '<div class="form-grid two">' +
        '<label class="field"><span>' + (kind === 'count' ? 'Counted quantity' : 'Quantity') + u + '</span><input class="inp" type="number" name="qty" min="0" step="any" ' + (kind === 'pick' ? 'max="' + (item.quantity || 0) + '"' : '') + ' value="' + (kind === 'count' ? fmtQ(item.quantity || 0) : 1) + '"></label>' +
        (kind === 'pick' ? '<label class="field"><span>For machine (optional)</span><select class="inp" name="machineId"><option value="">—</option>' + S.data.machines.map((m) => '<option value="' + m.id + '">' + esc(m.name) + '</option>').join('') + '</select></label>' : '<div></div>') +
        '<label class="field full"><span>Note (optional)</span><input class="inp" name="note" placeholder="' + (kind === 'pick' ? 'e.g. work order 4471' : kind === 'receive' ? 'e.g. delivery note no.' : 'e.g. monthly count') + '"></label></div>' +
        '<div class="hint" data-after></div>',
      onMount: (ov) => {
        const inp = $('[name=qty]', ov), after = $('[data-after]', ov);
        const upd = () => {
          const q = Number(inp.value), cur = item.quantity || 0;
          const res = kind === 'pick' ? cur - q : kind === 'receive' ? cur + q : q;
          after.innerHTML = isFinite(q) && inp.value !== '' ? 'After this: <b>' + fmtQ(Math.round(res * 100) / 100) + u + '</b>' + (kind === 'pick' && q > cur ? ' <span class="check-bad">— only ' + fmtQ(cur) + ' in stock</span>' : '') : '';
        };
        inp.addEventListener('input', upd); upd(); inp.select();
      },
      onOk: async (ov) => {
        const f = UI.formData($('.modal-b', ov));
        if (f.qty == null || !(f.qty >= 0)) throw new Error('Enter a quantity');
        if (kind === 'pick' && f.qty > (item.quantity || 0)) throw new Error('Only ' + fmtQ(item.quantity) + (item.unit ? ' ' + item.unit : '') + ' in stock');
        const r = await API.post('inventory/' + item.id + '/move', { id: Core.uid('il_'), kind, qty: f.qty, note: f.note, machineId: f.machineId || null, clientAt: Date.now() });
        const left = r && r.item ? r.item.quantity : null;
        toast((kind === 'pick' ? 'Picked ' + fmtQ(f.qty) : kind === 'receive' ? 'Received ' + fmtQ(f.qty) : 'Count saved') + (item.unit ? ' ' + item.unit : '') + ' · ' + item.name + (left != null ? ' — ' + fmtQ(left) + ' left' : ''));
      }
    });
  }

  function moveRows(list, withItem) {
    if (!list.length) return '<div class="empty">' + icon('clock') + '<div>No movements.</div></div>';
    return '<div class="tbl-wrap" style="max-height:60vh"><table class="tbl"><thead><tr><th>When</th>' + (withItem ? '<th>Item</th><th>Location</th>' : '') + '<th>Movement</th><th class="n">Change</th><th class="n">After</th><th>For machine</th><th>By</th><th>Note</th></tr></thead><tbody>' +
      list.map((l) => '<tr><td>' + esc(dt(l.at)) + '</td>' + (withItem ? '<td class="strong">' + esc(l.itemName) + '</td><td>' + esc(l.location || '–') + '</td>' : '') +
        '<td><span class="pill ' + (l.kind === 'pick' ? 'soon' : l.kind === 'receive' ? 'ok' : '') + '">' + KIND[l.kind] + '</span></td>' +
        '<td class="n strong">' + (l.change > 0 ? '+' : '') + fmtQ(l.change) + '</td><td class="n">' + fmtQ(l.qtyAfter) + '</td>' +
        '<td>' + (l.machineId ? esc(App.machineName(l.machineId)) : '') + '</td><td>' + esc(l.by || '') + '</td><td class="wrap">' + esc(l.note || '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function historyModal(item) {
    if (!item) return;
    const list = (App.S.data.invLog || []).filter((l) => l.itemId === item.id).sort((a, b) => b.at - a.at).slice(0, 200);
    modal({ title: item.name + ' — history', wide: true, footer: '<button class="btn" data-x>Close</button>', body: moveRows(list, false) });
  }

  /* ---------------------------------------------------------- movements */
  function renderMoves(wrap) {
    const S = App.S, today = Core.localDate(Date.now());
    moveFilter.from = moveFilter.from || Core.addDays(today, -29); moveFilter.to = moveFilter.to || today;
    const items = (S.data.inventory || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    wrap.insertAdjacentHTML('beforeend',
      '<div class="card"><div class="card-h"><h3>' + icon('clock') + 'Stock movements</h3><button class="btn sm" data-csv>' + icon('download') + ' CSV</button></div>' +
      '<div class="filters" style="margin-bottom:12px">' +
      '<label class="field"><span>From</span><input class="inp" type="date" data-m="from" value="' + moveFilter.from + '"></label>' +
      '<label class="field"><span>To</span><input class="inp" type="date" data-m="to" value="' + moveFilter.to + '"></label>' +
      '<label class="field"><span>Item</span><select class="inp" data-m="item"><option value="">All</option>' + items.map((i) => '<option value="' + i.id + '" ' + (i.id === moveFilter.item ? 'selected' : '') + '>' + esc(i.name + (i.location ? ' · ' + i.location : '')) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Movement</span><select class="inp" data-m="kind"><option value="">All</option>' + Object.entries(KIND).map(([k, v]) => '<option value="' + k + '" ' + (k === moveFilter.kind ? 'selected' : '') + '>' + v + '</option>').join('') + '</select></label></div>' +
      '<div data-moves></div></div>');
    let shown = [];
    const draw = () => {
      const from = new Date(moveFilter.from + 'T00:00:00').getTime(), to = new Date(moveFilter.to + 'T00:00:00').getTime() + Core.DAY;
      shown = (S.data.invLog || []).filter((l) => l.at >= from && l.at < to && (!moveFilter.item || l.itemId === moveFilter.item) && (!moveFilter.kind || l.kind === moveFilter.kind)).sort((a, b) => b.at - a.at);
      $('[data-moves]', wrap).innerHTML = '<div class="hint" style="margin-bottom:6px">' + shown.length + ' movements</div>' + moveRows(shown, true);
    };
    draw();
    wrap.addEventListener('change', (e) => { const k = e.target.dataset.m; if (!k) return; moveFilter[k] = e.target.value || (k === 'from' || k === 'to' ? moveFilter[k] : ''); draw(); });
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-csv]'); if (!b) return;
      const rows = [['When (UTC)', 'Item', 'Location', 'Movement', 'Change', 'Quantity after', 'For machine', 'By', 'Note']];
      shown.forEach((l) => rows.push([new Date(l.at).toISOString(), l.itemName, l.location, KIND[l.kind], l.change, l.qtyAfter, l.machineId ? App.machineName(l.machineId) : '', l.by, l.note]));
      UI.downloadCSV('stock-movements_' + App.site.name.replace(/[^\w-]+/g, '_') + '_' + moveFilter.from + '_' + moveFilter.to + '.csv', rows);
    });
  }

  /* ---------------------------------------------------------- view */
  let cur = 'items';
  Views.inventory = {
    render(wrap, r) {
      cur = r.sub === 'moves' ? 'moves' : 'items';
      wrap.innerHTML = head(cur);
      $$('.subtabs [data-sub]', wrap).forEach((b) => b.addEventListener('click', () => App.go('inventory', b.dataset.sub)));
      if (cur === 'items') renderItems(wrap); else renderMoves(wrap);
    },
    update(ev) {
      // only inventory changes redraw this page
      if (ev && ev.col && !['inventory', 'invLog'].includes(ev.col)) return true;
      return false;
    },
    lowCount() { return ((App.S.data && App.S.data.inventory) || []).filter(low).length; }
  };
})();
