/*
 * PostgreSQL persistence for Machine Hours Portal.
 * The app's existing data model is stored as one JSONB document so the current
 * Core API and authentication flows remain unchanged.
 */
'use strict';

const { Pool } = require('pg');

/*
 * TLS setting for the connection:
 *  - DATABASE_SSL=true|false always wins.
 *  - sslmode=disable in the URL turns TLS off.
 *  - Render's Internal Database URL uses a private host without a domain
 *    (e.g. dpg-xxxx-a), and localhost needs no TLS either, so no TLS for those.
 *  - Anything else (e.g. Render's External Database URL) uses TLS.
 */
function sslOption(connectionString) {
  const flag = (process.env.DATABASE_SSL || '').toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return { rejectUnauthorized: false };
  let host = '';
  try {
    const u = new URL(connectionString);
    if ((u.searchParams.get('sslmode') || '').toLowerCase() === 'disable') return false;
    host = u.hostname;
  } catch (e) { /* unparsable URL: let pg handle it, default to TLS */ }
  if (host && (!host.includes('.') || host === '127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

class PostgresStore {
  constructor(options) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      ssl: sslOption(options.connectionString),
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    this.log = console;
    this.timer = null;
    this.chain = Promise.resolve();
    this.status = { connected: false, lastSave: null, lastError: null };
    this.pool.on('error', (err) => {
      this.status.connected = false;
      this.status.lastError = err.message;
      this.log.error('[PostgreSQL] pool error:', err.message);
    });
  }

  async start(localData) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS machine_hours_portal_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    let result = await this.pool.query(
      'SELECT data FROM machine_hours_portal_state WHERE id = 1'
    );
    if (!result.rows.length) {
      await this.pool.query(
        'INSERT INTO machine_hours_portal_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
        [JSON.stringify(localData)]
      );
      result = await this.pool.query(
        'SELECT data FROM machine_hours_portal_state WHERE id = 1'
      );
    }
    this.status.connected = true;
    this.status.lastError = null;
    return result.rows.length ? result.rows[0].data : null;
  }

  schedule(data) {
    clearTimeout(this.timer);
    // Capture a snapshot so later mutations cannot alter an in-flight save.
    const snapshot = JSON.stringify(data);
    this.timer = setTimeout(() => { this.writeSnapshot(snapshot); }, 300);
  }

  writeSnapshot(snapshot) {
    this.chain = this.chain.catch(() => {}).then(() => this.pool.query(
      'INSERT INTO machine_hours_portal_state (id, data, updated_at) VALUES (1, $1::jsonb, NOW()) ' +
      'ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
      [snapshot]
    )).then(() => {
      this.status.connected = true;
      this.status.lastSave = new Date().toISOString();
      this.status.lastError = null;
    }).catch((err) => {
      this.status.connected = false;
      this.status.lastError = err.message;
      this.log.error('[PostgreSQL] save failed:', err.message);
    });
    return this.chain;
  }

  async flush(data) {
    clearTimeout(this.timer);
    return this.writeSnapshot(JSON.stringify(data));
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresStore, sslOption };
