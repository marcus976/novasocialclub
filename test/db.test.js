const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');

test('migrate creates all tables and they are queryable', async () => {
  const db = await freshDb();
  for (const t of ['admins', 'applications', 'members', 'newsletter_subscribers', 'partner_inquiries', 'email_log']) {
    const res = await db.query(`SELECT count(*)::int AS n FROM ${t}`);
    expect(res.rows[0].n).toBe(0);
  }
  await db.close();
});
