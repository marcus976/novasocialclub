const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const email = require('../server/email');

async function boot() {
  const db = await freshDb();
  email.__setSender(async () => ({ id: 'x' }));
  const app = createApp({ db });
  const server = app.listen(0);
  return { db, server, base: `http://localhost:${server.address().port}` };
}

test('POST /api/apply stores a pending application', async () => {
  const { db, server, base } = await boot();
  const res = await fetch(`${base}/api/apply`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fname: 'Ada', lname: 'L', email: 'ada@x.com', why: 'hi' }),
  });
  const json = await res.json();
  expect(json.ok).toBe(true);
  const { rows } = await db.query('SELECT * FROM applications');
  expect(rows.length).toBe(1);
  expect(rows[0].status).toBe('pending');
  server.close(); await db.close();
});

test('POST /api/apply rejects invalid email', async () => {
  const { db, server, base } = await boot();
  const res = await fetch(`${base}/api/apply`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fname: 'Ada', lname: 'L', email: 'bad' }),
  });
  const json = await res.json();
  expect(json.ok).toBe(false);
  server.close(); await db.close();
});

test('newsletter subscribe then unsubscribe', async () => {
  const { db, server, base } = await boot();
  await fetch(`${base}/api/newsletter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 's@b.com' }) });
  const { rows } = await db.query('SELECT * FROM newsletter_subscribers');
  expect(rows[0].status).toBe('subscribed');
  const res = await fetch(`${base}/unsubscribe?token=${rows[0].unsubscribe_token}`);
  expect(res.status).toBe(200);
  const { rows: after } = await db.query('SELECT * FROM newsletter_subscribers');
  expect(after[0].status).toBe('unsubscribed');
  server.close(); await db.close();
});
