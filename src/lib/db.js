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

module.exports = { pool, init };
