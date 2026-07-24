'use strict';

async function create(db, v) {
  const { rows } = await db.query(
    'INSERT INTO partner_inquiries (business,contact_name,email,message) VALUES ($1,$2,$3,$4) RETURNING *',
    [v.business, v.contact_name, v.email, v.message]);
  return rows[0];
}

async function list(db) { const { rows } = await db.query('SELECT * FROM partner_inquiries ORDER BY created_at DESC'); return rows; }

module.exports = { create, list };
