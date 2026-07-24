'use strict';

async function record(db, { to, subject, type, memberId = null, status, error = null }) {
  const { rows } = await db.query(
    'INSERT INTO email_log (to_email,subject,type,member_id,status,error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [to, subject, type, memberId, status, error]);
  return rows[0];
}

async function list(db, { limit = 50 } = {}) { const { rows } = await db.query('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT $1', [limit]); return rows; }

module.exports = { record, list };
