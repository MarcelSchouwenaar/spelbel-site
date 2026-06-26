# Spel Bel Site — Claude Instructions

Public website for Spel Bel, served at www.spelbel.nl. Separate from the main app (app.spelbel.nl).

## Stack

- Plain Express server (`src/index.js`) — no framework, no build step
- Templates: `src/templates/*.html` with `{{VARIABLE}}` string replacement via `src/lib/render.js`
- Static assets: `public/css/`, `public/images/`, `public/fonts/`
- Deployed on Railway — push to `main` triggers auto-deploy

## Key rules

- **No build step.** CSS and HTML are served directly. Do not introduce Webpack, Vite, Tailwind, or any preprocessor.
- **No new dependencies** without a good reason. Current deps: `express`, `node-fetch`, `dotenv`, `pg` (Postgres client, used by the "Wij willen een Spelbel" signup feature).
- **Template variables** use `{{VAR}}` syntax. Do not use a different templating system. Variables are injected in `src/index.js` per route.
- **Do not modify `public/sw.js`** — the service worker is shared with existing push subscribers. Breaking it unsubscribes users silently.
- **Do not modify `src/lib/render.js`** — it is intentionally identical to the main app's render helper.
- Content edits (copy, images, CSS) go in `src/templates/` and `public/` — no server changes needed.

## Deploying

Push to `main`. Railway deploys automatically.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Main app base URL (`https://app.spelbel.nl`) — used for push API calls |
| `APP_NAME` | Display name injected into all templates |
| `CONTACT_EMAIL` | Contact email shown on homepage |
| `VAPID_PUBLIC_KEY` | Web push public key — same value as main app |
| `DATABASE_URL` | Postgres connection string (Railway Postgres plugin) — used by `/api/locations`, `/api/signups`, `/api/verify/:token` |
| `BREVO_API_KEY` | Brevo (Sendinblue) transactional email API key — sends signup verification mail |
| `SENDER_EMAIL` | From-address used for verification emails |

## How `/bel/:id` works

The doorbell page fetches live data from `${APP_URL}/webhook/api/public/doorbells/:id` at request time. Doorbell names, locations, and subscription channel links come from the main app — nothing is hardcoded here.

## How `/wij-willen-een-spelbel` works

Map-based signup page (`src/templates/wij-willen-een-spelbel.html`) backed by three API routes in `src/index.js`:
- `GET /api/locations` — returns locations that have at least one **verified** signup, with an anonymized `mensen` list
- `POST /api/signups` — creates/updates a location + a pending signup, sends a Brevo verification email with a link to `/api/verify/:token`
- `GET /api/verify/:token` — marks a signup verified, redirects back to the page with `?bevestigd=1&locatie=ID`

`src/lib/db.js` holds the Postgres pool and creates the `locations`/`signups` tables on boot if they don't exist. `src/lib/email.js` sends the verification email via Brevo's HTTP API (no SMTP library needed — uses `node-fetch`).
