# The NOVA Social Club — Admin Backend & Member Portal

**Date:** 2026-07-24
**Status:** Approved design, ready for implementation planning
**Author:** Ahmad (Bridge Systems LLC) + Claude

## Summary

Add a real backend to the existing static NOVA Social Club marketing site. The
backend captures membership applications and newsletter signups, and provides a
single-admin portal to review applications, accept them at a chosen membership
level, create member logins, send emails, and manage newsletter subscribers.
Accepted members get a minimal logged-in "My Membership" page.

The existing static marketing site keeps its exact look and behavior; its forms
are wired to real endpoints instead of `localStorage`.

## Goals

- Persist membership applications, members, newsletter subscribers, and partner
  inquiries in a real database.
- Single-admin portal: view/accept/reject applications, assign membership level,
  manage members, send emails, manage + broadcast to newsletter subscribers.
- "Create their login": on acceptance, generate member credentials and email a
  set-password link; member can log into a minimal My Membership page.
- Send transactional and broadcast email via Resend.

## Non-Goals (deferred to later phases)

- Rich member area (events RSVP, member directory, discount redemption).
- Multi-admin accounts, roles, and in-portal admin invites.
- Third-party email-marketing platform sync (Mailchimp, etc.).
- Any framework migration of the existing static site.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Hosting | Replit — Node/Express server, Replit PostgreSQL, Replit Secrets, Replit Deployment |
| UI approach | Approach A: server-rendered EJS admin/member portals, vanilla stack, no build step |
| Email | Resend, with a verified sending domain |
| Membership tiers | Founding Member › Member › Associate (fixed, renamable later) |
| Admin auth | Single admin account, seeded from Secrets |
| Newsletter | Footer signup → DB → admin broadcast via Resend, with unsubscribe |
| Member login | Admin-portal-first; minimal "My Membership" page for accepted members |

## Architecture

One Express server serves the existing static site, the public form endpoints,
and the server-rendered admin + member portals. No build step.

```
novasocialclub/
├── index.html, style.css, main.js, photos/, ...   ← existing site (look unchanged)
├── server/
│   ├── index.js            ← Express app entry (serves static + mounts routes)
│   ├── db.js               ← Postgres pool + query helper
│   ├── migrate.js          ← creates tables (run once / on deploy)
│   ├── seed-admin.js       ← creates the single admin from Secrets
│   ├── email.js            ← Resend wrapper (send + templates + email_log)
│   ├── auth.js             ← session middleware, login/logout, bcrypt, guards
│   ├── validate.js         ← server-side input validation/sanitization helpers
│   ├── routes/
│   │   ├── public.js       ← POST /api/apply, /api/newsletter, /api/partner, GET /unsubscribe
│   │   ├── admin.js        ← /admin/* (login-gated portal pages + actions)
│   │   └── member.js       ← /member/* (login-gated My Membership)
│   └── views/              ← EJS templates (admin pages, member pages, emails)
├── test/                   ← backend tests (email mocked)
├── package.json            ← express, pg, bcrypt, express-session, connect-pg-simple, resend, ejs, express-rate-limit
└── .replit                 ← run command → node server/index.js
```

- **Data:** Replit PostgreSQL via `pg`.
- **Sessions:** `express-session` + `connect-pg-simple` (stored in Postgres so
  logins survive restarts). Signed, httpOnly cookies; `Secure` in production.
- **Secrets (Replit Secrets, never committed):** `DATABASE_URL`,
  `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_FROM` (e.g.
  `hello@thenovasocialclub.com`), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seed only),
  `APP_BASE_URL`.

## Data Model (PostgreSQL)

```
applications
  id, first_name, last_name, email, phone, company, profession, linkedin,
  area, why,
  status ('pending' | 'accepted' | 'rejected'),
  membership_level (NULL | 'founding' | 'member' | 'associate'),
  admin_notes, created_at, reviewed_at

members                         ← created when an application is accepted
  id, application_id, first_name, last_name, email, phone, company, linkedin,
  membership_level, status ('active' | 'inactive'),
  password_hash (NULL until set),
  set_password_token, token_expires_at,
  created_at

newsletter_subscribers
  id, email, status ('subscribed' | 'unsubscribed'),
  unsubscribe_token, created_at, unsubscribed_at

partner_inquiries
  id, business, contact_name, email, message, created_at

admins
  id, email, password_hash, created_at

email_log                       ← audit trail of every email sent
  id, to_email, subject, type, member_id (nullable), sent_at, status

session                         ← managed by connect-pg-simple
```

