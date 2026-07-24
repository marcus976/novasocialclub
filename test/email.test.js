const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const email = require('../server/email');

test('sendEmail records success in email_log and calls sender', async () => {
  const db = await freshDb();
  const calls = [];
  email.__setSender(async (msg) => { calls.push(msg); return { id: 'fake-id' }; });
  const res = await email.sendEmail(db, { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', type: 'test' });
  expect(res.ok).toBe(true);
  expect(calls.length).toBe(1);
  const { rows } = await db.query("SELECT * FROM email_log WHERE to_email='a@b.com'");
  expect(rows[0].status).toBe('sent');
  await db.close();
});

test('sendEmail records failure when sender throws', async () => {
  const db = await freshDb();
  email.__setSender(async () => { throw new Error('boom'); });
  const res = await email.sendEmail(db, { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', type: 'test' });
  expect(res.ok).toBe(false);
  const { rows } = await db.query("SELECT * FROM email_log WHERE to_email='a@b.com'");
  expect(rows[0].status).toBe('failed');
  await db.close();
});
