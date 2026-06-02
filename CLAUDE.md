# Spel Bel Site — Claude Instructions

Public website for Spel Bel, served at www.spelbel.nl. Separate from the main app (app.spelbel.nl).

## Stack

- Plain Express server (`src/index.js`) — no framework, no build step
- Templates: `src/templates/*.html` with `{{VARIABLE}}` string replacement via `src/lib/render.js`
- Static assets: `public/css/`, `public/images/`, `public/fonts/`
- Deployed on Railway — push to `main` triggers auto-deploy

## Key rules

- **No build step.** CSS and HTML are served directly. Do not introduce Webpack, Vite, Tailwind, or any preprocessor.
- **No new dependencies** without a good reason. The only deps are `express`, `node-fetch`, and `dotenv`.
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

## How `/bel/:id` works

The doorbell page fetches live data from `${APP_URL}/webhook/api/public/doorbells/:id` at request time. Doorbell names, locations, and subscription channel links come from the main app — nothing is hardcoded here.
