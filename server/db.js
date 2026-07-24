'use strict';
const { config } = require('./config');

let _db = null;

async function _makePglite() {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(); // in-memory
  return {
    kind: 'pglite',
    async query(sql, params = []) { return pg.query(sql, params); },
    async close() { await pg.close(); },
    raw: pg,
  };
}

function _makePg() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.databaseUrl });
  return {
    kind: 'pg',
    async query(sql, params = []) { return pool.query(sql, params); },
    async close() { await pool.end(); },
    pool,
  };
}

async function getDb() {
  if (_db) return _db;
  _db = config.useMemoryDb ? await _makePglite() : _makePg();
  return _db;
}

async function query(sql, params) {
  const db = await getDb();
  return db.query(sql, params);
}

async function closeDb() {
  if (_db) { await _db.close(); _db = null; }
}

module.exports = { getDb, query, closeDb, _makePglite };
