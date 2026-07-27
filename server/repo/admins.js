'use strict';

async function getByEmail(db, email) { const { rows } = await db.query('SELECT * FROM admins WHERE email=$1', [email]); return rows[0] || null; }

async function upsert(db, email, hash) {
  const { rows } = await db.query(
    `INSERT INTO admins (email,password_hash) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET password_hash=$2 RETURNING *`, [email, hash]);
  return rows[0];
}

module.exports = { getByEmail, upsert };
