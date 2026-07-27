# NOVA Admin Backend & Member Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Express + Postgres backend behind the existing static NOVA site that captures membership applications and newsletter signups, and gives a single admin a server-rendered portal to review/accept applications, manage members and subscribers, create member logins, and send email via Resend.

**Architecture:** One Express server serves the existing static marketing site, the public form endpoints, and server-rendered EJS admin/member portals — no build step. Data lives in Postgres, accessed through a single thin `query()` interface so the same SQL runs against Replit Postgres (`pg`) in production and embedded PGlite in local dev/tests. Email goes through a Resend wrapper that records every send in `email_log` and is mocked in tests.

**Tech Stack:** bun (local runtime + `bun test`), Node 20 (Replit runtime), Express, EJS, `pg` (prod) / `@electric-sql/pglite` (dev+test), `express-session` + `connect-pg-simple`, `bcryptjs`, `resend`, `express-rate-limit`.

## Global Constraints

- Existing static site (`index.html`, `style.css`, `main.js`, assets) keeps its exact look and behavior — no framework migration.
- Runtime-agnostic code: no bun-only or node-only APIs in shipped server code (tests may use `bun test`). Server entry is `node server/index.js` on Replit.
- Membership levels are exactly: `founding` (Founding Member) › `member` (Member) › `associate` (Associate). Stored as those lowercase slugs.
- Application/member statuses: applications `pending|accepted|rejected`; members `active|inactive`; subscribers `subscribed|unsubscribed`.
- Secrets only via env (Replit Secrets), never committed: `DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_BASE_URL`. `.env` is gitignored.
- Passwords hashed with bcrypt; never stored/logged in plaintext. Tokens random, single-use, expiring.
- All SQL parameterized. All state-changing POSTs CSRF-protected. Public forms carry a honeypot field.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. Small frequent commits.
- Test command: `bun test <path>`. Run from repo root.

---

## File Structure

- `package.json` — deps + scripts (`start`, `migrate`, `seed-admin`, `test`).
- `.env.example` — documents required env vars.
- `.replit` — run command → `node server/index.js`, port 5000.
- `server/config.js` — reads/validates env, exports typed config object.
- `server/db.js` — chooses `pg` or PGlite; exports `query(sql, params)`, `getClient()`, `pool`/`raw` for session store, `closeDb()`.
- `server/migrate.js` — creates all tables (idempotent `CREATE TABLE IF NOT EXISTS`).
- `server/seed-admin.js` — upserts the single admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- `server/validate.js` — pure validation/sanitization helpers.
- `server/tokens.js` — random token + expiry helpers.
- `server/email.js` — Resend wrapper + `email_log` writes + EJS email templates.
- `server/auth.js` — password hashing, session config, `requireAdmin`/`requireMember` guards, CSRF helpers.
- `server/repo/*.js` — data-access per entity (`applications`, `members`, `subscribers`, `partners`, `admins`, `emailLog`).
- `server/routes/public.js` — `/api/apply`, `/api/newsletter`, `/api/partner`, `/unsubscribe`.
- `server/routes/admin.js` — `/admin/*`.
- `server/routes/member.js` — `/member/*`.
- `server/views/**` — EJS layouts + admin/member pages + email templates.
- `server/public-admin.css` — portal styles (reuses NOVA brand tokens).
- `server/index.js` — app wiring: static, sessions, routes, error handler.
- `test/**` — one test file per module.
- `test/helpers.js` — spins up a fresh in-memory PGlite DB + migrates it for each suite; builds a supertest-style app handle.

---

## Task 1: Project scaffolding — server boots and serves the static site

**Files:**
- Create: `package.json`, `.env.example`, `server/config.js`, `server/index.js`
- Modify: `.replit`, `.gitignore`
- Test: `test/server.test.js`

**Interfaces:**
- Produces: `createApp()` from `server/index.js` returning a configured Express app (no listen); `config` object from `server/config.js` with keys `port, sessionSecret, databaseUrl, resendApiKey, resendFrom, appBaseUrl, adminEmail, adminPassword, isProd, useMemoryDb`.

- [ ] **Step 1: Add dependencies and scripts to `package.json`**

```json
{
  "name": "novasocialclub",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node server/index.js",
    "migrate": "node server/migrate.js",
    "seed-admin": "node server/seed-admin.js",
    "test": "bun test"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "connect-pg-simple": "^9.0.1",
    "ejs": "^3.1.10",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "express-session": "^1.18.0",
    "pg": "^8.12.0",
    "resend": "^4.0.0"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.2.12"
  }
}
```

Run: `/Users/madig/.bun/bin/bun install`
Expected: dependencies install into `node_modules`.

- [ ] **Step 2: Write `.env.example` and update `.gitignore`**

`.env.example`:
```
PORT=5000
APP_BASE_URL=http://localhost:5000
SESSION_SECRET=change-me-to-a-long-random-string
DATABASE_URL=postgres://user:pass@host:5432/dbname
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=The NOVA Social Club <hello@thenovasocialclub.com>
ADMIN_EMAIL=admin@thenovasocialclub.com
ADMIN_PASSWORD=set-a-strong-password
```

Append to `.gitignore`:
```
# Env
.env
```

- [ ] **Step 3: Write `server/config.js`**

```js
'use strict';
require('dotenv').config?.(); // no-op if dotenv absent; Replit injects env directly
function bool(v) { return v === '1' || v === 'true'; }
const databaseUrl = process.env.DATABASE_URL || '';
const config = {
  port: Number(process.env.PORT || 5000),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5000',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret',
  databaseUrl,
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFrom: process.env.RESEND_FROM || 'The NOVA Social Club <onboarding@resend.dev>',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  isProd: process.env.NODE_ENV === 'production',
  // Use embedded PGlite when no real DATABASE_URL is present (local/test) or when forced.
  useMemoryDb: bool(process.env.USE_MEMORY_DB) || databaseUrl === '',
};
module.exports = { config };
```

Note: `dotenv` is optional; do not add it as a dependency. Replace the first line with a guarded `try { require('dotenv').config(); } catch (_) {}` so the file works whether or not dotenv exists. Rewrite Step 3's first line accordingly:
```js
try { require('dotenv').config(); } catch (_) { /* env provided by host */ }
```

- [ ] **Step 4: Write the failing test `test/server.test.js`**

```js
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/server.test.js`
Expected: FAIL — `createApp` is not exported / module not found.

- [ ] **Step 6: Write minimal `server/index.js`**

```js
'use strict';
const path = require('path');
const express = require('express');
const { config } = require('./config');

function createApp() {
  const app = express();
  const rootDir = path.join(__dirname, '..');
  // Serve the existing static marketing site from the repo root.
  app.use(express.static(rootDir, { extensions: ['html'] }));
  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`NOVA server listening on :${config.port}`);
  });
}

module.exports = { createApp };
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/server.test.js`
Expected: PASS.

- [ ] **Step 8: Update `.replit` run command**

Replace the `Start application` workflow task args from `npx --yes serve . -l 5000` to `node server/index.js`. Keep `waitForPort = 5000` and the `[[ports]]` block. Add near top: `run = "node server/index.js"`.

- [ ] **Step 9: Commit**

```bash
git add package.json .env.example .gitignore .replit server/config.js server/index.js test/server.test.js
git commit -m "feat: scaffold express server serving the static site"
```

---

## Task 2: Database layer + migrations (pg in prod, PGlite in dev/test)

**Files:**
- Create: `server/db.js`, `server/migrate.js`, `test/helpers.js`, `test/db.test.js`

**Interfaces:**
- Produces:
  - `server/db.js`: `async query(sql, params) -> { rows }`, `async closeDb()`, `getSessionStoreOptions()` (returns `{ pool }` for pg or a memory fallback flag), `async _newMemoryDb()` (test helper).
  - `server/migrate.js`: `async migrate(db)` running all `CREATE TABLE IF NOT EXISTS` statements; when run as main, migrates the default db.
  - `test/helpers.js`: `async freshDb()` returns an isolated migrated PGlite-backed db object exposing the same `query(sql, params)` signature.

- [ ] **Step 1: Write `server/db.js`**

```js
'use strict';
const { config } = require('./config');

let _db = null;

async function _makePglite() {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(); // in-memory
  return {
    kind: 'pglite',
    async query(sql, params = []) { return pg.query(sql, params); },
    async close() { await pg.close(); },
    raw: pg,
  };
}

function _makePg() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.databaseUrl });
  return {
    kind: 'pg',
    async query(sql, params = []) { return pool.query(sql, params); },
    async close() { await pool.end(); },
    pool,
  };
}

async function getDb() {
  if (_db) return _db;
  _db = config.useMemoryDb ? await _makePglite() : _makePg();
  return _db;
}

async function query(sql, params) {
  const db = await getDb();
  return db.query(sql, params);
}

async function closeDb() {
  if (_db) { await _db.close(); _db = null; }
}

module.exports = { getDb, query, closeDb, _makePglite };
```

Note: PGlite uses `$1, $2` placeholders exactly like `pg`, so all SQL is shared verbatim.

- [ ] **Step 2: Write `server/migrate.js`**

```js
'use strict';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  profession TEXT,
  linkedin TEXT,
  area TEXT,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  membership_level TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES applications(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  company TEXT,
  linkedin TEXT,
  membership_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT,
  set_password_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'subscribed',
  unsubscribe_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS partner_inquiries (
  id SERIAL PRIMARY KEY,
  business TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  type TEXT NOT NULL,
  member_id INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function migrate(db) {
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) { await db.query(stmt); }
}

module.exports = { migrate, SCHEMA };

if (require.main === module) {
  (async () => {
    const { getDb, closeDb } = require('./db');
    const db = await getDb();
    await migrate(db);
    console.log('Migration complete.');
    await closeDb();
  })();
}
```

Note: the `session` table for `connect-pg-simple` is created by that library (`createTableIfMissing: true`) in Task 8, so it is not in this schema.

- [ ] **Step 3: Write `test/helpers.js`**

```js
const { _makePglite } = require('../server/db');
const { migrate } = require('../server/migrate');

async function freshDb() {
  const db = await _makePglite();
  await migrate(db);
  return db;
}
module.exports = { freshDb };
```

- [ ] **Step 4: Write the failing test `test/db.test.js`**

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');

