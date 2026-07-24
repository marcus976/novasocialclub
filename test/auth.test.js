const { test, expect } = require('bun:test');
const auth = require('../server/auth');

test('hash + verify password roundtrip', async () => {
  const h = await auth.hashPassword('s3cret!');
  expect(h).not.toBe('s3cret!');
  expect(await auth.verifyPassword('s3cret!', h)).toBe(true);
  expect(await auth.verifyPassword('wrong', h)).toBe(false);
});

test('requireAdmin blocks unauthenticated', () => {
  const req = { session: {} };
  let code = 0;
  const res = { redirect: () => { code = 302; }, status: () => res, send: () => {} };
  let nexted = false;
  auth.requireAdmin(req, res, () => { nexted = true; });
  expect(nexted).toBe(false);
  expect(code).toBe(302);
});
