/*
 * SharePoint list schema for the Machine Hours Portal.
 *
 * Every list has:
 *   Title    – readable label (SharePoint's built-in column)
 *   AppId    – the app's own id (indexed)
 *   AppJson  – the full record as JSON (source of truth for fields without a column)
 * plus readable/typed columns for Excel, Power BI and direct editing.
 *
 * Column spec: [internalName, type, source, options]
 *   type    : text | note | number | boolean | dateTime
 *   source  : item field name, or function (item, ctx) => value  (computed / read-only)
 *   options : { indexed: true, edit: 'field' | (item, value) => void }
 *             `edit` = a change made directly in SharePoint is copied back into the app.
 */
'use strict';

const iso = (ms) => (ms == null || !isFinite(ms) ? null : new Date(ms).toISOString());
const fromIso = (v) => (v ? Date.parse(v) : null);
const siteName = (i, c) => c.siteName(i.siteId);
const machineName = (i, c) => c.machineName(i.machineId);

const LISTS = [
  {
    key: 'sites', name: 'Sites', desc: 'Mine sites (environments)',
    title: (i) => i.name, editTitle: 'name',
    cols: [
      ['SiteLocation', 'text', 'location', { edit: 'location' }],
      ['Country', 'text', 'country', { edit: 'country' }],
      ['SiteDescription', 'note', 'description', { edit: 'description' }],
      ['ColorTag', 'text', 'color'],
      ['ShiftList', 'text', (i) => (i.shifts || []).join(', '), { edit: (i, v) => { const s = String(v || '').split(',').map((x) => x.trim()).filter(Boolean); if (s.length) i.shifts = s; } }],
      ['MaxShiftHours', 'number', 'shiftHours', { edit: 'shiftHours' }],
      ['WarnDays', 'number', 'leadDays', { edit: 'leadDays' }],
      ['WarnHours', 'number', 'leadHours', { edit: 'leadHours' }],
      ['CoverFile', 'text', (i) => (i.coverImage ? 'MachineHoursPortal/covers/' + i.id + '.jpg' : null)],
      ['CreatedAtUtc', 'dateTime', (i) => iso(i.createdAt)]
    ]
  },
  {
    key: 'machines', name: 'Machines', desc: 'Loaders and other machines per site',
    title: (i) => i.name, editTitle: 'name',
    cols: [
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', siteName],
      ['Model', 'text', 'model', { edit: 'model' }],
      ['InService', 'boolean', (i) => i.active !== false, { edit: (i, v) => { i.active = !!v; } }],
      ['MachineStatus', 'text', 'status', { edit: 'status' }],
      ['OpeningTR', 'number', 'openingTR', { edit: 'openingTR' }],
      ['OpeningRCC', 'number', 'openingRCC', { edit: 'openingRCC' }],
      ['ItemNotes', 'note', 'notes', { edit: 'notes' }]
    ]
  },
  {
    key: 'operators', name: 'Operators', desc: 'Operator names per site',
    title: (i) => i.name, editTitle: 'name',
    cols: [['SiteId', 'text', 'siteId', { indexed: true }], ['SiteName', 'text', siteName]]
  },
  {
    key: 'telehuts', name: 'Telehuts', desc: 'Tele-remote huts per site',
    title: (i) => i.name, editTitle: 'name',
    cols: [['SiteId', 'text', 'siteId', { indexed: true }], ['SiteName', 'text', siteName]]
  },
  {
    key: 'entries', name: 'ShiftEntries', desc: 'End-of-shift TR/RCC hour-meter readings (start, hours and check are calculated by the app)',
    title: (i, c) => c.machineName(i.machineId) + ' · ' + i.date + ' · ' + i.shift,
    cols: [
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', siteName],
      ['EntryDate', 'text', 'date', { indexed: true, edit: (i, v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v || '')) i.date = v; } }],
      ['Shift', 'text', 'shift', { edit: 'shift' }],
      ['MachineId', 'text', 'machineId', { indexed: true }],
      ['MachineName', 'text', machineName],
      ['Telehut', 'text', 'telehut', { edit: 'telehut' }],
      ['Operator', 'text', 'operator', { edit: 'operator' }],
      ['TREnd', 'number', 'trEnd', { edit: 'trEnd' }],
      ['RCCEnd', 'number', 'rccEnd', { edit: 'rccEnd' }],
      ['TRStart', 'number', (i, c) => c.row(i.id, 'trStart')],
      ['TRHours', 'number', (i, c) => c.row(i.id, 'trHrs')],
      ['RCCStart', 'number', (i, c) => c.row(i.id, 'rccStart')],
      ['RCCHours', 'number', (i, c) => c.row(i.id, 'rccHrs')],
      ['TotalHours', 'number', (i, c) => c.row(i.id, 'total')],
      ['CheckResult', 'text', (i, c) => c.check(i.id)],
      ['Remarks', 'note', 'remarks', { edit: 'remarks' }],
      ['LoggedBy', 'text', 'createdByName'],
      ['LoggedAtUtc', 'dateTime', (i) => iso(i.createdAt)]
    ]
  },
  {
    key: 'maintenance', name: 'Maintenance', desc: 'Scheduled maintenance with due date and/or hour-meter limits',
    title: (i) => i.title, editTitle: 'title',
    cols: [
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', siteName],
      ['MachineId', 'text', 'machineId', { indexed: true }],
      ['MachineName', 'text', machineName],
      ['TaskCategory', 'text', 'category', { edit: 'category' }],
      ['AssignedTo', 'text', 'assignee', { edit: 'assignee' }],
      ['DueAtUtc', 'dateTime', (i) => iso(i.dueAt), { edit: (i, v) => { const t = fromIso(v); if (t == null || i.dueAt == null || Math.abs(t - i.dueAt) > 60000) i.dueAt = t; } }],
      ['MeterBasis', 'text', 'basis'],
      ['DueReading', 'number', 'dueReading', { edit: 'dueReading' }],
      ['RepeatDays', 'number', 'intervalDays', { edit: 'intervalDays' }],
      ['RepeatHours', 'number', 'intervalHours', { edit: 'intervalHours' }],
      ['WarnDays', 'number', 'leadDays'],
      ['WarnHours', 'number', 'leadHours'],
      ['TaskStatus', 'text', 'status'],
      ['CountdownStatus', 'text', (i, c) => c.maintStatus(i)],
      ['LastDoneUtc', 'dateTime', (i) => iso(i.lastDoneAt)],
      ['ItemNotes', 'note', 'notes', { edit: 'notes' }]
    ]
  },
  {
    key: 'maintLog', name: 'MaintenanceLog', desc: 'Completed maintenance history',
    title: (i) => i.title,
    cols: [
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', siteName],
      ['MaintenanceId', 'text', 'maintId'],
      ['MachineId', 'text', 'machineId', { indexed: true }],
      ['MachineName', 'text', machineName],
      ['TaskCategory', 'text', 'category'],
      ['DoneAtUtc', 'dateTime', (i) => iso(i.doneAt)],
      ['DoneBy', 'text', 'doneBy'],
      ['WasDueUtc', 'dateTime', (i) => iso(i.dueAt)],
      ['DueReading', 'number', 'dueReading'],
      ['MeterBasis', 'text', 'basis'],
      ['ReadingTR', 'number', 'readingTR'],
      ['ReadingRCC', 'number', 'readingRCC'],
      ['ItemNotes', 'note', 'notes', { edit: 'notes' }]
    ]
  },
  {
    key: 'announcements', name: 'Announcements', desc: 'Site announcements',
    title: (i) => i.title, editTitle: 'title',
    cols: [
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', siteName],
      ['AnnouncementText', 'note', 'body', { edit: 'body' }],
      ['AnnPriority', 'text', 'priority', { edit: (i, v) => { if (['info', 'important', 'critical'].includes(v)) i.priority = v; } }],
      ['Pinned', 'boolean', (i) => !!i.pinned, { edit: (i, v) => { i.pinned = !!v; } }],
      ['ExpiresUtc', 'dateTime', (i) => iso(i.expires)],
      ['PostedBy', 'text', 'userName'],
      ['PostedAtUtc', 'dateTime', (i) => iso(i.createdAt)]
    ]
  },
  {
    key: 'messages', name: 'ChatMessages', desc: 'Chat messages (#general and per machine)',
    title: (i) => (i.userName || '') + ': ' + String(i.text || '').slice(0, 120),
    cols: [
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', siteName],
      ['ChatChannel', 'text', 'channel', { indexed: true }],
      ['ChannelName', 'text', (i, c) => (i.channel === 'general' ? '#general' : '#' + c.machineName(i.channel))],
      ['MessageText', 'note', 'text'],
      ['PostedBy', 'text', 'userName'],
      ['PostedAtUtc', 'dateTime', (i) => iso(i.createdAt)]
    ]
  },
  {
    key: 'users', name: 'Users', desc: 'People who have signed in (roles are managed in the app, not here)',
    title: (i) => i.name,
    cols: [
      ['UserEmail', 'text', 'email', { indexed: true }],
      ['NotifyEmail', 'boolean', (i) => i.notifyEmail !== false],
      ['AppRole', 'text', (i, c) => (c.isSuper(i.email) ? 'Superuser' : 'User')],
      ['Disabled', 'boolean', (i) => !!i.disabled],
      ['CreatedAtUtc', 'dateTime', (i) => iso(i.createdAt)]
    ]
  },
  {
    key: 'widgets', name: 'Widgets', desc: 'Personal link widgets',
    title: (i) => i.title,
    cols: [
      ['OwnerId', 'text', 'userId', { indexed: true }],
      ['OwnerName', 'text', (i, c) => c.userName(i.userId)],
      ['Links', 'note', (i) => (i.links || []).map((l) => l.label + ' | ' + l.url).join('\n')],
      ['ColorTag', 'text', 'color'],
      ['IconName', 'text', 'icon'],
      ['SortOrder', 'number', 'order']
    ]
  },
  {
    key: 'audit', name: 'AuditLog', desc: 'Critical changes (who, what, when)',
    title: (i) => i.action,
    cols: [
      ['AtUtc', 'dateTime', (i) => iso(i.at)],
      ['UserName', 'text', 'userName'],
      ['UserEmail', 'text', 'userEmail'],
      ['SiteId', 'text', 'siteId', { indexed: true }],
      ['SiteName', 'text', 'siteName'],
      ['Details', 'note', 'details']
    ]
  }
];

