# Deploying the NOVA Admin Backend (Replit)

The site is now a Node/Express app that serves the static marketing site **and**
the admin + member portals. Follow these steps once to go live.

## 1. Enable PostgreSQL on Replit

In your Repl: **Tools → Database → Create a PostgreSQL database.** Replit sets the
`DATABASE_URL` secret automatically. That is the only database configuration needed.

## 2. Create a Resend account and verify your sending domain

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add Domain**, enter `thenovasocialclub.com` (or your domain).
3. Add the DNS records Resend shows (SPF, DKIM) at your domain registrar.
4. Once verified, create an API key under **API Keys**.

Until the domain is verified you can still deploy — the app logs a warning and
skips real sends (nothing crashes). Emails only actually go out once
`RESEND_API_KEY` is set and the domain is verified.

## 3. Set Secrets (Tools → Secrets)

| Secret | Example / notes |
|---|---|
| `DATABASE_URL` | set automatically by Replit Postgres |
| `NODE_ENV` | `production` (enables secure cookies) |
| `SESSION_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
| `RESEND_API_KEY` | `re_...` from Resend |
| `RESEND_FROM` | `The NOVA Social Club <hello@thenovasocialclub.com>` |
| `ADMIN_EMAIL` | the single admin's login email |
| `ADMIN_PASSWORD` | a strong password (used once to seed the admin) |
| `APP_BASE_URL` | your live URL, e.g. `https://thenovasocialclub.com` |

`APP_BASE_URL` matters: it builds the set-password and unsubscribe links in
emails. Set it to the real deployed URL.

## 4. Initialize the database (run once, in the Replit Shell)

```bash
npm install
node server/migrate.js      # creates all tables
node server/seed-admin.js   # creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD
```

Re-running `seed-admin` is safe — it updates the existing admin's password
rather than creating duplicates. Use it if you ever need to reset the admin
password (change `ADMIN_PASSWORD`, re-run).

## 5. Run / Deploy

The **Run** button and Replit Deployments both use `node server/index.js`
(port 5000). Use **Deploy → Reserved VM** (or Autoscale) for an always-on URL.

## Portals

- Public site: `/`
- Admin portal: `/admin` (log in at `/admin/login`)
- Member area: `/member` (members log in at `/member/login`; they set their
  password from the acceptance email link)

## Manual verification (on Replit, where Postgres persists)

1. On the live site, submit a membership application (the footer newsletter form too).
2. Log into `/admin` → **Applications** → open the new application.
3. **Accept & create login**, choosing a membership level. The applicant gets a
   "set your password" email.
4. Open that email link → set a password → you land on **My Membership** at `/member`.
5. In `/admin/newsletter`, send a broadcast and confirm the subscriber receives it.
6. Check `/admin/partners` for any partner inquiries submitted from the site.

## Local development notes

- With **no `DATABASE_URL`**, the app runs against an in-memory PGlite database
  (`server/db.js`), so data resets on every restart — handy for quick local runs
  and tests, not for anything you want to keep.
- For local persistence, set a real `DATABASE_URL` and `USE_MEMORY_DB=0`.
- Tests: `bun test` (uses the same in-memory PGlite; email is mocked). This repo
  is developed under bun locally but runs on Node 20 in production — the server
  code is runtime-agnostic.
