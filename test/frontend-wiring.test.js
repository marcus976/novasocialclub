const { test, expect } = require('bun:test');
const fs = require('fs');

test('index.html has new application fields and newsletter form', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  expect(html).toContain('name="phone"');
  expect(html).toContain('name="company"');
  expect(html).toContain('name="linkedin"');
  expect(html).toContain('id="newsletter-form"');
  expect(html).toContain('name="website"'); // honeypot present
});

test('forms point at the real endpoints', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const js = fs.readFileSync('main.js', 'utf8');
  // Apply/partner endpoints are declared on the forms and read dynamically by main.js
  expect(html).toContain('data-endpoint="/api/apply"');
  expect(html).toContain('data-endpoint="/api/partner"');
  expect(js).toContain('data-endpoint');
  // Newsletter posts directly from main.js
  expect(js).toContain('/api/newsletter');
});