/** Fields of the app record that are stored outside AppJson. */
const STRIP = { sites: ['coverImage'] };

function listName(prefix, l) { return (prefix || '') + l.name; }

/** app record -> SharePoint fields object */
function toFields(l, item, ctx) {
  const json = Object.assign({}, item);
  (STRIP[l.key] || []).forEach((k) => delete json[k]);
  const f = { Title: String(l.title(item, ctx) || '(untitled)').slice(0, 255), AppId: item.id, AppJson: JSON.stringify(json) };
  for (const [name, type, src] of l.cols) {
    let v = typeof src === 'function' ? src(item, ctx) : item[src];
    if (v === undefined || v === '') v = null;
    if (v != null) {
      if (type === 'number') v = isFinite(Number(v)) ? Number(v) : null;
      else if (type === 'boolean') v = !!v;
      else if (type === 'text') v = String(v).slice(0, 255);
      else if (type === 'note') v = String(v);
    }
    f[name] = v;
  }
  return f;
}

/** SharePoint fields -> app record (AppJson + edits made directly in SharePoint) */
function fromFields(l, f) {
  let item = {};
  try { item = f.AppJson ? JSON.parse(f.AppJson) : {}; } catch (e) { item = {}; }
  const fresh = !f.AppJson;
  if (l.editTitle && f.Title) item[l.editTitle] = f.Title;
  for (const [name, type, , opt] of l.cols) {
    // Graph leaves out empty fields, so only values that are present are copied back
    if (!opt || !opt.edit || !(name in f)) continue;
    let v = f[name];
    if (type === 'number') v = v == null || v === '' ? null : Number(v);
    if (typeof opt.edit === 'function') opt.edit(item, v);
    else item[opt.edit] = v === '' ? null : v;
  }
  if (fresh) { // row typed straight into SharePoint: fill the basics from its columns
    for (const [name, , src] of l.cols) if (typeof src === 'string' && item[src] == null && f[name] != null) item[src] = f[name];
  }
  return { item, fresh };
}

module.exports = { LISTS, STRIP, listName, toFields, fromFields, iso };