test('migrate creates all tables and they are queryable', async () => {
  const db = await freshDb();
  for (const t of ['admins','applications','members','newsletter_subscribers','partner_inquiries','email_log']) {
    const res = await db.query(`SELECT count(*)::int AS n FROM ${t}`);
    expect(res.rows[0].n).toBe(0);
  }
  await db.close();
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/db.test.js`
Expected: FAIL — modules/tables not defined.

- [ ] **Step 6: (implementation already written in Steps 1-2) Run to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/db.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db.js server/migrate.js test/helpers.js test/db.test.js
git commit -m "feat: add postgres/pglite db layer and migrations"
```

---

## Task 3: Validation, tokens, and repositories

**Files:**
- Create: `server/validate.js`, `server/tokens.js`, `server/repo/applications.js`, `server/repo/subscribers.js`, `server/repo/partners.js`, `server/repo/members.js`, `server/repo/admins.js`, `server/repo/emailLog.js`
- Test: `test/validate.test.js`, `test/repo.test.js`

**Interfaces:**
- Produces:
  - `validate.js`: `isEmail(s)->bool`, `cleanStr(s, max)->string` (trims, collapses, caps length), `validateApplication(body)->{ ok, errors, value }`, `validateNewsletter(body)->{ ok, errors, value }`, `validatePartner(body)->{ ok, errors, value }`. Each `value` is a sanitized object with exactly the DB column names.
  - `tokens.js`: `newToken()->string` (32-byte hex), `expiryFromNow(days)->Date`.
  - `repo/applications.js`: `create(db, v)->row`, `list(db, {status})->rows`, `getById(db, id)->row|null`, `setStatus(db, id, status, level, reviewedAt)->row`, `addNote(db, id, note)->row`.
  - `repo/members.js`: `createFromApplication(db, app, level, token, expires)->row`, `list(db, {q})->rows`, `getById(db,id)->row|null`, `getByEmail(db,email)->row|null`, `getBySetToken(db, token)->row|null`, `setPassword(db, id, hash)->row`, `setStatus(db,id,status)->row`, `setLevel(db,id,level)->row`, `setSetToken(db,id,token,expires)->row`.
  - `repo/subscribers.js`: `subscribe(db, email, token)->row` (idempotent re-subscribe), `list(db)->rows`, `getByToken(db, token)->row|null`, `unsubscribe(db, token)->row|null`, `activeEmails(db)->[email]`.
  - `repo/partners.js`: `create(db, v)->row`, `list(db)->rows`.
  - `repo/admins.js`: `getByEmail(db,email)->row|null`, `upsert(db,email,hash)->row`.
  - `repo/emailLog.js`: `record(db, {to,subject,type,memberId,status,error})->row`, `list(db,{limit})->rows`.

- [ ] **Step 1: Write `test/validate.test.js` (failing)**

```js
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
    website: '' /* honeypot */,
  });
  expect(r.ok).toBe(true);
  expect(r.value.first_name).toBe('Ada');
  expect(r.value.email).toBe('ada@x.com');
});

test('honeypot filled => rejected as spam', () => {
  const r = v.validateApplication({ fname:'A', lname:'B', email:'a@b.com', website:'http://spam' });
  expect(r.ok).toBe(false);
  expect(r.spam).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/validate.test.js`
Expected: FAIL.

- [ ] **Step 3: Write `server/validate.js`**

```js
'use strict';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isEmail(s) { return typeof s === 'string' && EMAIL_RE.test(s.trim()); }
function cleanStr(s, max = 500) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
}
function honeypotTripped(body) { return cleanStr(body.website, 200) !== ''; }

function validateApplication(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = {
    first_name: cleanStr(body.fname ?? body.first_name, 80),
    last_name: cleanStr(body.lname ?? body.last_name, 80),
    email: cleanStr(body.email, 160).toLowerCase(),
    phone: cleanStr(body.phone, 40),
    company: cleanStr(body.company, 120),
    profession: cleanStr(body.profession, 120),
    linkedin: cleanStr(body.linkedin, 200),
    area: cleanStr(body.area, 120),
    why: cleanStr(body.why, 2000),
  };
  const errors = [];
  if (!value.first_name) errors.push('First name is required.');
  if (!value.last_name) errors.push('Last name is required.');
  if (!isEmail(value.email)) errors.push('A valid email is required.');
  return { ok: errors.length === 0, spam: false, errors, value };
}

function validateNewsletter(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = { email: cleanStr(body.email, 160).toLowerCase() };
  const errors = isEmail(value.email) ? [] : ['A valid email is required.'];
  return { ok: errors.length === 0, spam: false, errors, value };
}

function validatePartner(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = {
    business: cleanStr(body.business, 160),
    contact_name: cleanStr(body.contact_name ?? body.name, 120),
    email: cleanStr(body.email, 160).toLowerCase(),
    message: cleanStr(body.message, 2000),
  };
  const errors = [];
  if (!value.business) errors.push('Business name is required.');
  if (!isEmail(value.email)) errors.push('A valid email is required.');
  return { ok: errors.length === 0, spam: false, errors, value };
}

module.exports = { isEmail, cleanStr, validateApplication, validateNewsletter, validatePartner };
```

- [ ] **Step 4: Run to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/validate.test.js`
Expected: PASS.

- [ ] **Step 5: Write `server/tokens.js`**

```js
'use strict';
const crypto = require('crypto');
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function expiryFromNow(days) { return new Date(Date.now() + days * 24 * 60 * 60 * 1000); }
module.exports = { newToken, expiryFromNow };
```

- [ ] **Step 6: Write the repositories**

`server/repo/applications.js`:
```js
'use strict';
async function create(db, v) {
  const { rows } = await db.query(
    `INSERT INTO applications
       (first_name,last_name,email,phone,company,profession,linkedin,area,why)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [v.first_name,v.last_name,v.email,v.phone,v.company,v.profession,v.linkedin,v.area,v.why]);
  return rows[0];
}
async function list(db, { status } = {}) {
  if (status) {
    const { rows } = await db.query('SELECT * FROM applications WHERE status=$1 ORDER BY created_at DESC', [status]);
    return rows;
  }
  const { rows } = await db.query('SELECT * FROM applications ORDER BY created_at DESC');
  return rows;
}
async function getById(db, id) {
  const { rows } = await db.query('SELECT * FROM applications WHERE id=$1', [id]);
  return rows[0] || null;
}
async function setStatus(db, id, status, level, reviewedAt) {
  const { rows } = await db.query(
    'UPDATE applications SET status=$2, membership_level=$3, reviewed_at=$4 WHERE id=$1 RETURNING *',
    [id, status, level, reviewedAt]);
  return rows[0];
}
async function addNote(db, id, note) {
  const { rows } = await db.query('UPDATE applications SET admin_notes=$2 WHERE id=$1 RETURNING *', [id, note]);
  return rows[0];
}
module.exports = { create, list, getById, setStatus, addNote };
```

`server/repo/members.js`:
```js
'use strict';
async function createFromApplication(db, app, level, token, expires) {
  const { rows } = await db.query(
    `INSERT INTO members
       (application_id,first_name,last_name,email,phone,company,linkedin,membership_level,set_password_token,token_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [app.id, app.first_name, app.last_name, app.email, app.phone, app.company, app.linkedin, level, token, expires]);
  return rows[0];
}
async function list(db, { q } = {}) {
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const { rows } = await db.query(
      `SELECT * FROM members
       WHERE lower(first_name) LIKE $1 OR lower(last_name) LIKE $1 OR lower(email) LIKE $1
       ORDER BY created_at DESC`, [like]);
    return rows;
  }
  const { rows } = await db.query('SELECT * FROM members ORDER BY created_at DESC');
  return rows;
}
async function getById(db, id) { const { rows } = await db.query('SELECT * FROM members WHERE id=$1', [id]); return rows[0]||null; }
async function getByEmail(db, email) { const { rows } = await db.query('SELECT * FROM members WHERE email=$1', [email]); return rows[0]||null; }
async function getBySetToken(db, token) { const { rows } = await db.query('SELECT * FROM members WHERE set_password_token=$1', [token]); return rows[0]||null; }
async function setPassword(db, id, hash) {
  const { rows } = await db.query(
    'UPDATE members SET password_hash=$2, set_password_token=NULL, token_expires_at=NULL WHERE id=$1 RETURNING *',
    [id, hash]); return rows[0];
}
async function setStatus(db, id, status) { const { rows } = await db.query('UPDATE members SET status=$2 WHERE id=$1 RETURNING *', [id, status]); return rows[0]; }
async function setLevel(db, id, level) { const { rows } = await db.query('UPDATE members SET membership_level=$2 WHERE id=$1 RETURNING *', [id, level]); return rows[0]; }
async function setSetToken(db, id, token, expires) { const { rows } = await db.query('UPDATE members SET set_password_token=$2, token_expires_at=$3 WHERE id=$1 RETURNING *', [id, token, expires]); return rows[0]; }
module.exports = { createFromApplication, list, getById, getByEmail, getBySetToken, setPassword, setStatus, setLevel, setSetToken };
```

`server/repo/subscribers.js`:
```js
'use strict';
async function subscribe(db, email, token) {
  const { rows } = await db.query(
    `INSERT INTO newsletter_subscribers (email, unsubscribe_token)
     VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET status='subscribed', unsubscribed_at=NULL
     RETURNING *`, [email, token]);
  return rows[0];
}
async function list(db) { const { rows } = await db.query('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC'); return rows; }
async function getByToken(db, token) { const { rows } = await db.query('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token=$1', [token]); return rows[0]||null; }
async function unsubscribe(db, token) {
  const { rows } = await db.query(
    `UPDATE newsletter_subscribers SET status='unsubscribed', unsubscribed_at=now()
     WHERE unsubscribe_token=$1 RETURNING *`, [token]);
  return rows[0]||null;
}
async function activeEmails(db) { const { rows } = await db.query("SELECT email FROM newsletter_subscribers WHERE status='subscribed'"); return rows.map(r=>r.email); }
module.exports = { subscribe, list, getByToken, unsubscribe, activeEmails };
```

`server/repo/partners.js`:
```js
'use strict';
async function create(db, v) {
  const { rows } = await db.query(
    'INSERT INTO partner_inquiries (business,contact_name,email,message) VALUES ($1,$2,$3,$4) RETURNING *',
    [v.business, v.contact_name, v.email, v.message]);
  return rows[0];
}
async function list(db) { const { rows } = await db.query('SELECT * FROM partner_inquiries ORDER BY created_at DESC'); return rows; }
module.exports = { create, list };
```

`server/repo/admins.js`:
```js
'use strict';
async function getByEmail(db, email) { const { rows } = await db.query('SELECT * FROM admins WHERE email=$1', [email]); return rows[0]||null; }
async function upsert(db, email, hash) {
  const { rows } = await db.query(
    `INSERT INTO admins (email,password_hash) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET password_hash=$2 RETURNING *`, [email, hash]);
  return rows[0];
}
module.exports = { getByEmail, upsert };
```

`server/repo/emailLog.js`:
```js
'use strict';
async function record(db, { to, subject, type, memberId = null, status, error = null }) {
  const { rows } = await db.query(
    'INSERT INTO email_log (to_email,subject,type,member_id,status,error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [to, subject, type, memberId, status, error]);
  return rows[0];
}
async function list(db, { limit = 50 } = {}) { const { rows } = await db.query('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT $1', [limit]); return rows; }
module.exports = { record, list };
```

- [ ] **Step 7: Write `test/repo.test.js` (failing, then pass)**

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const apps = require('../server/repo/applications');
const members = require('../server/repo/members');
const subs = require('../server/repo/subscribers');
const { newToken, expiryFromNow } = require('../server/tokens');

test('application create + accept spawns member', async () => {
  const db = await freshDb();
  const app = await apps.create(db, { first_name:'Ada', last_name:'L', email:'ada@x.com', phone:'', company:'', profession:'', linkedin:'', area:'', why:'' });
  expect(app.status).toBe('pending');
  await apps.setStatus(db, app.id, 'accepted', 'member', new Date());
  const m = await members.createFromApplication(db, app, 'member', newToken(), expiryFromNow(7));
  expect(m.membership_level).toBe('member');
  expect(m.password_hash).toBeNull();
  await db.close();
});

test('subscribe is idempotent and re-subscribe reactivates', async () => {
  const db = await freshDb();
  await subs.subscribe(db, 'x@y.com', newToken());
  const row = await subs.subscribe(db, 'x@y.com', newToken());
  expect(row.status).toBe('subscribed');
  const emails = await subs.activeEmails(db);
  expect(emails).toContain('x@y.com');
  await db.close();
});
```

Run: `/Users/madig/.bun/bin/bun test test/repo.test.js` → Expected PASS.

- [ ] **Step 8: Commit**

```bash
git add server/validate.js server/tokens.js server/repo test/validate.test.js test/repo.test.js
git commit -m "feat: add validation, tokens, and data repositories"
```

---

## Task 4: Email wrapper (Resend) with logging + templates

**Files:**
- Create: `server/email.js`, `server/views/emails/` (EJS partials)
- Test: `test/email.test.js`

**Interfaces:**
- Consumes: `repo/emailLog.record`, `config.resendApiKey/resendFrom/appBaseUrl`.
- Produces: `sendEmail(db, { to, subject, html, type, memberId }) -> { ok, id|null, logged }`; template builders `applicationReceivedEmail(app)`, `adminNotifyEmail(app)`, `welcomeSetPasswordEmail(member, url)`, `rejectionEmail(app)`, `newsletterConfirmEmail(unsubUrl)`, `broadcastEmail(subject, bodyHtml, unsubUrl)` each returning `{ subject, html }`. A module-level `__setSender(fn)` allows tests to inject a fake sender.

- [ ] **Step 1: Write `test/email.test.js` (failing)**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/email.test.js` → Expected FAIL.

- [ ] **Step 3: Write `server/email.js`**

```js
'use strict';
const { config } = require('./config');
const emailLog = require('./repo/emailLog');

let _sender = null; // lazily created real Resend sender
function __setSender(fn) { _sender = fn; }

function realSender() {
  if (!config.resendApiKey) {
    return async (msg) => { console.warn(`[email] RESEND_API_KEY missing; skipping send to ${msg.to}`); return { id: null, skipped: true }; };
  }
  const { Resend } = require('resend');
  const client = new Resend(config.resendApiKey);
  return async (msg) => {
    const { data, error } = await client.emails.send({ from: config.resendFrom, to: msg.to, subject: msg.subject, html: msg.html });
    if (error) throw new Error(error.message || 'resend error');
    return { id: data?.id || null };
  };
}

async function sendEmail(db, { to, subject, html, type, memberId = null }) {
  const sender = _sender || realSender();
  try {
    const out = await sender({ to, subject, html });
    await emailLog.record(db, { to, subject, type, memberId, status: out.skipped ? 'skipped' : 'sent' });
    return { ok: true, id: out.id, logged: true };
  } catch (err) {
    await emailLog.record(db, { to, subject, type, memberId, status: 'failed', error: String(err.message || err) });
    return { ok: false, id: null, logged: true };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const wrap = (inner) => `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#111">${inner}</div>`;

function applicationReceivedEmail(app) {
  return { subject: 'Your NOVA Social Club application', html: wrap(
    `<h2>Application received</h2><p>Hi ${esc(app.first_name)}, thanks for applying to The NOVA Social Club. Applications are reviewed on a rolling basis and we'll be in touch soon.</p>`) };
}
function adminNotifyEmail(app) {
  return { subject: `New application: ${app.first_name} ${app.last_name}`, html: wrap(
    `<h2>New application</h2><p><b>${esc(app.first_name)} ${esc(app.last_name)}</b> (${esc(app.email)})</p>
     <p>Company: ${esc(app.company)}<br>Profession: ${esc(app.profession)}<br>Area: ${esc(app.area)}<br>LinkedIn: ${esc(app.linkedin)}</p>
     <p>${esc(app.why)}</p>`) };
}
function welcomeSetPasswordEmail(member, url) {
  return { subject: 'Welcome to The NOVA Social Club — set your password', html: wrap(
    `<h2>Welcome, ${esc(member.first_name)}</h2><p>Your membership (${esc(member.membership_level)}) has been approved. Set your password to access your member page:</p>
     <p><a href="${esc(url)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px">Set your password</a></p>
     <p>This link expires in 7 days.</p>`) };
}
function rejectionEmail(app) {
  return { subject: 'An update on your NOVA Social Club application', html: wrap(
    `<h2>Thank you for applying</h2><p>Hi ${esc(app.first_name)}, thank you for your interest in The NOVA Social Club. We're unable to extend an invitation at this time, but we'd welcome a future application.</p>`) };
}
function newsletterConfirmEmail(unsubUrl) {
  return { subject: "You're subscribed to The NOVA Social Club", html: wrap(
    `<h2>You're on the list</h2><p>Thanks for subscribing to NOVA updates.</p><p style="font-size:12px;color:#666"><a href="${esc(unsubUrl)}">Unsubscribe</a></p>`) };
}
function broadcastEmail(subject, bodyHtml, unsubUrl) {
  return { subject, html: wrap(`${bodyHtml}<hr><p style="font-size:12px;color:#666"><a href="${esc(unsubUrl)}">Unsubscribe</a></p>`) };
}

module.exports = { sendEmail, __setSender, applicationReceivedEmail, adminNotifyEmail, welcomeSetPasswordEmail, rejectionEmail, newsletterConfirmEmail, broadcastEmail };
```

- [ ] **Step 4: Run to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/email.test.js` → Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add server/email.js
git commit -m "feat: add resend email wrapper with logging and templates"
```

---

## Task 5: Public endpoints — apply, newsletter, partner, unsubscribe

**Files:**
- Create: `server/routes/public.js`
- Modify: `server/index.js` (mount router, add `express.json`/`urlencoded`, view engine)
- Test: `test/public.test.js`

**Interfaces:**
- Consumes: validators, repos, email templates, `sendEmail`.
- Produces: router mounted at `/`. Endpoints: `POST /api/apply` (JSON `{ok:true}` / `{ok:false,errors}`), `POST /api/newsletter`, `POST /api/partner`, `GET /unsubscribe?token=`. `createApp()` accepts optional `{ db }` for tests; when omitted it uses the shared `getDb()`.

- [ ] **Step 1: Write `test/public.test.js` (failing)**

```js
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
  const res = await fetch(`${base}/api/apply`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ fname:'Ada', lname:'L', email:'ada@x.com', why:'hi' }) });
  const json = await res.json();
  expect(json.ok).toBe(true);
  const { rows } = await db.query('SELECT * FROM applications');
  expect(rows.length).toBe(1);
  expect(rows[0].status).toBe('pending');
  server.close(); await db.close();
});

