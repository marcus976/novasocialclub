# The NOVA Social Club — Website

A single-page marketing website for The NOVA Social Club, a professional networking community in Northern Virginia.

## Stack

- Pure static HTML / CSS / Vanilla JS — no build step, no framework
- Served via `npx serve` on port 5000

## Running the site

The **Start application** workflow serves the site. It starts automatically. Visit the preview pane to see it live.

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
