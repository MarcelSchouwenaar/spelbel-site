const { Pool } = require('pg');

const isLocal = (process.env.DATABASE_URL || '').includes('localhost');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !isLocal ? { rejectUnauthorized: false } : undefined,
});

async function init() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS locations (
            id SERIAL PRIMARY KEY,
            naam TEXT NOT NULL,
            plaats TEXT,
            lat DOUBLE PRECISION NOT NULL,
            lng DOUBLE PRECISION NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS newsletter_tokens (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            verified_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS signups (
            id SERIAL PRIMARY KEY,
            location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
            naam TEXT NOT NULL,
            email TEXT NOT NULL,
            openbaar BOOLEAN NOT NULL DEFAULT true,
            nieuwsbrief BOOLEAN NOT NULL DEFAULT true,
            verify_token TEXT UNIQUE NOT NULL,
            verified_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (location_id, email)
        );
    `);
}

/**
 * Keep data only as long as the privacy policy says. Signups via the map: at most three years
 * (earlier by hand, once a bell hangs there). Newsletter confirmation tokens: 30 days — the
 * list itself lives at Brevo, until someone unsubscribes.
 */
async function purgeOld() {
    const signups = await pool.query("DELETE FROM signups WHERE created_at < now() - interval '3 years'");
    const tokens = await pool.query("DELETE FROM newsletter_tokens WHERE created_at < now() - interval '30 days'");
    if (signups.rowCount || tokens.rowCount) {
        console.log(`[DB] Removed ${signups.rowCount} signup(s) older than 3 years, ${tokens.rowCount} newsletter token(s) older than 30 days`);
    }
}

module.exports = { pool, init, purgeOld };