test('POST /api/apply rejects invalid email', async () => {
  const { db, server, base } = await boot();
  const res = await fetch(`${base}/api/apply`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ fname:'Ada', lname:'L', email:'bad' }) });
  const json = await res.json();
  expect(json.ok).toBe(false);
  server.close(); await db.close();
});

test('newsletter subscribe then unsubscribe', async () => {
  const { db, server, base } = await boot();
  await fetch(`${base}/api/newsletter`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'s@b.com' }) });
  const { rows } = await db.query('SELECT * FROM newsletter_subscribers');
  expect(rows[0].status).toBe('subscribed');
  const res = await fetch(`${base}/unsubscribe?token=${rows[0].unsubscribe_token}`);
  expect(res.status).toBe(200);
  const { rows: after } = await db.query('SELECT * FROM newsletter_subscribers');
  expect(after[0].status).toBe('unsubscribed');
  server.close(); await db.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/public.test.js` → Expected FAIL.

- [ ] **Step 3: Write `server/routes/public.js`**

```js
'use strict';
const express = require('express');
const { config } = require('../config');
const V = require('../validate');
const { newToken, expiryFromNow } = require('../tokens');
const appsRepo = require('../repo/applications');
const subsRepo = require('../repo/subscribers');
const partnersRepo = require('../repo/partners');
const email = require('../email');