Relationships: an accepted **application** spawns a **member** carrying the chosen
`membership_level` and contact fields. **newsletter_subscribers** and
**partner_inquiries** are independent. **email_log** records every send.

## Public Site Changes (look unchanged)

1. **Application form** (`#apply-form`): add Phone, Company, LinkedIn fields;
   switch JS from `localStorage` to `POST /api/apply`; keep the exact success
   animation. Server validates + stores a `pending` application, emails the
   applicant a confirmation, and emails the admin a notification.
2. **Newsletter form:** new email-only signup in the footer, styled to match.
   `POST /api/newsletter` stores the subscriber and emails a confirmation with an
   unsubscribe link.
3. **Partner form** (`#partner-form`): wire to `POST /api/partner` and store as a
   `partner_inquiries` row; admin views these read-only.
4. **`GET /unsubscribe?token=…`:** public page flipping a subscriber to
   `unsubscribed`.
5. **Anti-spam:** honeypot field on all public forms; server-side validation.

## Admin Portal (`/admin`, single login)

- **Login** (`/admin/login`): email + password, rate-limited, generic errors.
- **Dashboard:** counts (pending applications, total members, subscribers) +
  recent activity.
- **Applications:** table filterable by status; detail view of all fields + notes.
  Actions: **Accept** (choose Founding / Member / Associate → creates member +
  emails set-password link), **Reject** (optional templated email), add private
  notes.
- **Members:** searchable list; view/edit, change level, deactivate, resend
  set-password link.
- **Newsletter:** subscriber list, CSV export, **Compose Broadcast** (subject +
  body) sent to all subscribed addresses via Resend with unsubscribe links,
  logged.
- **Member email:** from a member's detail page, compose a one-off email sent via
  Resend and logged.
- **Partner inquiries:** read-only list.

## Member Area (`/member`, minimal)

- **Set password** (`/member/set-password?token=…`): from the acceptance email;
  member sets a password (token single-use, expires 7 days).
- **Login** (`/member/login`) + **My Membership** page: name, membership level,
  status, and the member perks list. (Events, directory, discounts deferred.)

## Email Flows (Resend, all logged)

| Trigger | To | Email |
|---|---|---|
| New application submitted | Applicant | "Application received" confirmation |
| New application submitted | Admin | "New application from {name}" notification |
| Application accepted | Member | "Welcome — set your password" (tokened link) |
| Application rejected | Applicant | Optional, templated, admin-triggered |
| Newsletter signup | Subscriber | Confirmation + unsubscribe link |
| Admin broadcast | All subscribers | Custom subject/body + unsubscribe link |
| Admin one-off | A member | Custom subject/body |

Sending domain verified in Resend; `from` = `RESEND_FROM`. If the domain is not
yet verified, the app logs a clear warning and continues (no crash) so setup can
proceed.

## Auth & Security

- Passwords hashed with **bcrypt**; never stored/logged in plaintext.
- Signed httpOnly session cookies, `Secure` in production, stored in Postgres.
- Login endpoints rate-limited; generic errors (no user enumeration).
- Set-password tokens random, single-use, expiring.
- `/admin/*` and `/member/*` behind auth middleware; admin and member sessions
  are separate.
- Server-side validation + sanitization; parameterized SQL; CSRF protection on
  state-changing POSTs; honeypot on public forms.

## Testing & Rollout

- **Automated backend tests (email mocked):** application submission + validation,
  accept → member creation, set-password/token flow, auth gating, newsletter
  subscribe/unsubscribe.
- **Manual verification on Replit:** submit application → accept → receive email →
  set password → log into member page → send a broadcast.
- **Migrations:** `node server/migrate.js`; admin seeded via
  `node server/seed-admin.js` from Secrets.
- **Rollout:** feature branch `feat/admin-backend`, reviewed, merged; static site
  stays functional throughout.

## Setup Prerequisites (operator tasks, outside code)

1. Enable Replit PostgreSQL (provides `DATABASE_URL`).
2. Create a Resend account, verify the sending domain, set `RESEND_API_KEY` +
   `RESEND_FROM`.
3. Set all Secrets listed above in Replit.
4. Run migrate + seed-admin once.
