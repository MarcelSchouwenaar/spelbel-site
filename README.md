# Spel Bel — Website

This repository contains the public website for **Spel Bel**, served at [www.spelbel.nl](https://www.spelbel.nl).

It is a separate service from the main Spel Bel application (which runs at `app.spelbel.nl` and handles admin, webhooks, and notifications). Changes to this repo do **not** affect the notification system — you can edit and deploy freely.

---

## Architecture in one line

```
www.spelbel.nl  →  this repo   (public site, static-ish pages)
app.spelbel.nl  →  playbell    (admin panel, webhooks, notifications)
```

The bell subscription page (`/bel/:id`) fetches live doorbell info from `app.spelbel.nl` at request time, so doorbell names and subscription channels are always up to date without any changes here.

---

## What lives where

| Path | File | What it does |
|------|------|-------------|
| `/` | `src/templates/home.html` | Homepage — intro, CTA, how-it-works |
| `/privacy` | `src/templates/privacy.html` | Privacy policy |
| `/bel/:id` | `src/templates/bell.html` | Doorbell subscription page (fetches live data) |
| `/push/settings` | `src/templates/push-settings.html` | Web push notification settings |
| `/push-demo` | `src/templates/push-demo.html` | Web push demo page |

CSS lives in `public/css/app.css`. Images live in `public/images/`.

---

## Making content changes

### Text and copy

Edit the HTML files in `src/templates/`. They use a simple `{{VARIABLE}}` placeholder system — don't remove those, they get filled in at runtime. Everything else is plain HTML.

### Images

Drop new images into `public/images/` and reference them in the templates as `/images/your-file.png`.

### Styling

Edit `public/css/app.css` directly. There is no build step — what you write is what gets served.

---

## Deploying

This repo is connected to Railway and **deploys automatically on every push to `main`**.

```
git add .
git commit -m "Update homepage copy"
git push
```

Railway picks up the push and redeploys within a minute or two. You can watch the deploy in the Railway dashboard.

---

## Running locally

```bash
npm install
cp .env.example .env   # fill in APP_URL at minimum
npm start
```

The site runs on [http://localhost:3001](http://localhost:3001).

The only env var you need locally is `APP_URL` — set it to `https://app.spelbel.nl` (or your local app if you're running both).

---

## Environment variables (Railway)

These are set in the Railway service and do not need to change often:

| Variable | Value |
|----------|-------|
| `APP_NAME` | `Spel Bel` |
| `APP_URL` | `https://app.spelbel.nl` |
| `CONTACT_EMAIL` | contact email shown on the homepage |
| `VAPID_PUBLIC_KEY` | web push key — same value as the main app |

---

## What not to touch

- `src/index.js` — the Express server. Routes, API calls, push logic all live here. Changes here require testing.
- `src/lib/render.js` — the template engine. Leave as-is.
- `public/sw.js` — the service worker for web push. Changing this can break push notifications for existing subscribers.
- `public/fonts/` — licensed font files.

---

## Background

Spel Bel is a neighbourhood doorbell system built by [ScrollScrollScroll](https://www.scrollscrollscroll.nl). A physical button is installed at a playground. When a child presses it, parents in the neighbourhood receive a WhatsApp, Telegram, Signal, or browser notification — so they know it's time to go outside and play.

This website is the public face of the project: it explains what Spel Bel is, lets visitors subscribe to a specific doorbell, and handles push notification preferences.