module.exports = function publicRoutes(getDb) {
  const router = express.Router();

  router.post('/api/apply', async (req, res) => {
    const db = await getDb();
    const { ok, errors, value } = V.validateApplication(req.body || {});
    if (!ok) return res.status(400).json({ ok: false, errors: errors });
    const app = await appsRepo.create(db, value);
    const t1 = email.applicationReceivedEmail(app);
    await email.sendEmail(db, { to: app.email, subject: t1.subject, html: t1.html, type: 'application_received' });
    if (config.adminEmail) {
      const t2 = email.adminNotifyEmail(app);
      await email.sendEmail(db, { to: config.adminEmail, subject: t2.subject, html: t2.html, type: 'admin_notify' });
    }
    return res.json({ ok: true });
  });

  router.post('/api/newsletter', async (req, res) => {
    const db = await getDb();
    const { ok, errors, value } = V.validateNewsletter(req.body || {});
    if (!ok) return res.status(400).json({ ok: false, errors });
    const sub = await subsRepo.subscribe(db, value.email, newToken());
    const unsubUrl = `${config.appBaseUrl}/unsubscribe?token=${sub.unsubscribe_token}`;
    const t = email.newsletterConfirmEmail(unsubUrl);
    await email.sendEmail(db, { to: value.email, subject: t.subject, html: t.html, type: 'newsletter_confirm' });
    return res.json({ ok: true });
  });

  router.post('/api/partner', async (req, res) => {
    const db = await getDb();
    const { ok, errors, value } = V.validatePartner(req.body || {});
    if (!ok) return res.status(400).json({ ok: false, errors });
    await partnersRepo.create(db, value);
    return res.json({ ok: true });
  });

  router.get('/unsubscribe', async (req, res) => {
    const db = await getDb();
    const token = String(req.query.token || '');
    const row = await subsRepo.unsubscribe(db, token);
    res.status(row ? 200 : 404).send(
      `<!doctype html><meta charset=utf8><title>Unsubscribe</title>
       <div style="font-family:Georgia,serif;max-width:520px;margin:80px auto;text-align:center">
       <h1>${row ? "You've been unsubscribed" : 'Link not found'}</h1>
       <p>${row ? "You won't receive further NOVA newsletters." : 'This unsubscribe link is invalid.'}</p>
       <p><a href="/">Return to The NOVA Social Club</a></p></div>`);
  });

  return router;
};
```

- [ ] **Step 4: Update `server/index.js` to parse bodies, set EJS, and mount the router**

Replace `createApp` with:
```js
function createApp(opts = {}) {
  const app = express();
  const rootDir = path.join(__dirname, '..');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const getDb = opts.db ? async () => opts.db : require('./db').getDb;

  app.use('/', require('./routes/public')(getDb));
  app.use(express.static(rootDir, { extensions: ['html'] }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).send('Something went wrong.');
  });
  return app;
}
```
Keep the `require.main` listen block and `module.exports = { createApp }`.

- [ ] **Step 5: Run to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/public.test.js` → Expected PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/public.js server/index.js test/public.test.js
git commit -m "feat: add public apply/newsletter/partner/unsubscribe endpoints"
```

---

## Task 6: Auth foundation — bcrypt, sessions, admin seed, guards

**Files:**
- Create: `server/auth.js`, `server/seed-admin.js`
- Modify: `server/index.js` (session middleware)
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `repo/admins`, `repo/members`, `config`, `db`.
- Produces: `hashPassword(pw)->hash`, `verifyPassword(pw,hash)->bool`, `sessionMiddleware(db)`, `requireAdmin(req,res,next)`, `requireMember(req,res,next)`, `csrf(req,res,next)` + `res.locals.csrfToken`. `seed-admin.js` `run(db)` upserts admin from config, hashing the password.

- [ ] **Step 1: Write `test/auth.test.js` (failing)**

```js
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
  let code = 0; const res = { redirect: () => { code = 302; }, status: () => res, send: () => {} };
  let nexted = false;
  auth.requireAdmin(req, res, () => { nexted = true; });
  expect(nexted).toBe(false);
  expect(code).toBe(302);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/auth.test.js` → Expected FAIL.

- [ ] **Step 3: Write `server/auth.js`**

```js
'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { config } = require('./config');

async function hashPassword(pw) { return bcrypt.hash(pw, 12); }
async function verifyPassword(pw, hash) { if (!hash) return false; return bcrypt.compare(pw, hash); }

function sessionMiddleware(db) {
  const opts = {
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 1000*60*60*24*30 },
  };
  if (db && db.kind === 'pg') {
    const pgSession = require('connect-pg-simple')(session);
    opts.store = new pgSession({ pool: db.pool, createTableIfMissing: true });
  }
  return session(opts);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.redirect('/admin/login');
}
function requireMember(req, res, next) {
  if (req.session && req.session.memberId) return next();
  return res.redirect('/member/login');
}

function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['POST','PUT','DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (sent !== req.session.csrfToken) return res.status(403).send('Invalid CSRF token');
  }
  next();
}

module.exports = { hashPassword, verifyPassword, sessionMiddleware, requireAdmin, requireMember, csrf };
```

- [ ] **Step 4: Write `server/seed-admin.js`**

```js
'use strict';
const { config } = require('./config');
const { hashPassword } = require('./auth');
const admins = require('./repo/admins');

async function run(db) {
  if (!config.adminEmail || !config.adminPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the admin.');
  const hash = await hashPassword(config.adminPassword);
  const admin = await admins.upsert(db, config.adminEmail.toLowerCase(), hash);
  return admin;
}
module.exports = { run };

if (require.main === module) {
  (async () => {
    const { getDb, closeDb } = require('./db');
    const db = await getDb();
    const a = await run(db);
    console.log(`Admin seeded: ${a.email}`);
    await closeDb();
  })();
}
```

- [ ] **Step 5: Add session middleware to `server/index.js`**

In `createApp`, after `urlencoded` and before mounting routers, add:
```js
  const dbForSession = opts.db || null;
  app.use(require('./auth').sessionMiddleware(dbForSession));
```
(For tests `opts.db` is the PGlite handle whose `kind` is `pglite`, so the memory session store is used — fine for tests.)

- [ ] **Step 6: Run to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/auth.test.js` → Expected PASS.

- [ ] **Step 7: Commit**

```bash
git add server/auth.js server/seed-admin.js server/index.js test/auth.test.js
git commit -m "feat: add auth (bcrypt, sessions, guards, csrf) and admin seed"
```

---

## Task 7: Admin login/logout + views shell

**Files:**
- Create: `server/routes/admin.js`, `server/views/layout.ejs`, `server/views/admin/login.ejs`, `server/views/admin/dashboard.ejs`, `server/public-admin.css`
- Modify: `server/index.js` (mount admin router at `/admin`, rate limiter), `server/routes/public.js` (serve `/portal.css`)
- Test: `test/admin-auth.test.js`

**Interfaces:**
- Consumes: `auth`, `repo/admins`, repos for dashboard counts.
- Produces: `GET /admin/login`, `POST /admin/login`, `POST /admin/logout`, `GET /admin` (dashboard, guarded). Admin router factory `adminRoutes(getDb)`.

- [ ] **Step 1: Write `test/admin-auth.test.js` (failing)**

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const seed = require('../server/seed-admin');

async function boot() {
  const db = await freshDb();
  // seed a known admin directly
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
  expect([302,301]).toContain(res.status);
  server.close(); await db.close();
});

