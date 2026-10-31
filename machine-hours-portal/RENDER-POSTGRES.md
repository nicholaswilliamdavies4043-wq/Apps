# Render PostgreSQL setup

This app can use Render PostgreSQL for persistent storage. The existing data model is stored as one JSONB document in a table named `machine_hours_portal_state`, so the current API and login/security flows do not need to be rewritten.

## Configure the Render Web Service

1. Open the Render web service for this app.
2. Set **Root Directory** to `machine-hours-portal`.
3. Set **Build Command** to `npm install`.
4. Set **Start Command** to `npm start`.
5. In the service's **Environment** settings, add:
   - `DATABASE_URL` = the connection URL copied from your Render PostgreSQL database. Keep this value secret.
   - `STORAGE` = `postgres` (optional: when `DATABASE_URL` is set and `STORAGE` is not, PostgreSQL is used automatically).
6. Prefer the database's **Internal Database URL** when the web service and database are in the same Render region.
   TLS is chosen automatically: off for the Internal URL (private host such as `dpg-xxxx-a`) and for localhost,
   on for the External URL. Override with `DATABASE_SSL=true` or `DATABASE_SSL=false` if needed.
7. Save changes and redeploy.

The app creates its table automatically. On first startup, if the table has no row, it seeds PostgreSQL from the current local `data/db.json` file (if present). On later startups, PostgreSQL is the source of truth and its saved data is loaded into the local cache.

## Verify

Open `https://YOUR-SERVICE.onrender.com/api/health`. The JSON response should report `"storage":"postgres"` and `"databaseConnected":true`.

You can also check the Render service logs for a message confirming PostgreSQL connected. Test by adding a harmless record, waiting for it to save, then restarting/redeploying the service and confirming the record remains.

## Important notes

- Creating a Render PostgreSQL database does not connect it automatically; both environment variables above are required.
- Do not commit `DATABASE_URL` or paste it into public issues/chats.
- If the records disappeared before PostgreSQL was configured and no backup exists, PostgreSQL cannot recreate them. This change protects future data.
- The table stores the app's complete data model in one JSONB row. For a single small app this is straightforward; if concurrent multi-instance writes are added later, use transactional revision/locking or normalized tables.
- The app keeps the local JSON file as a cache/initial migration source, but Render's free web-service filesystem is not the durable store.

## Staying awake and signed in (free plan)

- **Keep-alive.** Render's free web services sleep after 15 minutes without incoming traffic, and the first visit after that takes about a minute. On Render the server calls its own public address (`RENDER_EXTERNAL_URL`, which Render sets automatically) every 10 minutes, so it stays awake. Nothing needs to be set up. To see it working, open `/api/health` and look for `"keepAlive":{"everyMinutes":10,...,"ok":true}`.
  - `KEEP_ALIVE_MINUTES`: how often it pings (default 10; keep it under 15).
  - `KEEP_ALIVE_URL`: the address to ping, if it isn't on Render.
  - `KEEP_ALIVE=off`: turns it off.
  - **Free hours:** a free workspace gets 750 instance hours a month. One service kept awake all month uses about 720–744 of them, so it fits, but other free services in the same workspace share those hours. If they run out, Render suspends all free services until the next month.
  - **When it stops:** the keep-alive runs inside the server, so it can't wake a server that is already asleep, for example after Render restarts it. The next visit wakes it and the pings start again. For extra safety, add an external monitor that opens `/api/health` every 10 minutes (for example UptimeRobot or cron-job.org).
- **Remember me.** The sign-in box has **Remember me for 30 days**, ticked by default.
  - **Ticked:** the user stays signed in on that device for 30 days.
  - **Unticked:** the sign-in lasts until the browser or app is closed, and at most 12 hours. Use this on shared telehut computers.
  - **Restarts:** sessions are stored in PostgreSQL, so restarts, redeploys and sleeping don't sign anyone out. With file storage on Render, everyone is signed out whenever the disk is wiped.

## ⚠ Free Render PostgreSQL expires

Render's free PostgreSQL databases **expire 30 days after they are created**. After that, the database is unavailable. If it isn't upgraded to a paid plan within a 14-day grace period, **Render deletes it with all data**. Before the 30 days are up, either upgrade the database to a paid instance type, or move the data to another PostgreSQL database and change `DATABASE_URL`. Check the expiry date on the database's page in the Render dashboard.
