const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');

async function boot() {
  const db = await freshDb();
  const auth = require('../server/auth');
  const admins = require('../server/repo/admins');
  await admins.upsert(db, 'admin@nova.com', await auth.hashPassword('pw12345'));
  const app = createApp({ db });
  const server = app.listen(0);
  return { db, server, base: `http://localhost:${server.address().port}` };
}

test('admin dashboard requires login', async () => {
  const { db, server, base } = await boot();
  const res = await fetch(`${base}/admin`, { redirect: 'manual' });
  expect([301, 302]).toContain(res.status);
  server.close(); await db.close();
});

test('admin can log in with correct credentials', async () => {
  const { db, server, base } = await boot();
  const page = await fetch(`${base}/admin/login`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const html = await page.text();
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email: 'admin@nova.com', password: 'pw12345', _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/admin');
  server.close(); await db.close();
});
