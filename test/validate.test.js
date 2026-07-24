const { test, expect } = require('bun:test');
const v = require('../server/validate');

test('isEmail', () => {
  expect(v.isEmail('a@b.com')).toBe(true);
  expect(v.isEmail('nope')).toBe(false);
});

test('validateApplication rejects missing required fields', () => {
  const r = v.validateApplication({ first_name: '', last_name: 'X', email: 'bad' });
  expect(r.ok).toBe(false);
  expect(r.errors.length).toBeGreaterThan(0);
});

test('validateApplication returns sanitized value with db columns', () => {
  const r = v.validateApplication({
    fname: 'Ada', lname: 'Lovelace', email: ' ada@x.com ',
    phone: '555', company: 'NOVA', profession: 'Founder',
    linkedin: 'in/ada', area: 'Reston', why: 'Community',
    website: '',
  });
  expect(r.ok).toBe(true);
  expect(r.value.first_name).toBe('Ada');
  expect(r.value.email).toBe('ada@x.com');
});

test('honeypot filled => rejected as spam', () => {
  const r = v.validateApplication({ fname: 'A', lname: 'B', email: 'a@b.com', website: 'http://spam' });
  expect(r.ok).toBe(false);
  expect(r.spam).toBe(true);
});
