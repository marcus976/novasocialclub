const { test, expect } = require('bun:test');
const { createApp } = require('../server/index.js');

test('GET / serves the static marketing site', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/`);
  const body = await res.text();
  server.close();
  expect(res.status).toBe(200);
  expect(body).toContain('NOVA');
});
