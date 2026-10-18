/* Chat (per site: #general + one channel per machine) and Announcements. */
(function () {
  'use strict';
  const { icon, esc, $, $$, toast, avatar, tm, dLong, ago, confirmBox } = UI;
  const Views = (window.Views = window.Views || {});
  let cur = 'general';

  function channels() {
    const S = App.S;
    return [{ id: 'general', name: 'general', icon: 'hash' }]
      .concat(S.data.machines.map((m) => ({ id: m.id, name: m.name, icon: 'fleet' })));
  }
  const chanName = (id) => (id === 'general' ? '# general' : id === 'announcements' ? 'Announcements' : '# ' + App.machineName(id));

  function chanButtons(un) {
    return channels().map((c) => '<button class="chan ' + (cur === c.id ? 'on' : '') + '" data-ch="' + c.id + '">' + icon(c.icon) + '<span>' + esc(c.name) + '</span>' +
      (un[c.id] && cur !== c.id ? '<span class="unread">' + un[c.id] + '</span>' : '') + '</button>').join('');
  }

  function render(wrap, r) {
    const S = App.S;
    cur = r.sub || 'general';
    if (cur !== 'announcements' && !channels().some((c) => c.id === cur)) cur = 'general';
    const un = App.unread();
    const members = (S.data.members || []);
    wrap.innerHTML =
      '<div class="view-head"><div><h2>Chat</h2><div class="sub">' + esc(App.site.name) + ' · talk about the machines with everyone on this site</div></div></div>' +
      '<div class="chat-mobile-chans"><button class="chan ' + (cur === 'announcements' ? 'on' : '') + '" data-ch="announcements">' + icon('megaphone') + ' Announcements' + (un.announcements && cur !== 'announcements' ? '<span class="unread">' + un.announcements + '</span>' : '') + '</button>' + chanButtons(un) + '</div>' +
      '<div class="chat">' +
      '<div class="card chan-list">' +
      '<button class="chan ' + (cur === 'announcements' ? 'on' : '') + '" data-ch="announcements">' + icon('megaphone') + '<span>Announcements</span>' + (un.announcements && cur !== 'announcements' ? '<span class="unread">' + un.announcements + '</span>' : '') + '</button>' +
      '<div class="dd-head">Channels</div>' + chanButtons(un) +
      '<div class="dd-head">People at this site · ' + members.length + '</div>' +
      members.map((u) => '<div class="chan" style="cursor:default">' + avatar(u.name, 'xs') + '<span>' + esc(u.name) + (u.id === S.user.id ? ' <span class="faint">(you)</span>' : '') + '</span></div>').join('') +
      '</div>' +
      '<div class="card chat-pane" data-pane></div></div>';
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ch]');
      if (b) App.go('chat', b.dataset.ch);
    });
    if (cur === 'announcements') renderAnnouncements($('[data-pane]', wrap));
    else renderChannel($('[data-pane]', wrap));
    App.markRead(cur);
  }

  /* ---------------- messages ---------------- */
  function fmtText(t) {
    let h = esc(t);
    // highlight @mentions of known people
    App.S.users.slice().sort((a, b) => b.name.length - a.name.length).forEach((u) => {
      const n = esc('@' + u.name);
      h = h.split(n).join('<span class="mention">' + n + '</span>');
    });
    // linkify http(s) urls
    h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return h;
  }
  function msgsHtml() {
    const S = App.S;
    const list = S.data.messages.filter((m) => m.channel === cur).sort((a, b) => a.createdAt - b.createdAt);
    if (!list.length) return '<div class="empty" style="margin:auto">' + icon('chat') + '<div>No messages in ' + esc(chanName(cur)) + ' yet. Say hello!</div></div>';
    let lastDay = null, prev = null, h = '';
    for (const m of list) {
      const day = Core.localDate(m.createdAt);
      if (day !== lastDay) { h += '<div class="day-sep">' + (day === Core.localDate(Date.now()) ? 'Today' : dLong(day)) + '</div>'; lastDay = day; prev = null; }
      const cont = prev && prev.userName === m.userName && m.createdAt - prev.createdAt < 5 * 60000;
      const mine = m.userId === S.user.id;
      h += '<div class="msg ' + (cont ? 'cont ' : '') + (mine ? 'mine' : '') + '">' + avatar(m.userName, 'sm') + '<div style="min-width:0;flex:1">' +
        (cont ? '' : '<div><span class="who">' + esc(m.userName) + '</span><span class="ts">' + tm(m.createdAt) + '</span></div>') +
        '<div class="txt">' + fmtText(m.text) + '</div></div>' +
        (mine || App.isSuper() ? '<button class="btn icon sm ghost del" data-delmsg="' + m.id + '" title="Delete">' + icon('trash') + '</button>' : '') + '</div>';
      prev = m;
    }
    return h;
  }
  function renderChannel(pane) {
    const S = App.S;
    const m = cur !== 'general' ? App.machine(cur) : null;
    pane.innerHTML =
      '<div class="chat-head">' + icon(m ? 'fleet' : 'hash') + '<div><h3>' + esc(chanName(cur)) + '</h3><div class="hint">' +
      (m ? 'Everything about ' + esc(m.name) + (m.status ? ' · currently ' + esc(m.status) : '') : 'Site-wide conversation') + '</div></div></div>' +
      '<div class="msgs" data-msgs>' + msgsHtml() + '</div>' +
      '<form class="composer" data-compose><div class="mention-pop dropdown hidden" data-mpop style="position:absolute;top:auto"></div>' +
      '<textarea class="inp" name="text" rows="1" placeholder="Message ' + esc(chanName(cur)) + '  ·  @ to mention  ·  Enter to send"></textarea>' +
      '<button class="btn primary" type="submit" aria-label="Send">' + icon('send') + '</button></form>';
    const box = $('[data-msgs]', pane);
    box.scrollTop = box.scrollHeight;
    const form = $('[data-compose]', pane), ta = form.elements.text, pop = $('[data-mpop]', pane);
    const send = async () => {
      const text = ta.value.trim(); if (!text) return;
      ta.value = ''; ta.style.height = '';
      try { await API.post('sites/' + S.siteId + '/messages', { channel: cur, text }); }
      catch (e) { toast(e.message, 'err'); ta.value = text; }
      ta.focus();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    let mIdx = 0, mList = [];
    const closePop = () => { pop.classList.add('hidden'); mList = []; };
    const pick = (u) => {
      const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@([\p{L}\p{N}.\- ]{0,30})$/u, '@' + u.name + ' ');
      ta.value = before + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = before.length; closePop(); ta.focus();
    };
    ta.addEventListener('input', () => {
      ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
      const mt = ta.value.slice(0, ta.selectionStart).match(/@([\p{L}\p{N}.\-]{0,30})$/u);
      if (!mt) return closePop();
      const q = mt[1].toLowerCase();
      mList = S.users.filter((u) => u.id !== S.user.id && u.name.toLowerCase().includes(q)).slice(0, 6);
      if (!mList.length) return closePop();
      mIdx = 0;
      pop.innerHTML = mList.map((u, i) => '<button type="button" class="dd-item ' + (i === 0 ? 'on' : '') + '" data-u="' + u.id + '">' + avatar(u.name, 'xs') + esc(u.name) + '</button>').join('');
      pop.classList.remove('hidden');
    });
    pop.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-u]'); if (b) { e.preventDefault(); pick(S.users.find((u) => u.id === b.dataset.u)); } });
    ta.addEventListener('keydown', (e) => {
      if (mList.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); mIdx = (mIdx + (e.key === 'ArrowDown' ? 1 : -1) + mList.length) % mList.length;
          $$('[data-u]', pop).forEach((b, i) => b.classList.toggle('on', i === mIdx)); return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(mList[mIdx]); return; }
        if (e.key === 'Escape') { closePop(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    pane.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-delmsg]'); if (!b) return;
      if (await confirmBox('Delete this message?', { danger: true, okText: 'Delete' })) { try { await API.del('messages/' + b.dataset.delmsg); } catch (er) { toast(er.message, 'err'); } }
    });
    if (window.matchMedia('(min-width: 901px)').matches) ta.focus();
  }

  /* ---------------- announcements ---------------- */
  function annList() {
    const S = App.S, now = Date.now();
    const list = S.data.announcements.slice().sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
    if (!list.length) return '<div class="empty">' + icon('megaphone') + '<div>No announcements yet.</div></div>';
    return list.map((a) => {
      const expired = a.expires && a.expires < now;
      const mine = a.userId === S.user.id || App.isSuper();
      return '<div class="card ann ' + esc(a.priority || 'info') + '" style="' + (expired ? 'opacity:.5' : '') + '"><div class="ico">' + icon(a.pinned ? 'pin' : 'megaphone') + '</div><div style="flex:1;min-width:0">' +
        '<div class="row" style="gap:8px"><h4>' + esc(a.title) + '</h4><span class="pill ' + esc(a.priority || 'info') + '">' + esc(a.priority || 'info') + '</span>' + (a.pinned ? '<span class="pill gold">pinned</span>' : '') + (expired ? '<span class="pill">expired</span>' : '') + '</div>' +
        (a.body ? '<p>' + fmtText(a.body) + '</p>' : '') + '<div class="meta">' + esc(a.userName || '') + ' · ' + esc(ago(a.createdAt)) + (a.expires && !expired ? ' · until ' + esc(UI.dt(a.expires)) : '') + '</div></div>' +
        (mine ? '<div class="row" style="gap:4px"><button class="btn icon sm ghost" data-perm="super" data-pin="' + a.id + '" title="' + (a.pinned ? 'Unpin' : 'Pin') + '">' + icon('pin') + '</button><button class="btn icon sm ghost" data-delann="' + a.id + '" title="Delete">' + icon('trash') + '</button></div>' : '') + '</div>';
    }).join('');
  }
  function renderAnnouncements(pane) {
    const S = App.S;
    pane.innerHTML =
      '<div class="chat-head">' + icon('megaphone') + '<div><h3>Announcements</h3><div class="hint">Site-wide notices. Everyone at this site gets a notification.</div></div></div>' +
      '<div class="msgs" style="gap:12px">' +
      '<form class="card" data-annform style="background:rgba(255,255,255,.04)"><div class="form-grid">' +
      '<label class="field" style="grid-column:span 2"><span>Title</span><input class="inp" name="title" required placeholder="e.g. Loader 9 back in service"></label>' +
      '<label class="field"><span>Priority</span><select class="inp" name="priority"><option value="info">Info</option><option value="important">Important</option><option value="critical" data-perm="super">Critical (always emailed)</option></select></label>' +
      '<label class="field"><span>Show until (optional)</span><input class="inp" type="datetime-local" name="expiresLocal"></label>' +
      '<label class="field full"><span>Message</span><textarea class="inp" name="body" rows="3"></textarea></label></div>' +
      '<div class="row mt" style="justify-content:space-between"><div class="row"><label class="check" data-perm="super"><input type="checkbox" name="pinned"> Pin to dashboard</label><label class="check"><input type="checkbox" name="emailAll"> Also email everyone</label></div>' +
      '<button class="btn primary">' + icon('megaphone') + ' Post announcement</button></div></form>' +
      '<div data-annlist class="stack" style="gap:10px">' + annList() + '</div></div>';
    $('[data-annform]', pane).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = UI.formData(e.target);
      try {
        await API.post('sites/' + S.siteId + '/announcements', { title: f.title, body: f.body, priority: f.priority, pinned: f.pinned, emailAll: f.emailAll, expires: UI.fromLocalInput(f.expiresLocal) });
        e.target.reset(); toast('Announcement posted');
      } catch (er) { toast(er.message, 'err'); }
    });
    pane.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.pin) { const a = S.data.announcements.find((x) => x.id === b.dataset.pin); await API.put('announcements/' + a.id, { pinned: !a.pinned }); }
        if (b.dataset.delann && await confirmBox('Delete this announcement?', { danger: true, okText: 'Delete' })) await API.del('announcements/' + b.dataset.delann);
      } catch (er) { toast(er.message, 'err'); }
    });
  }

  Views.chat = {
    render,
    update(ev) {
      const main = $('#main');
      if (!ev || !main) return false;
      if (ev.col === 'messages') {
        const box = $('[data-msgs]', main);
        const touches = ev.item ? ev.item.channel === cur : true;
        if (box && cur !== 'announcements' && touches) {
          const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
          box.innerHTML = msgsHtml();
          if (atBottom || (ev.item && ev.item.userId === App.S.user.id)) box.scrollTop = box.scrollHeight;
          App.markRead(cur);
        }
        // refresh unread counters in channel list
        const un = App.unread();
        $$('.chan[data-ch]', main).forEach((b) => {
          const id = b.dataset.ch, n = un[id];
          let u = $('.unread', b);
          if (n && id !== cur) { if (!u) { u = document.createElement('span'); u.className = 'unread'; b.appendChild(u); } u.textContent = n; }
          else if (u) u.remove();
        });
        return true;
      }
      if (ev.col === 'announcements' && cur === 'announcements') {
        const l = $('[data-annlist]', main); if (l) l.innerHTML = annList();
        App.markRead('announcements');
        return true;
      }
      if (['entries', 'maintenance', 'maintLog'].includes(ev.col)) return true;
      return false;
    }
  };
})();
