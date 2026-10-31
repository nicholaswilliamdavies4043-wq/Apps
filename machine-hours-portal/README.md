# Machine Hours Portal (pilot v1.3.0)

Web app for logging **tele-remote (TR) and RCC hour-meter readings** each shift, with month-to-date analysis (as in the v4 mockup), maintenance countdowns, chat, announcements and personal link widgets. Everything is kept **per mine site (environment)**. Data can live in a local file or in **SharePoint Online lists**. **Superusers** control the critical settings.

## Run it

1. Install **Node.js 18 or newer** (https://nodejs.org). No other packages are needed.
2. Copy `.env.example` to `.env`. The defaults work as they are.
3. Windows: double-click `start.bat`. Other systems: `node server.js`.
4. The server window shows a **one-time setup code** for the owner superuser (`nicholas.william_davies_c@sandvik.com`). The code is also saved in `data/superuser-setup-codes.txt`.
5. Open http://localhost:3000, sign in with the owner email and enter the code. You then create your superuser password.
6. **Site Definition → Create a mine site**, or **Load sample site** to try it with demo data.

Other people on the network use `http://<this-pc-name>:3000`. Regular users sign in with name and email only.

**Demo mode:** if you open `public/index.html` directly (no server), the app runs on its own and stores data in that browser only. The owner email is a superuser there without a password, and superusers can't be managed.

## Superusers

The owner(s) are set with `SUPERUSER_EMAILS` in `.env` (default `nicholas.william_davies_c@sandvik.com`). Owners are always superusers and can't be removed or disabled from inside the app.

**Signing in.** A superuser email always needs its password. The first time, it needs a one-time setup code instead (12 characters, valid 7 days, works once). After 5 wrong attempts the account is locked for 15 minutes. Passwords must be at least 10 characters with letters and numbers, and are stored as scrypt hashes on the server only.

**Adding more superusers.** Go to **Superuser → Users & roles**, enter their email (they don't need to have signed in yet) and click **Make superuser**. You get a setup code to pass on; it's also emailed if SMTP is configured. From the same page you can remove superusers, reset their passwords (which gives a new code), disable or enable users, and sign someone out everywhere.

**Locked out?** Stop the server and run `node server.js --reset-password=nicholas.william_davies_c@sandvik.com`. A new code is printed.

**Superuser mode** shows a gold **SUPERUSER** badge in the header and a **Superuser** section in the menu:

| Page | What it is for |
|---|---|
| Users & roles | Add or remove superusers, reset passwords, disable users |
| App settings | Choose what regular users may do (below) |
| Audit log | Every critical change: who, what, when, which site (CSV export) |
| Data source | File or SharePoint status, pending changes, **Sync now**, **Check lists** |

**Always superuser-only:**

- changing site settings (name, shifts, max hours, warning windows, cover photo) and deleting sites
- adding, editing or deleting machines and their opening hour-meter readings
- editing or deleting other people's shift rows
- deleting maintenance history
- posting critical or pinned announcements
- deleting other people's announcements and chat messages
- managing users, app settings and SharePoint sync

**Adjustable in App settings** (defaults in brackets):

- regular users may create sites [off]
- regular users may edit operator and telehut lists [on]
- regular users may schedule maintenance [on]
- regular users may edit or delete maintenance schedules [off]
- hours a user may change their own shift rows [24]

Everyone can always log shift readings, change a machine's status, complete maintenance, chat and post info or important announcements.

The server checks every rule on every request, so hidden buttons are not the only protection.

**Troubleshooting: "I can't create a site"**

1. Check the server window. It must list `nicholas.william_davies_c@sandvik.com` under *Superusers (owners)*.
2. Sign out and sign in again with that email. A superuser email is always asked for its password, or for the setup code the first time; if you aren't asked, you're not on the new version. Sessions from before the upgrade are ended automatically.
3. The profile menu (your initials, top right) shows **Role: Superuser**, and the header shows the gold **SUPERUSER** badge.
4. Opening `public/index.html` directly runs **demo mode** (only that browser). There the Sandvik email is a superuser without a password. For shared use, start `node server.js` and open http://localhost:3000.

## SharePoint

With `STORAGE=sharepoint` the portal stores its data in 16 SharePoint lists on one site, through Microsoft Graph (app-only). The lists are Sites, Machines, Operators, Telehuts, ShiftEntries, Maintenance, MaintenanceLog, Announcements, ChatMessages, Users, Widgets, AuditLog, MineLevels, BucketCounts, Inventory and InventoryMovements, each with the prefix `MHP_`. The last four arrived in v1.3. A site that doesn't have them yet keeps working, and their records stay on the server until the lists exist. Create them with **Check lists** when the app has "Manage" on the site, or by running `sharepoint/create-lists.ps1` again. Cover photos go to the site's document library under `MachineHoursPortal/covers/`. Every column is described in [`sharepoint/LISTS.md`](sharepoint/LISTS.md).

**How it behaves**

- The app saves locally first, so it stays fast, and sends changes to SharePoint within a couple of seconds, 20 per `$batch` call with retries.
- If SharePoint can't be reached, the app keeps working from `data/db.json`. Pending changes are sent when the connection is back, and the Data source page shows the backlog.
- Every 5 minutes (`SP_PULL_MINUTES`), or with **Sync now**, the app reads the lists back. Edits made directly in SharePoint to the editable columns are copied into the app. This includes rows typed straight into a list, for example a new operator.
- ShiftEntries gets the calculated **TRStart, TRHours, RCCStart, RCCHours, TotalHours and CheckResult** columns, plus machine and site names. Excel, Power Query and Power BI can use it directly: open the list → **Export → Export to Excel** (a live connection), or connect from Power BI.
- **Kept on the server, not in SharePoint:** sessions, superuser passwords and roles, notifications and app settings. Anyone who can edit the lists still can't make themselves a superuser.

**Connecting it: one click in the app**

1. Go to **Superuser → Data source** and click **Copy request for IT**. Paste it into an email to IT. They create the access and send back a **Client ID** and a **Client secret**. This is the only part only IT can do; it probably goes through the Integration Assessment process.
2. In the same page, paste the **SharePoint site link** (any link inside the site works), the Client ID and the secret. The tenant is worked out from the link.
3. Click **Test connection**. You get a ✓ or ✗ for each step: Microsoft sign-in, site found, lists ready, lists readable.
4. Click **Connect**. The app does the rest:
   - backs up the current data
   - creates the 12 lists (if IT gave **Manage** on the site; with only **Write**, a site owner runs `sharepoint/create-lists.ps1`, downloadable from the same page)
   - copies all data to SharePoint
   - switches over without a restart and reloads everyone's app

**Disconnect** switches back to the server file with all current data. The connection is saved in `data/storage.json`, which includes the secret, so keep the `data` folder private. Advanced: the same settings can still be put in `.env` (`STORAGE=sharepoint`, `SP_*`), and `.env` wins.

**Good to know**

- **Back up the server's `data` folder.** It holds the passwords, sessions and offline cache. On a new server without that folder, all data comes back from SharePoint, but superusers need new setup codes.
- **Two-way edits.** Clearing a value in SharePoint isn't copied back; change it in the app instead. If the same row is edited in the app and in SharePoint within a few minutes, the app's version wins. Don't edit the `AppJson` column.
- **Large lists.** `SiteId`, `MachineId`, `EntryDate` and `AppId` are indexed, which keeps lists working past SharePoint's 5,000-item list view threshold. The app reads all items page by page.
- **Client secrets expire.** Put the renewal date in your calendar. Certificate sign-in can be added if IT prefers it.

## Offline use

Underground and in the field the connection comes and goes. The app is built for that:

- **Working without signal.** You can keep logging shift readings, chatting, completing maintenance and posting announcements. Each change is saved on the device and shows straight away. The header shows an amber **Offline · N waiting** badge; tap it to see the list.
- **When the connection is back.** Changes are sent automatically, in order (checked every 15 seconds and the moment the device reports it is online). Sending the same change twice can't create duplicates. If the server rejects one (for example, the row was deleted by someone else meanwhile), the badge turns red and lists it.
- **Opening the app with no signal.** It opens from the copy saved on the device, with the last data it saw plus your waiting changes. This needs the app to have been opened once while online, by the same signed-in user.
- **Needs a connection:** signing in, creating or changing sites, superuser pages, and seeing other people's new changes.
- **Opening on phones with no signal at all** needs the portal on **https://** (see Mobile). Over plain http:// the page must stay open; queued changes still work.

## Mobile (phones & tablets)

The app is responsive, so it works in any phone browser.

1. **Same network.** The phone must be on the same network or Wi-Fi as the server PC, or on the company VPN.
2. **Open it.** In the app, go to the profile menu (your initials) → **Use on phone or tablet**. It shows a **QR code** for each address of the server; scan it with the phone camera. The server window also prints these addresses (`phones/tablets on the same network: http://10.x.x.x:3000`).
3. **Install it like an app:**
   - iPhone/iPad: Safari → Share → **Add to Home Screen**
   - Android: Chrome → ⋮ → **Install app**
4. **If the phone can't open it,** allow the port in the Windows firewall on the server PC. Run this once, as administrator:
   ```
   netsh advfirewall firewall add rule name="Machine Hours Portal" dir=in action=allow protocol=TCP localport=3000
   ```
5. **For full offline use and a proper app install on phones,** use **https://**:
   - Best: ask IT to publish the portal behind the company's certificate (reverse proxy, IIS, or an internal web host). Set `APP_URL` to that address.
   - Or give the server a certificate the phones trust: set `TLS_CERT` and `TLS_KEY` (or `TLS_PFX` and `TLS_PASSPHRASE`) in `.env`.
   - Self-signed certificates show warnings, and phones won't allow offline opening with them.

## What's in it

| Area | What it does |
|---|---|
| **Site Definition** | Mine sites, each with its own machines (type, opening TR/RCC readings, in service or not, buckets per truck for loaders), operators, telehuts, shifts, shift length, warning windows and cover photo |
| **Dashboard** | Month selector; KPIs; daily and per-machine charts; the machine and operator tables from the mockup; shift and telehut split; flagged rows with Fix; upcoming maintenance; pinned announcements; CSV export |
| **Fleet Monitoring** | **Overview:** machine cards with live maintenance countdown, manual hours, and a **bucket counter** on loaders: pick the **mine level**, count with − / +, **Save** (shown as truck loads, shared live across devices, works offline). Counters start again at every shift change (Day 06:00–18:00, Night 18:00–06:00 GMT); an unsaved count is saved automatically to its level. **Buckets:** saved counts per level, shift and loader with totals and CSV. **Shift log:** end readings only; start fills itself in; buckets are prefilled from the counts saved that shift; **manual hrs = shift length − TR hrs − RCC hrs**; live check. **Maintenance:** by date and/or hour meter, repeating, with history |
| **Inventory** | Items with part no., store location, quantity, unit and minimum. **Pick** (anyone; optional machine and note), **Receive**, **Stock count**; picks can never take more than is in stock. Low-stock highlight and nav badge, search by item or location, per-item history, **Movements** log and CSV |
| **Chat & announcements** | `#general` plus one channel per machine, live, with @mentions and unread badges. Announcements can be info, important or critical, pinned, set to expire, and emailed |
| **WIDGET panel** | Edge tab on the right. Global search, maintenance donut, the **Underground Plan Calculator** app, and personal link widgets |
| **Notifications** | Bell icon and optional email: maintenance due soon or overdue, announcements, @mentions |

## Email

Optional. Without it, emails are written to `data/outbox.log`. To send real email, run `npm install nodemailer`, then set the `SMTP_*` settings and `APP_URL` in `.env`.

## Data & backup

| File | What it holds |
|---|---|
| `data/db.json` | All data (in SharePoint mode, the offline cache plus the server-only security data) |
| `data/backups/` | Daily copies, last 30 kept |
| `data/storage.json` | SharePoint connection saved from the app (contains the client secret — keep private) |
| `data/sharepoint-state-*.json` | Which app record maps to which SharePoint item |
| `data/superuser-setup-codes.txt` | Codes that have been issued (they only work once and expire after 7 days) |

## Security notes

- Regular users still sign in with name and email only, so run the server on the internal network. Sandvik SSO (Entra ID) is the next step; the SharePoint app registration is a good starting point for it.
- `db.json` and the SharePoint lists contain names and email addresses. Classify them under SICS (at least i2 Restricted).
- The server sends a strict Content-Security-Policy, escapes all user text, and allows only http(s) widget links.

## Project layout

```
server.js                 Node HTTP server: auth + superusers, SSE live updates, email, scheduler, storage
storage/security.js       password hashing (scrypt), setup codes, sign-in throttling
storage/sharepoint.js     SharePoint storage (Graph client, diff sync, $batch, offline queue, cover photos)
storage/sp-schema.js      list and column definitions, record <-> SharePoint field mapping
scripts/sharepoint-setup.js  --check / --create / --migrate / --ps1 / --docs
sharepoint/create-lists.ps1  PnP PowerShell script that creates all lists and columns
sharepoint/LISTS.md       column reference
public/js/core.js         shared by server and browser: data model, permissions, calculations, API router
public/js/view-admin.js   Superuser pages
public/js/...             shell, views, widgets, API client
tests/                    e2e-test.js (UI + permissions), sharepoint-test.js + mock-graph.js, buckets-test.js, levels-inventory-test.js, sharepoint-optional-test.js
```

## Tests

```
npm i --no-save jsdom@24 eventsource@2
# file storage
PORT=3998 DATA_DIR=/tmp/mhd node server.js &   then   DATA_DIR=/tmp/mhd node tests/e2e-test.js
# SharePoint storage against the mock Graph server
node tests/mock-graph.js 3990 &
PORT=3998 DATA_DIR=/tmp/mhd STORAGE=sharepoint SP_TENANT_ID=t SP_CLIENT_ID=c SP_CLIENT_SECRET=s \
  SP_SITE_URL=https://contoso.sharepoint.com/sites/X SP_GRAPH_BASE=http://localhost:3990/v1.0 \
  SP_LOGIN_BASE=http://localhost:3990/login SP_CREATE_LISTS=true node server.js &
DATA_DIR=/tmp/mhd node tests/e2e-test.js && ROOT=$PWD node tests/sharepoint-test.js
# offline queue + replay, and one-click connect (see the comments at the top of each file)
node tests/offline-test.js        node tests/connect-test.js
# bucket counter, buckets per truck and manual hours (fresh server)
DATA_DIR=/tmp/mhd node tests/buckets-test.js
# mine levels, saved bucket counts per shift, inventory (fresh server)
DATA_DIR=/tmp/mhd node tests/levels-inventory-test.js
# SharePoint site without the v1.3 lists keeps working (mock + populated lists, see the file header)
ROOT=$PWD node tests/sharepoint-optional-test.js
```