test('admin can log in with correct credentials', async () => {
  const { db, server, base } = await boot();
  // fetch login page to get csrf token + cookie
  const page = await fetch(`${base}/admin/login`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const html = await page.text();
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await fetch(`${base}/admin/login`, { method:'POST', redirect:'manual',
    headers: { 'content-type':'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email:'admin@nova.com', password:'pw12345', _csrf: csrf }) });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/admin');
  server.close(); await db.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `/Users/madig/.bun/bin/bun test test/admin-auth.test.js` → Expected FAIL.

- [ ] **Step 3: Write `server/views/layout.ejs`**

```ejs
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title><%= title %> — NOVA Admin</title>
<link rel="stylesheet" href="/portal.css">
</head><body>
<% if (typeof nav !== 'undefined' && nav) { %>
<nav class="portal-nav">
  <a class="brand" href="/admin">NOVA Admin</a>
  <a href="/admin">Dashboard</a>
  <a href="/admin/applications">Applications</a>
  <a href="/admin/members">Members</a>
  <a href="/admin/newsletter">Newsletter</a>
  <a href="/admin/partners">Partners</a>
  <form method="post" action="/admin/logout" class="logout"><input type="hidden" name="_csrf" value="<%= csrfToken %>"><button>Log out</button></form>
</nav>
<% } %>
<main class="portal-main"><%- body %></main>
</body></html>
```

Note: render pages with `ejs.renderFile` of the page into `body`, or use a small helper. Simpler: each page `<%- include('../layout', {..}) %>` is awkward; instead use the pattern where routes call `res.render('admin/dashboard', {...})` and each page template starts with `<%- include('layoutTop') %>`. To keep it simple and DRY, implement a `renderPage(res, view, locals)` helper in `admin.js` that renders the view to string then injects into layout. Define it as:

```js
const ejs = require('ejs');
const path = require('path');
function renderPage(res, view, locals) {
  const viewsDir = path.join(__dirname, '..', 'views');
  ejs.renderFile(path.join(viewsDir, view + '.ejs'), locals, (err, body) => {
    if (err) return res.status(500).send(String(err));
    ejs.renderFile(path.join(viewsDir, 'layout.ejs'), Object.assign({ body }, locals), (e2, html) => {
      if (e2) return res.status(500).send(String(e2));
      res.send(html);
    });
  });
}
```

- [ ] **Step 4: Write `server/views/admin/login.ejs`**

```ejs
<div class="card auth-card">
  <h1>NOVA Admin</h1>
  <% if (error) { %><p class="error"><%= error %></p><% } %>
  <form method="post" action="/admin/login">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <label>Email<input type="email" name="email" required></label>
    <label>Password<input type="password" name="password" required></label>
    <button class="btn-primary">Log in</button>
  </form>
</div>
```

- [ ] **Step 5: Write `server/views/admin/dashboard.ejs`**

```ejs
<h1>Dashboard</h1>
<div class="stat-grid">
  <div class="stat"><span class="num"><%= counts.pending %></span><span class="lbl">Pending applications</span></div>
  <div class="stat"><span class="num"><%= counts.members %></span><span class="lbl">Members</span></div>
  <div class="stat"><span class="num"><%= counts.subscribers %></span><span class="lbl">Subscribers</span></div>
</div>
<h2>Recent applications</h2>
<table class="data"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>When</th></tr></thead><tbody>
<% recent.forEach(function(a){ %>
  <tr><td><a href="/admin/applications/<%= a.id %>"><%= a.first_name %> <%= a.last_name %></a></td><td><%= a.email %></td><td><%= a.status %></td><td><%= new Date(a.created_at).toLocaleDateString() %></td></tr>
<% }); %>
</tbody></table>
```

- [ ] **Step 6: Write `server/public-admin.css`** (served at `/portal.css`)

```css
:root{--ink:#0b0b0f;--bg:#f6f5f2;--blue:#1b3ad1;--line:#e2e0da}
*{box-sizing:border-box}body{margin:0;font-family:Georgia,'Times New Roman',serif;background:var(--bg);color:var(--ink)}
.portal-nav{display:flex;gap:18px;align-items:center;padding:14px 22px;background:#fff;border-bottom:1px solid var(--line)}
.portal-nav a{color:var(--ink);text-decoration:none}.portal-nav .brand{font-weight:700;margin-right:auto}
.portal-nav .logout{margin-left:12px}.portal-nav button{cursor:pointer;background:none;border:1px solid var(--line);padding:6px 12px;border-radius:6px}
.portal-main{max-width:1040px;margin:28px auto;padding:0 22px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:26px}
.auth-card{max-width:380px;margin:80px auto}
label{display:block;margin:12px 0}input,textarea,select{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font:inherit}
.btn-primary{background:var(--blue);color:#fff;border:none;padding:11px 18px;border-radius:8px;cursor:pointer;font:inherit}
.error{color:#b00020}.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:18px 0}
.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px;text-align:center}
.stat .num{display:block;font-size:34px;font-weight:700}.stat .lbl{color:#666;font-size:13px}
table.data{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
table.data th,table.data td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.badge{padding:2px 8px;border-radius:20px;font-size:12px;background:#eee}
```

- [ ] **Step 7: Write `server/routes/admin.js` (login/logout/dashboard only for this task)**

```js
'use strict';
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const admins = require('../repo/admins');
const appsRepo = require('../repo/applications');
const membersRepo = require('../repo/members');
const subsRepo = require('../repo/subscribers');

function renderPage(res, view, locals) {
  const viewsDir = path.join(__dirname, '..', 'views');
  ejs.renderFile(path.join(viewsDir, view + '.ejs'), locals, (err, body) => {
    if (err) return res.status(500).send(String(err));
    ejs.renderFile(path.join(viewsDir, 'layout.ejs'), Object.assign({ body }, locals), (e2, html) =>
      e2 ? res.status(500).send(String(e2)) : res.send(html));
  });
}

module.exports = function adminRoutes(getDb) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });
  router.use(auth.csrf);

  router.get('/login', (req, res) =>
    renderPage(res, 'admin/login', { title: 'Login', nav: false, error: null, csrfToken: res.locals.csrfToken }));

  router.post('/login', loginLimiter, async (req, res) => {
    const db = await getDb();
    const email = String(req.body.email || '').toLowerCase().trim();
    const admin = await admins.getByEmail(db, email);
    const ok = admin && await auth.verifyPassword(String(req.body.password || ''), admin.password_hash);
    if (!ok) return renderPage(res, 'admin/login', { title: 'Login', nav: false, error: 'Invalid email or password.', csrfToken: res.locals.csrfToken });
    req.session.adminId = admin.id;
    res.redirect('/admin');
  });

  router.post('/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); });

  router.use(auth.requireAdmin); // everything below requires login

  router.get('/', async (req, res) => {
    const db = await getDb();
    const all = await appsRepo.list(db, {});
    const counts = {
      pending: all.filter(a => a.status === 'pending').length,
      members: (await membersRepo.list(db, {})).length,
      subscribers: (await subsRepo.activeEmails(db)).length,
    };
    renderPage(res, 'admin/dashboard', { title: 'Dashboard', nav: true, csrfToken: res.locals.csrfToken, counts, recent: all.slice(0, 10) });
  });

  return router;
};
```

- [ ] **Step 8: Serve `/portal.css` and mount admin router in `server/index.js`**

Add before static middleware:
```js
  app.get('/portal.css', (req, res) => res.type('css').sendFile(path.join(__dirname, 'public-admin.css')));
  app.use('/admin', require('./routes/admin')(getDb));
```

- [ ] **Step 9: Run to verify it passes**

Run: `/Users/madig/.bun/bin/bun test test/admin-auth.test.js` → Expected PASS.

- [ ] **Step 10: Commit**

```bash
git add server/routes/admin.js server/views server/public-admin.css server/index.js test/admin-auth.test.js
git commit -m "feat: admin login/logout and dashboard shell"
```

---

## Task 8: Applications review — list, detail, accept (spawn member + email), reject, notes

**Files:**
- Create: `server/views/admin/applications.ejs`, `server/views/admin/application-detail.ejs`
- Modify: `server/routes/admin.js`
- Test: `test/admin-applications.test.js`

**Interfaces:**
- Consumes: `appsRepo`, `membersRepo`, `tokens`, `email`, `config`.
- Produces: `GET /admin/applications` (filter `?status=`), `GET /admin/applications/:id`, `POST /admin/applications/:id/accept` (body `level`), `POST /admin/applications/:id/reject` (body `notify`), `POST /admin/applications/:id/notes`. Level slugs `founding|member|associate`.

- [ ] **Step 1: Write `test/admin-applications.test.js` (failing)** — logs in, submits an application via repo, accepts it, asserts a member row exists with a set-password token and a welcome email is logged.

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const auth = require('../server/auth');
const admins = require('../server/repo/admins');
const appsRepo = require('../server/repo/applications');
const email = require('../server/email');

async function loginAgent(base) {
  const page = await fetch(`${base}/admin/login`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  await fetch(`${base}/admin/login`, { method:'POST', redirect:'manual',
    headers: { 'content-type':'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email:'a@n.com', password:'pw12345', _csrf: csrf }) });
  return { cookie, csrf };
}

test('accepting an application creates a member and logs welcome email', async () => {
  const db = await freshDb();
  await admins.upsert(db, 'a@n.com', await auth.hashPassword('pw12345'));
  email.__setSender(async () => ({ id: 'x' }));
  const appRow = await appsRepo.create(db, { first_name:'Ada', last_name:'L', email:'ada@x.com', phone:'', company:'', profession:'', linkedin:'', area:'', why:'' });
  const app = createApp({ db }); const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const { cookie, csrf } = await loginAgent(base);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/accept`, { method:'POST', redirect:'manual',
    headers:{ 'content-type':'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ level:'member', _csrf: csrf }) });
  expect(res.status).toBe(302);
  const { rows } = await db.query('SELECT * FROM members WHERE email=$1', ['ada@x.com']);
  expect(rows.length).toBe(1);
  expect(rows[0].set_password_token).toBeTruthy();
  const { rows: log } = await db.query("SELECT * FROM email_log WHERE type='welcome_set_password'");
  expect(log.length).toBe(1);
  server.close(); await db.close();
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `/Users/madig/.bun/bin/bun test test/admin-applications.test.js` → FAIL.

- [ ] **Step 3: Add routes to `server/routes/admin.js`** (after dashboard route, before `return router`):

```js
  const LEVELS = { founding: 'Founding Member', member: 'Member', associate: 'Associate' };
  const tokens = require('../tokens');

  router.get('/applications', async (req, res) => {
    const db = await getDb();
    const status = req.query.status || '';
    const rows = await appsRepo.list(db, status ? { status } : {});
    renderPage(res, 'admin/applications', { title:'Applications', nav:true, csrfToken:res.locals.csrfToken, rows, status, LEVELS });
  });

  router.get('/applications/:id', async (req, res) => {
    const db = await getDb();
    const a = await appsRepo.getById(db, Number(req.params.id));
    if (!a) return res.status(404).send('Not found');
    renderPage(res, 'admin/application-detail', { title:'Application', nav:true, csrfToken:res.locals.csrfToken, a, LEVELS });
  });

  router.post('/applications/:id/accept', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const level = String(req.body.level || '');
    if (!LEVELS[level]) return res.status(400).send('Invalid level');
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    await appsRepo.setStatus(db, id, 'accepted', level, new Date());
    const existing = await membersRepo.getByEmail(db, a.email);
    let member = existing;
    const token = tokens.newToken(); const expires = tokens.expiryFromNow(7);
    if (existing) { member = await membersRepo.setSetToken(db, existing.id, token, expires); await membersRepo.setLevel(db, existing.id, level); }
    else { member = await membersRepo.createFromApplication(db, a, level, token, expires); }
    const url = `${require('../config').config.appBaseUrl}/member/set-password?token=${token}`;
    const t = email.welcomeSetPasswordEmail(member, url);
    await email.sendEmail(db, { to: member.email, subject: t.subject, html: t.html, type: 'welcome_set_password', memberId: member.id });
    res.redirect(`/admin/applications/${id}`);
  });

  router.post('/applications/:id/reject', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    await appsRepo.setStatus(db, id, 'rejected', null, new Date());
    if (req.body.notify === 'on') {
      const t = email.rejectionEmail(a);
      await email.sendEmail(db, { to: a.email, subject: t.subject, html: t.html, type: 'rejection' });
    }
    res.redirect(`/admin/applications/${id}`);
  });

  router.post('/applications/:id/notes', async (req, res) => {
    const db = await getDb();
    await appsRepo.addNote(db, Number(req.params.id), require('../validate').cleanStr(req.body.notes, 2000));
    res.redirect(`/admin/applications/${req.params.id}`);
  });
```

- [ ] **Step 4: Write `server/views/admin/applications.ejs`**

```ejs
<h1>Applications</h1>
<div class="actions">
  <a class="badge" href="/admin/applications">All</a>
  <a class="badge" href="/admin/applications?status=pending">Pending</a>
  <a class="badge" href="/admin/applications?status=accepted">Accepted</a>
  <a class="badge" href="/admin/applications?status=rejected">Rejected</a>
</div>
<table class="data"><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th><th>Level</th><th>When</th></tr></thead><tbody>
<% rows.forEach(function(a){ %>
<tr><td><a href="/admin/applications/<%= a.id %>"><%= a.first_name %> <%= a.last_name %></a></td>
<td><%= a.email %></td><td><%= a.company || '' %></td><td><%= a.status %></td>
<td><%= a.membership_level ? LEVELS[a.membership_level] : '' %></td>
<td><%= new Date(a.created_at).toLocaleDateString() %></td></tr>
<% }); %>
</tbody></table>
```

- [ ] **Step 5: Write `server/views/admin/application-detail.ejs`**

```ejs
<p><a href="/admin/applications">← All applications</a></p>
<h1><%= a.first_name %> <%= a.last_name %> <span class="badge"><%= a.status %></span></h1>
<div class="card">
  <p><b>Email:</b> <%= a.email %> &nbsp; <b>Phone:</b> <%= a.phone || '—' %></p>
  <p><b>Company:</b> <%= a.company || '—' %> &nbsp; <b>Profession:</b> <%= a.profession || '—' %></p>
  <p><b>LinkedIn:</b> <%= a.linkedin || '—' %> &nbsp; <b>Area:</b> <%= a.area || '—' %></p>
  <p><b>Why join:</b><br><%= a.why || '—' %></p>
</div>
<% if (a.status === 'pending') { %>
<div class="card">
  <h3>Accept</h3>
  <form method="post" action="/admin/applications/<%= a.id %>/accept" class="actions">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <select name="level"><% Object.keys(LEVELS).forEach(function(k){ %><option value="<%= k %>"><%= LEVELS[k] %></option><% }); %></select>
    <button class="btn-primary">Accept &amp; create login</button>
  </form>
  <h3>Reject</h3>
  <form method="post" action="/admin/applications/<%= a.id %>/reject" class="actions">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" name="notify" style="width:auto"> Email applicant</label>
    <button>Reject</button>
  </form>
</div>
<% } %>
<div class="card">
  <h3>Private notes</h3>
  <form method="post" action="/admin/applications/<%= a.id %>/notes">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <textarea name="notes" rows="4"><%= a.admin_notes || '' %></textarea>
    <button class="btn-primary">Save notes</button>
  </form>
</div>
```

- [ ] **Step 6: Run to verify it passes.** Run: `/Users/madig/.bun/bin/bun test test/admin-applications.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin.js server/views/admin/applications.ejs server/views/admin/application-detail.ejs test/admin-applications.test.js
git commit -m "feat: admin applications review with accept/reject/notes"
```

---

## Task 9: Members management + one-off member email

**Files:**
- Create: `server/views/admin/members.ejs`, `server/views/admin/member-detail.ejs`
- Modify: `server/routes/admin.js`
- Test: `test/admin-members.test.js`

**Interfaces:**
- Produces: `GET /admin/members` (search `?q=`), `GET /admin/members/:id`, `POST /admin/members/:id/level`, `POST /admin/members/:id/status`, `POST /admin/members/:id/resend`, `POST /admin/members/:id/email` (subject, body → Resend + log).

- [ ] **Step 1: Write `test/admin-members.test.js` (failing)** — logs in, creates a member via repo, posts a one-off email, asserts `email_log` has a `member_email` row for that member.

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const auth = require('../server/auth');
const admins = require('../server/repo/admins');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const { newToken, expiryFromNow } = require('../server/tokens');
const email = require('../server/email');

test('admin can send a one-off email to a member', async () => {
  const db = await freshDb();
  await admins.upsert(db, 'a@n.com', await auth.hashPassword('pw12345'));
  email.__setSender(async () => ({ id: 'x' }));
  const a = await appsRepo.create(db, { first_name:'M', last_name:'X', email:'m@x.com', phone:'', company:'', profession:'', linkedin:'', area:'', why:'' });
  const m = await membersRepo.createFromApplication(db, a, 'member', newToken(), expiryFromNow(7));
  const app = createApp({ db }); const server = app.listen(0); const base = `http://localhost:${server.address().port}`;
  const page = await fetch(`${base}/admin/login`); const cookie = page.headers.get('set-cookie').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  await fetch(`${base}/admin/login`, { method:'POST', redirect:'manual', headers:{'content-type':'application/x-www-form-urlencoded', cookie}, body:new URLSearchParams({ email:'a@n.com', password:'pw12345', _csrf:csrf }) });
  const res = await fetch(`${base}/admin/members/${m.id}/email`, { method:'POST', redirect:'manual', headers:{'content-type':'application/x-www-form-urlencoded', cookie}, body:new URLSearchParams({ subject:'Hello', body:'<p>hi</p>', _csrf:csrf }) });
  expect(res.status).toBe(302);
  const { rows } = await db.query("SELECT * FROM email_log WHERE type='member_email' AND member_id=$1", [m.id]);
  expect(rows.length).toBe(1);
  server.close(); await db.close();
});
```

- [ ] **Step 2: Run to verify it fails.** → FAIL.

- [ ] **Step 3: Add member routes to `server/routes/admin.js`**

```js
  router.get('/members', async (req, res) => {
    const db = await getDb();
    const q = req.query.q || '';
    const rows = await membersRepo.list(db, q ? { q } : {});
    renderPage(res, 'admin/members', { title:'Members', nav:true, csrfToken:res.locals.csrfToken, rows, q, LEVELS });
  });
  router.get('/members/:id', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    renderPage(res, 'admin/member-detail', { title:'Member', nav:true, csrfToken:res.locals.csrfToken, m, LEVELS });
  });
  router.post('/members/:id/level', async (req, res) => {
    const db = await getDb(); const level = String(req.body.level||'');
    if (!LEVELS[level]) return res.status(400).send('Invalid level');
    await membersRepo.setLevel(db, Number(req.params.id), level);
    res.redirect(`/admin/members/${req.params.id}`);
  });
  router.post('/members/:id/status', async (req, res) => {
    const db = await getDb(); const status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await membersRepo.setStatus(db, Number(req.params.id), status);
    res.redirect(`/admin/members/${req.params.id}`);
  });
  router.post('/members/:id/resend', async (req, res) => {
    const db = await getDb(); const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const token = tokens.newToken();
    await membersRepo.setSetToken(db, m.id, token, tokens.expiryFromNow(7));
    const url = `${require('../config').config.appBaseUrl}/member/set-password?token=${token}`;
    const t = email.welcomeSetPasswordEmail(m, url);
    await email.sendEmail(db, { to: m.email, subject: t.subject, html: t.html, type:'welcome_set_password', memberId: m.id });
    res.redirect(`/admin/members/${m.id}`);
  });
  router.post('/members/:id/email', async (req, res) => {
    const db = await getDb(); const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const subject = require('../validate').cleanStr(req.body.subject, 200);
    const body = String(req.body.body || '');
    await email.sendEmail(db, { to: m.email, subject, html: `<div style="font-family:Georgia,serif">${body}</div>`, type:'member_email', memberId: m.id });
    res.redirect(`/admin/members/${m.id}`);
  });
```

- [ ] **Step 4: Write `server/views/admin/members.ejs`**

```ejs
<h1>Members</h1>
<form method="get" action="/admin/members" class="actions">
  <input name="q" value="<%= q %>" placeholder="Search name or email">
  <button class="btn-primary">Search</button>
</form>
<table class="data"><thead><tr><th>Name</th><th>Email</th><th>Level</th><th>Status</th><th>Login set?</th></tr></thead><tbody>
<% rows.forEach(function(m){ %>
<tr><td><a href="/admin/members/<%= m.id %>"><%= m.first_name %> <%= m.last_name %></a></td>
<td><%= m.email %></td><td><%= LEVELS[m.membership_level] %></td><td><%= m.status %></td>
<td><%= m.password_hash ? 'yes' : 'pending' %></td></tr>
<% }); %>
</tbody></table>
```

- [ ] **Step 5: Write `server/views/admin/member-detail.ejs`**

```ejs
<p><a href="/admin/members">← All members</a></p>
<h1><%= m.first_name %> <%= m.last_name %> <span class="badge"><%= m.status %></span></h1>
<div class="card">
  <p><b>Email:</b> <%= m.email %> &nbsp; <b>Phone:</b> <%= m.phone || '—' %></p>
  <p><b>Company:</b> <%= m.company || '—' %> &nbsp; <b>LinkedIn:</b> <%= m.linkedin || '—' %></p>
  <p><b>Login:</b> <%= m.password_hash ? 'active' : 'not set yet' %></p>
</div>
<div class="card"><h3>Membership level</h3>
  <form method="post" action="/admin/members/<%= m.id %>/level" class="actions">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <select name="level"><% Object.keys(LEVELS).forEach(function(k){ %><option value="<%= k %>" <%= m.membership_level===k?'selected':'' %>><%= LEVELS[k] %></option><% }); %></select>
    <button class="btn-primary">Update level</button>
  </form>
  <h3>Status</h3>
  <form method="post" action="/admin/members/<%= m.id %>/status" class="actions">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <select name="status"><option value="active" <%= m.status==='active'?'selected':'' %>>active</option><option value="inactive" <%= m.status==='inactive'?'selected':'' %>>inactive</option></select>
    <button>Update status</button>
  </form>
  <h3>Login link</h3>
  <form method="post" action="/admin/members/<%= m.id %>/resend"><input type="hidden" name="_csrf" value="<%= csrfToken %>"><button>Resend set-password email</button></form>
</div>
<div class="card"><h3>Email this member</h3>
  <form method="post" action="/admin/members/<%= m.id %>/email">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <label>Subject<input name="subject" required></label>
    <label>Message (HTML allowed)<textarea name="body" rows="6" required></textarea></label>
    <button class="btn-primary">Send email</button>
  </form>
</div>
```

- [ ] **Step 6: Run to verify it passes.** → PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin.js server/views/admin/members.ejs server/views/admin/member-detail.ejs test/admin-members.test.js
git commit -m "feat: admin members management and one-off email"
```

---

## Task 10: Newsletter admin (list, CSV export, broadcast) + partner inquiries view

**Files:**
- Create: `server/views/admin/newsletter.ejs`, `server/views/admin/partners.ejs`
- Modify: `server/routes/admin.js`
- Test: `test/admin-newsletter.test.js`

**Interfaces:**
- Produces: `GET /admin/newsletter`, `GET /admin/newsletter/export.csv`, `POST /admin/newsletter/broadcast` (subject, body → one email per active subscriber, each with unsubscribe link, all logged), `GET /admin/partners`.

- [ ] **Step 1: Write `test/admin-newsletter.test.js` (failing)** — seeds 2 subscribers, logs in, posts a broadcast, asserts 2 `broadcast` rows in `email_log` and each send included an unsubscribe URL (assert sender received html containing `/unsubscribe?token=`).

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const auth = require('../server/auth');
const admins = require('../server/repo/admins');
const subs = require('../server/repo/subscribers');
const { newToken } = require('../server/tokens');
const email = require('../server/email');

test('broadcast emails every active subscriber with unsubscribe link', async () => {
  const db = await freshDb();
  await admins.upsert(db, 'a@n.com', await auth.hashPassword('pw12345'));
  await subs.subscribe(db, 'one@x.com', newToken());
  await subs.subscribe(db, 'two@x.com', newToken());
  const seen = [];
  email.__setSender(async (m) => { seen.push(m); return { id:'x' }; });
  const app = createApp({ db }); const server = app.listen(0); const base = `http://localhost:${server.address().port}`;
  const page = await fetch(`${base}/admin/login`); const cookie = page.headers.get('set-cookie').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  await fetch(`${base}/admin/login`, { method:'POST', redirect:'manual', headers:{'content-type':'application/x-www-form-urlencoded', cookie}, body:new URLSearchParams({ email:'a@n.com', password:'pw12345', _csrf:csrf }) });
  const res = await fetch(`${base}/admin/newsletter/broadcast`, { method:'POST', redirect:'manual', headers:{'content-type':'application/x-www-form-urlencoded', cookie}, body:new URLSearchParams({ subject:'News', body:'<p>hi</p>', _csrf:csrf }) });
  expect(res.status).toBe(302);
  expect(seen.length).toBe(2);
  expect(seen.every(m => m.html.includes('/unsubscribe?token='))).toBe(true);
  const { rows } = await db.query("SELECT * FROM email_log WHERE type='broadcast'");
  expect(rows.length).toBe(2);
  server.close(); await db.close();
});
```

- [ ] **Step 2: Run to verify it fails.** → FAIL.

- [ ] **Step 3: Add routes to `server/routes/admin.js`**

```js
  const subsRepoFull = require('../repo/subscribers');
  const partnersRepo = require('../repo/partners');

  router.get('/newsletter', async (req, res) => {
    const db = await getDb();
    const rows = await subsRepoFull.list(db);
    renderPage(res, 'admin/newsletter', { title:'Newsletter', nav:true, csrfToken:res.locals.csrfToken, rows });
  });
  router.get('/newsletter/export.csv', async (req, res) => {
    const db = await getDb();
    const rows = await subsRepoFull.list(db);
    const csv = ['email,status,created_at'].concat(rows.map(r => `${r.email},${r.status},${new Date(r.created_at).toISOString()}`)).join('\n');
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="subscribers.csv"').send(csv);
  });
  router.post('/newsletter/broadcast', async (req, res) => {
    const db = await getDb();
    const subject = require('../validate').cleanStr(req.body.subject, 200);
    const body = String(req.body.body || '');
    const cfg = require('../config').config;
    const all = await subsRepoFull.list(db);
    for (const s of all.filter(x => x.status === 'subscribed')) {
      const unsub = `${cfg.appBaseUrl}/unsubscribe?token=${s.unsubscribe_token}`;
      const t = email.broadcastEmail(subject, body, unsub);
      await email.sendEmail(db, { to: s.email, subject: t.subject, html: t.html, type: 'broadcast' });
    }
    res.redirect('/admin/newsletter');
  });
  router.get('/partners', async (req, res) => {
    const db = await getDb();
    const rows = await partnersRepo.list(db);
    renderPage(res, 'admin/partners', { title:'Partners', nav:true, csrfToken:res.locals.csrfToken, rows });
  });
```

- [ ] **Step 4: Write `server/views/admin/newsletter.ejs`**

```ejs
<h1>Newsletter</h1>
<p><a class="badge" href="/admin/newsletter/export.csv">Export CSV</a> &nbsp; <%= rows.filter(r=>r.status==='subscribed').length %> active subscribers</p>
<div class="card"><h3>Send a broadcast</h3>
  <form method="post" action="/admin/newsletter/broadcast">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <label>Subject<input name="subject" required></label>
    <label>Body (HTML allowed)<textarea name="body" rows="8" required></textarea></label>
    <button class="btn-primary">Send to all subscribers</button>
  </form>
</div>
<table class="data"><thead><tr><th>Email</th><th>Status</th><th>Joined</th></tr></thead><tbody>
<% rows.forEach(function(s){ %><tr><td><%= s.email %></td><td><%= s.status %></td><td><%= new Date(s.created_at).toLocaleDateString() %></td></tr><% }); %>
</tbody></table>
```

- [ ] **Step 5: Write `server/views/admin/partners.ejs`**

```ejs
<h1>Partner inquiries</h1>
<table class="data"><thead><tr><th>Business</th><th>Contact</th><th>Email</th><th>Message</th><th>When</th></tr></thead><tbody>
<% rows.forEach(function(p){ %><tr><td><%= p.business %></td><td><%= p.contact_name || '' %></td><td><%= p.email %></td><td><%= p.message || '' %></td><td><%= new Date(p.created_at).toLocaleDateString() %></td></tr><% }); %>
</tbody></table>
```

- [ ] **Step 6: Run to verify it passes.** → PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin.js server/views/admin/newsletter.ejs server/views/admin/partners.ejs test/admin-newsletter.test.js
git commit -m "feat: admin newsletter broadcast/export and partner inquiries"
```

---

## Task 11: Member area — set password, login, My Membership

**Files:**
- Create: `server/routes/member.js`, `server/views/member/set-password.ejs`, `server/views/member/login.ejs`, `server/views/member/home.ejs`
- Modify: `server/index.js` (mount member router at `/member`)
- Test: `test/member.test.js`

**Interfaces:**
- Consumes: `membersRepo`, `auth`, `tokens`.
- Produces: `GET /member/set-password?token=`, `POST /member/set-password`, `GET /member/login`, `POST /member/login`, `POST /member/logout`, `GET /member` (guarded My Membership).

- [ ] **Step 1: Write `test/member.test.js` (failing)** — creates a member with a token, sets password via POST, then logs in and loads `/member`, asserting the page shows the membership level.

```js
const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const { newToken, expiryFromNow } = require('../server/tokens');

async function getCsrf(base, pathname, cookieIn) {
  const r = await fetch(`${base}${pathname}`, { headers: cookieIn ? { cookie: cookieIn } : {} });
  const cookie = (r.headers.get('set-cookie') || (cookieIn||'') ).split(';')[0];
  const csrf = (await r.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  return { cookie, csrf };
}

test('member sets password then logs in and sees membership', async () => {
  const db = await freshDb();
  const a = await appsRepo.create(db, { first_name:'Mia', last_name:'K', email:'mia@x.com', phone:'', company:'', profession:'', linkedin:'', area:'', why:'' });
  const token = newToken();
  const m = await membersRepo.createFromApplication(db, a, 'founding', token, expiryFromNow(7));
  const app = createApp({ db }); const server = app.listen(0); const base = `http://localhost:${server.address().port}`;
  let { cookie, csrf } = await getCsrf(base, `/member/set-password?token=${token}`);
  let res = await fetch(`${base}/member/set-password`, { method:'POST', redirect:'manual', headers:{'content-type':'application/x-www-form-urlencoded', cookie}, body:new URLSearchParams({ token, password:'memberpw1', _csrf:csrf }) });
  expect(res.status).toBe(302);
  ({ cookie, csrf } = await getCsrf(base, '/member/login'));
  res = await fetch(`${base}/member/login`, { method:'POST', redirect:'manual', headers:{'content-type':'application/x-www-form-urlencoded', cookie}, body:new URLSearchParams({ email:'mia@x.com', password:'memberpw1', _csrf:csrf }) });
  expect(res.status).toBe(302);
  const home = await fetch(`${base}/member`, { headers:{ cookie } });
  const html = await home.text();
  expect(html).toContain('Founding Member');
  server.close(); await db.close();
});
```

- [ ] **Step 2: Run to verify it fails.** → FAIL.

- [ ] **Step 3: Write `server/routes/member.js`**

```js
'use strict';
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const auth = require('../auth');
const membersRepo = require('../repo/members');

const LEVELS = { founding: 'Founding Member', member: 'Member', associate: 'Associate' };
const PERKS = ['Complimentary access to member-only events','Priority access to programming','Member perks & discounts at NoVA partners','Access to the private NOVA member network'];

function render(res, view, locals) {
  const viewsDir = path.join(__dirname, '..', 'views');
  ejs.renderFile(path.join(viewsDir, view + '.ejs'), locals, (err, body) => {
    if (err) return res.status(500).send(String(err));
    ejs.renderFile(path.join(viewsDir, 'layout.ejs'), Object.assign({ body }, locals), (e2, html) =>
      e2 ? res.status(500).send(String(e2)) : res.send(html));
  });
}

module.exports = function memberRoutes(getDb) {
  const router = express.Router();
  router.use(auth.csrf);

  router.get('/set-password', async (req, res) => {
    const db = await getDb();
    const token = String(req.query.token || '');
    const m = await membersRepo.getBySetToken(db, token);
    const valid = m && m.token_expires_at && new Date(m.token_expires_at) > new Date();
    render(res, 'member/set-password', { title:'Set Password', nav:false, csrfToken:res.locals.csrfToken, token, valid, error:null });
  });

  router.post('/set-password', async (req, res) => {
    const db = await getDb();
    const token = String(req.body.token || '');
    const pw = String(req.body.password || '');
    const m = await membersRepo.getBySetToken(db, token);
    const valid = m && m.token_expires_at && new Date(m.token_expires_at) > new Date();
    if (!valid || pw.length < 8) return render(res, 'member/set-password', { title:'Set Password', nav:false, csrfToken:res.locals.csrfToken, token, valid, error:'Invalid link or password too short (min 8).' });
    await membersRepo.setPassword(db, m.id, await auth.hashPassword(pw));
    req.session.memberId = m.id;
    res.redirect('/member');
  });

  router.get('/login', (req, res) => render(res, 'member/login', { title:'Member Login', nav:false, csrfToken:res.locals.csrfToken, error:null }));

  router.post('/login', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getByEmail(db, String(req.body.email||'').toLowerCase().trim());
    const ok = m && m.status === 'active' && await auth.verifyPassword(String(req.body.password||''), m.password_hash);
    if (!ok) return render(res, 'member/login', { title:'Member Login', nav:false, csrfToken:res.locals.csrfToken, error:'Invalid email or password.' });
    req.session.memberId = m.id;
    res.redirect('/member');
  });

  router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/member/login')));

  router.get('/', auth.requireMember, async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, req.session.memberId);
    if (!m) { req.session.destroy(()=>{}); return res.redirect('/member/login'); }
    render(res, 'member/home', { title:'My Membership', nav:false, csrfToken:res.locals.csrfToken, m, levelLabel: LEVELS[m.membership_level], perks: PERKS });
  });

  return router;
};
```

- [ ] **Step 4: Write the three member views**

`server/views/member/set-password.ejs`:
```ejs
<div class="card auth-card">
  <h1>Set your password</h1>
  <% if (!valid) { %><p class="error">This link is invalid or has expired. Contact the club for a new one.</p>
  <% } else { %>
  <% if (error) { %><p class="error"><%= error %></p><% } %>
  <form method="post" action="/member/set-password">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>"><input type="hidden" name="token" value="<%= token %>">
    <label>New password (min 8 chars)<input type="password" name="password" minlength="8" required></label>
    <button class="btn-primary">Set password</button>
  </form><% } %>
</div>
```

`server/views/member/login.ejs`:
```ejs
<div class="card auth-card">
  <h1>Member login</h1>
  <% if (error) { %><p class="error"><%= error %></p><% } %>
  <form method="post" action="/member/login">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <label>Email<input type="email" name="email" required></label>
    <label>Password<input type="password" name="password" required></label>
    <button class="btn-primary">Log in</button>
  </form>
</div>
```

`server/views/member/home.ejs`:
```ejs
<div class="card">
  <h1>Welcome, <%= m.first_name %></h1>
  <p><b>Membership:</b> <%= levelLabel %> &nbsp; <span class="badge"><%= m.status %></span></p>
  <h3>Your perks</h3>
  <ul><% perks.forEach(function(p){ %><li><%= p %></li><% }); %></ul>
  <form method="post" action="/member/logout"><input type="hidden" name="_csrf" value="<%= csrfToken %>"><button>Log out</button></form>
</div>
```

- [ ] **Step 5: Mount member router in `server/index.js`** (after admin mount):
```js
  app.use('/member', require('./routes/member')(getDb));
```

- [ ] **Step 6: Run to verify it passes.** → PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/member.js server/views/member server/index.js test/member.test.js
git commit -m "feat: member set-password, login, and My Membership page"
```

---

## Task 12: Wire the existing site — application fields, newsletter footer form, fetch submits

**Files:**
- Modify: `index.html` (add phone/company/linkedin to `#apply-form`; add honeypot; add newsletter footer form), `main.js` (replace localStorage handler with fetch to endpoints)
- Test: `test/frontend-wiring.test.js` (asserts the served `index.html` contains the new fields and the newsletter form; a Bun DOM-free string check)

**Interfaces:**
- Consumes: `/api/apply`, `/api/newsletter`, `/api/partner`.
- Produces: updated public HTML/JS. No server interface changes.

- [ ] **Step 1: Write `test/frontend-wiring.test.js` (failing)**

```js
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

test('main.js posts to the real endpoints', () => {
  const js = fs.readFileSync('main.js', 'utf8');
  expect(js).toContain('/api/apply');
  expect(js).toContain('/api/newsletter');
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `/Users/madig/.bun/bin/bun test test/frontend-wiring.test.js` → FAIL.

- [ ] **Step 3: Edit `index.html` — add fields to `#apply-form`.** After the email field (`index.html:322`), insert:

```html
              <div class="form-field">
                <label for="phone">Phone</label>
                <input type="tel" id="phone" name="phone" placeholder="(571) 555-0123" />
              </div>
              <div class="form-field">
                <label for="company">Company</label>
                <input type="text" id="company" name="company" placeholder="Where you work" />
              </div>
              <div class="form-field">
                <label for="linkedin">LinkedIn</label>
                <input type="url" id="linkedin" name="linkedin" placeholder="linkedin.com/in/you" />
              </div>
```
And inside `<form id="apply-form" novalidate>` add a honeypot right after the opening tag:
```html
              <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />
```
Add the same honeypot inside `#partner-form`.

- [ ] **Step 4: Edit `index.html` — add newsletter form to the footer.** Locate the footer (search for `<footer`); inside it add:

```html
          <form id="newsletter-form" class="newsletter" novalidate>
            <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />
            <label for="nl-email" class="newsletter__label">Join our newsletter</label>
            <div class="newsletter__row">
              <input type="email" id="nl-email" name="email" placeholder="you@example.com" required />
              <button type="submit" class="btn btn--blue-filled">Subscribe</button>
            </div>
            <p class="newsletter__msg" id="newsletter-msg" hidden></p>
          </form>
```

- [ ] **Step 5: Edit `main.js` — replace the localStorage `wireForm` with real POSTs.** Replace the body of `wireForm` (lines ~101-150) so that on submit it validates required fields (keep existing UX), then:

```js
      // Submit to the backend
      var endpoint = form.getAttribute('data-endpoint');
      var payload = {};
      new FormData(form).forEach(function (value, key) { payload[key] = value; });
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res.ok) { throw new Error((res.errors && res.errors[0]) || 'Submission failed'); }
        // existing success animation:
        form.style.transition = 'opacity 0.4s, transform 0.4s';
        form.style.opacity = '0'; form.style.transform = 'translateY(-10px)';
        setTimeout(function () {
          form.hidden = true; success.hidden = false;
          success.style.opacity = '0'; success.style.transform = 'translateY(10px)';
          success.style.transition = 'opacity 0.4s, transform 0.4s';
          requestAnimationFrame(function () { success.style.opacity = '1'; success.style.transform = 'translateY(0)'; });
        }, 400);
      }).catch(function (err) {
        alert(err.message); // minimal error surface; keep form visible
      });
```
Set the endpoints by adding `data-endpoint` attributes on the forms in `index.html`: `#apply-form` → `data-endpoint="/api/apply"`, `#partner-form` → `data-endpoint="/api/partner"`. Update the two `wireForm(...)` calls to drop the `storageKey` argument (no longer used).

Then add a dedicated newsletter handler at the end of `main.js`:
```js
  /* ── Newsletter signup ──────────────────────────────────── */
  var nlForm = document.getElementById('newsletter-form');
  if (nlForm) {
    nlForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('newsletter-msg');
      var payload = {}; new FormData(nlForm).forEach(function (v, k) { payload[k] = v; });
      fetch('/api/newsletter', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          msg.hidden = false;
          msg.textContent = res.ok ? "You're subscribed — check your inbox." : ((res.errors && res.errors[0]) || 'Please try again.');
          if (res.ok) nlForm.reset();
        }).catch(function () { msg.hidden = false; msg.textContent = 'Please try again.'; });
    });
  }
```

- [ ] **Step 6: Add minimal newsletter styles to `style.css`.** Append:
```css
.newsletter{position:relative;margin-top:20px;max-width:420px}
.newsletter__label{display:block;margin-bottom:8px;font-weight:600}
.newsletter__row{display:flex;gap:8px}
.newsletter__row input{flex:1}
.newsletter__msg{margin-top:8px;font-size:14px;opacity:.85}
```

- [ ] **Step 7: Run to verify it passes.** Run: `/Users/madig/.bun/bin/bun test test/frontend-wiring.test.js` → PASS.

- [ ] **Step 8: Manual smoke (documented, run in Task 13).** Commit:

```bash
git add index.html main.js style.css test/frontend-wiring.test.js
git commit -m "feat: wire site forms to backend and add newsletter signup"
```

---

## Task 13: Full suite green + docs + manual verification checklist

**Files:**
- Create: `docs/DEPLOY.md`
- Modify: `replit.md` (document the backend)
- Test: whole suite

- [ ] **Step 1: Run the entire test suite.** Run: `/Users/madig/.bun/bin/bun test`
Expected: all suites PASS.

- [ ] **Step 2: Write `docs/DEPLOY.md`** documenting: enabling Replit PostgreSQL, setting all Secrets (`DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_BASE_URL`, `NODE_ENV=production`), running `node server/migrate.js` then `node server/seed-admin.js`, verifying the Resend domain, and the run command `node server/index.js`. Include the local dev note: with no `DATABASE_URL`, the app uses in-memory PGlite (data resets on restart) — for local persistence set `USE_MEMORY_DB=0` and a real `DATABASE_URL`.

- [ ] **Step 3: Update `replit.md`** — add a "Backend" section describing the server, admin portal at `/admin`, member area at `/member`, and pointing to `docs/DEPLOY.md`.

- [ ] **Step 4: Local manual smoke (bun).** Start locally with in-memory DB + fake email by running `ADMIN_EMAIL=a@n.com ADMIN_PASSWORD=pw12345 /Users/madig/.bun/bin/bun server/index.js` after seeding in a REPL is not trivial with memory DB; instead document that full manual verification happens on Replit where Postgres persists. Record this explicitly in `docs/DEPLOY.md` under "Manual verification": submit an application on the live site → see it in `/admin/applications` → accept as Member → receive the welcome email → set password → log in at `/member` → send a newsletter broadcast.

- [ ] **Step 5: Commit**

```bash
git add docs/DEPLOY.md replit.md
git commit -m "docs: deployment guide and backend notes; full suite green"
```

- [ ] **Step 6: Push branch and open PR** (per branch-per-edit workflow):

```bash
git push -u origin feat/admin-backend
```
Then open a PR titled "Admin backend & member portal" summarizing the feature, linking the spec and this plan.

---

## Self-Review

**Spec coverage:**
- Applications capture (with phone/company/linkedin) → Tasks 3, 5, 12. ✓
- Newsletter signup + store + broadcast + unsubscribe → Tasks 3, 5, 10, 12. ✓
- Partner inquiries stored + viewable → Tasks 3, 5, 10. ✓
- Admin login (single, seeded, rate-limited) → Tasks 6, 7. ✓
- Dashboard, applications review, accept→member+level+email, reject, notes → Tasks 7, 8. ✓
- Members management, level/status, resend link, one-off email → Task 9. ✓
- Member set-password/login/My Membership → Task 11. ✓
- Resend email wrapper + email_log + templates + graceful missing-key → Task 4. ✓
- Auth/security: bcrypt, sessions in Postgres, CSRF, honeypot, parameterized SQL, expiring single-use tokens → Tasks 4, 5, 6, 12. ✓
- Postgres on Replit, PGlite for local/test, migrations, seed → Tasks 1, 2, 6, 13. ✓
- Static site unchanged in look → Task 12 (additive fields only). ✓
- Deploy/setup docs → Task 13. ✓

**Placeholder scan:** No TBD/TODO; every code step contains real code. The one "documented, not run locally" item (Task 13 Step 4) is an explicit decision (memory DB resets), not a placeholder, with the real verification path defined for Replit.

**Type consistency:** Repo function names used by routes match their definitions (`createFromApplication`, `getBySetToken`, `setSetToken`, `activeEmails`, `subscribe`, `record`). `email.sendEmail(db, {to,subject,html,type,memberId})` signature is consistent across public/admin routes. `email_log.type` values (`application_received`, `admin_notify`, `welcome_set_password`, `rejection`, `newsletter_confirm`, `broadcast`, `member_email`) are consistent between senders and test assertions. Level slugs `founding|member|associate` consistent across admin, member, and email. CSRF field `_csrf` consistent across all forms and `auth.csrf`.
