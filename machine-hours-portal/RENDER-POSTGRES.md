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
