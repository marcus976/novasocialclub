# The NOVA Social Club — Website

A single-page marketing website for The NOVA Social Club, a professional networking community in Northern Virginia.

## Stack

- Static marketing site: HTML / CSS / Vanilla JS — no build step, no framework
- Backend: Node/Express (`server/`) serving the static site + admin/member portals
- Data: PostgreSQL (Replit Postgres in prod; in-memory PGlite for local/tests)
- Email: Resend
- Served via `node server/index.js` on port 5000

## Running the site

The **Start application** workflow runs `node server/index.js`, which serves both
the marketing site and the backend. It starts automatically. Visit the preview
pane to see it live.

## Backend

The site now has a full backend behind the marketing pages:

- **Public endpoints** — the membership application, partner, and footer
  newsletter forms POST to `/api/apply`, `/api/partner`, `/api/newsletter`.
- **Admin portal** at `/admin` (single admin login): dashboard, review/accept/
  reject applications with membership levels (Founding Member / Member /
  Associate), manage members, send member emails, newsletter broadcast + CSV
  export, and partner inquiries.
- **Member area** at `/member`: accepted members set a password from their
  welcome email and view a "My Membership" page.

Setup, secrets, and deployment steps are in [docs/DEPLOY.md](./docs/DEPLOY.md).
Design and implementation notes are under `docs/superpowers/`.

## Project structure

```
index.html          Main (and only) page
style.css           All styles
main.js             All JavaScript (nav, animations, mobile menu)
photos/             Drop event photos here (see photos/README.txt for filenames)
Logo Suite/PNG/     Logo variants used throughout the page
Fonts/              Garamond and Helvetica font files
Brand Board Sheet.png   Full brand reference
```

## Adding photos

The site references 5 photos that are not yet in the repo. Drop them into the `photos/` folder with these exact filenames:

| File | Scene |
|---|---|
| `nova-01.jpg` | Rachad in cream sweater, laughing at BHM Tech Connect |
| `nova-02.jpg` | Check-in table with wristbands and branded signage |
| `nova-03.jpg` | Bar/restaurant crowd (hero background + gallery) |
| `nova-04.jpg` | Shift Happens panel discussion |
| `nova-05.jpg` | Evening cocktail table, man in pink jacket |

See `photos/README.txt` for full specs.

## User preferences

- Keep the existing HTML/CSS/JS structure — no framework migration.
