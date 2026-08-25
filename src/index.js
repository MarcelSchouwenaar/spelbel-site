require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { render } = require('./lib/render');
const { pool, init: initDb } = require('./lib/db');
const { sendVerificationEmail, sendOwnerNotificationEmail, addToMailingList, sendWelcomeEmail } = require('./lib/email');

const app = express();
const PORT = process.env.PORT || 3001;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
// Server-to-server calls to the main app use Railway's private network when available —
// avoids round-tripping through the public edge, which was intermittently dropping
// connections mid-response ("Premature close") under normal traffic.
const INTERNAL_API_URL = (process.env.INTERNAL_API_URL || APP_URL).replace(/\/$/, '');
const APP_NAME = process.env.APP_NAME || 'SpelBel';
const CLUSTER_AFSTAND = 0.003;

app.use(express.json());

// ── Staging ──────────────────────────────────────────────
// Never index staging, and make it obvious which environment a page came from.
const IS_STAGING = process.env.STAGING === 'true';
if (IS_STAGING) {
    app.use((_req, res, next) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        next();
    });
    app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

    // Inject an amber bar into every HTML response, mirroring the main app's staging banner.
    const BANNER = '<div style="position:sticky;top:0;z-index:9999;background:#F6AD55;color:#1A1A1A;'
        + 'font:600 14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 16px;text-align:center">'
        + '\u26A0\uFE0F STAGING \u2014 testomgeving, geen echte meldingen</div>';
    app.use((_req, res, next) => {
        const send = res.send.bind(res);
        res.send = (body) => {
            if (typeof body === 'string' && body.includes('<body')) {
                body = body.replace(/(<body[^>]*>)/i, `$1${BANNER}`);
            }
            return send(body);
        };
        next();
    });
}

app.use(express.static(path.join(__dirname, '..', 'public')));

initDb().catch(err => console.error('[DB] init failed:', err.message));

// Homepage
app.get('/', (req, res) => {
    const [emailUser, emailDomain] = (process.env.CONTACT_EMAIL || '@').split('@');
    res.send(render('home.html', {
        APP_NAME,
        CONTACT_EMAIL_USER:   emailUser,
        CONTACT_EMAIL_DOMAIN: emailDomain,
    }));
});

// Wij willen een SpelBel (signup map page)
app.get('/wij-willen-een-spelbel', (req, res) => {
    res.send(render('wij-willen-een-spelbel.html', { APP_NAME }));
});

// Thank you page
app.get('/thankyou', (req, res) => {
    res.send(render('thankyou.html', { APP_NAME }));
});

// Privacy policy
app.get('/privacy', (req, res) => {
    res.send(render('privacy.html', { APP_NAME }));
});

// Push settings
// Per-bell manifest. iOS gives an installed web app its own storage jar, so anything the
// bell page put in localStorage is invisible once the app is on the home screen — which is
// exactly the moment we need to know which bell the parent came for. Baking the bell into
// start_url is the one channel that survives installation.
app.get('/manifest.webmanifest', (req, res) => {
    const bell = typeof req.query.bell === 'string'
        ? req.query.bell.replace(/[^a-z0-9-]/gi, '').slice(0, 64)
        : '';
    res.type('application/manifest+json').json({
        name: 'SpelBel',
        short_name: 'SpelBel',
        description: 'Krijg een melding als de bel gaat bij de speeltuin',
        lang: 'nl',
        start_url: bell ? `/app?bell=${encodeURIComponent(bell)}` : '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ABE4FF',
        theme_color: '#EE7533',
        icons: [
            { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    });
});

// The PWA's start_url. Plan 07 turns this into the full parent dashboard; for now it
// serves the settings page, which also handles first-time subscribing.
function renderApp(_req, res) {
    res.send(render('push-settings.html', {
        APP_NAME,
        APP_URL,
        VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
    }));
}

app.get('/app', renderApp);
app.get('/push/settings', renderApp);   // old links, still in notifications people kept

// Push demo
app.get('/push-demo', (req, res) => {
    const vapidKey = process.env.VAPID_PUBLIC_KEY;
    if (!vapidKey) return res.status(503).send('Web push is not configured (VAPID_PUBLIC_KEY missing).');
    res.send(render('push-demo.html', { APP_NAME, APP_URL, VAPID_PUBLIC_KEY: vapidKey }));
});

// Doorbell subscription page — fetches data from main app API
app.get('/bel/:id', async (req, res) => {
    try {
        const apiRes = await fetch(`${INTERNAL_API_URL}/webhook/api/public/doorbells/${req.params.id}`);
        if (!apiRes.ok) {
            return res.status(404).send(render('404.html', { APP_NAME }).replace(/{{.*?}}/g, ''));
        }
        const doorbell = await apiRes.json();

        const loc = doorbell.location ? `<p class="location">📍 ${doorbell.location}</p>` : '';

        // Chat channels move behind a disclosure: every WhatsApp notification costs money
        // and browser notifications do not, so push is the default and this is the fallback.
        const btns = doorbell.channels.map(c =>
            `<a href="${c.url}" class="btn btn-${c.icon}">${c.label}</a>`
        ).join('');
        const otherChannels = doorbell.channels.length
            ? `<details class="other-channels">
                 <summary>Liever via WhatsApp, Telegram of Signal?</summary>
                 <p class="other-channels-note">Werkt ook, maar je krijgt de melding in een chat en wij betalen per bericht. Browsermeldingen zijn gratis en sneller.</p>
                 ${btns}
               </details>`
            : '';
        const empty = doorbell.channels.length === 0 && !doorbell.vapidPublicKey
            ? '<p class="empty">Nog geen kanalen beschikbaar. Probeer het later opnieuw.</p>'
            : '';

        const pushSection = doorbell.vapidPublicKey
            ? buildPushSection(doorbell.id, doorbell.vapidPublicKey, APP_URL, doorbell.name)
            : '';

        res.send(render('bell.html', {
            APP_NAME,
            MANIFEST_HREF: `/manifest.webmanifest?bell=${encodeURIComponent(doorbell.slug || doorbell.id)}`,
            DOORBELL_NAME: doorbell.name,
            LOCATION: loc,
            OTHER_CHANNELS: otherChannels,
            EMPTY: empty,
            PUSH_SECTION: pushSection,
        }));
    } catch (err) {
        console.error('[Site] /bel/:id error:', err.message, err.cause?.code || err.cause?.message || '');
        res.status(502).send('Kon deurbel niet laden. Probeer het later opnieuw.');
    }
});

function buildPushSection(doorbellId, vapidKey, appUrl, doorbellName) {
    return `
<div id="push-section">
  <button class="btn btn-push" id="push-btn">🔔 Meldingen op mijn telefoon</button>
  <p class="push-why">Gratis en direct. Je stelt zelf in wanneer je ze krijgt.</p>

  <div id="ios-guide" style="display:none">
    <p class="ios-intro"><strong>Nog één stap.</strong> Op de iPhone werken meldingen alleen als je SpelBel op je beginscherm zet:</p>
    <ol class="ios-steps">
      <li>Tik op <strong>Deel</strong> <span class="ios-icon">⬆️</span> onderin je scherm</li>
      <li>Kies <strong>Zet op beginscherm</strong></li>
      <li>Open SpelBel vanaf je beginscherm en zet meldingen aan</li>
    </ol>
  </div>

  <div id="push-status" style="display:none"></div>
  <a href="${appUrl}/app" id="push-settings-link" style="display:none">⚙️ Meldingsinstellingen →</a>
</div>
<script>
(function() {
  const VAPID_KEY = '${vapidKey}';
  const DOORBELL_ID = '${doorbellId}';
  const DOORBELL_NAME = ${JSON.stringify(doorbellName || '')};
  const API_BASE = '${appUrl}';
  const SUBSCRIBE_URL = API_BASE + '/webhook/subscribe/push';
  const TOKEN_KEY = 'spelbel_push_token';

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const $ = id => document.getElementById(id);
  let installPrompt = null;   // Android/Chrome only

  const platform = isIOS ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop';
  function track(event) {
    // Fire and forget; a counter must never delay or break the flow.
    try {
      const body = JSON.stringify({ event, doorbellId: DOORBELL_ID, platform, standalone: isStandalone });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_BASE + '/webhook/metrics/pwa', new Blob([body], { type: 'application/json' }));
      } else {
        fetch(API_BASE + '/webhook/metrics/pwa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  function status(msg, kind) {
    const el = $('push-status');
    el.textContent = msg;
    el.className = kind || '';
    el.style.display = '';
  }

  // The service worker cannot read localStorage, so mirror what it needs into a cache.
  async function shareWithWorker(token) {
    try {
      const cache = await caches.open('spelbel-prefs');
      await cache.put('token', new Response(token));
      await cache.put('api-base', new Response(API_BASE));
    } catch { /* not fatal: the worker falls back to opening the dashboard */ }
  }

  async function subscribe() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      track('permission_denied');
      status('Je hebt meldingen geweigerd. Zet ze aan via de instellingen van je browser.', 'err');
      return;
    }
    track('permission_granted');
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    });
    const r = await fetch(SUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub.toJSON(), doorbellId: DOORBELL_ID }),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      await shareWithWorker(data.token);
    }
    track('subscribed');
    $('push-btn').style.display = 'none';
    $('ios-guide').style.display = 'none';
    $('push-settings-link').style.display = 'block';
    status('✅ Gelukt! Je krijgt een melding als de bel gaat bij ' + DOORBELL_NAME + '.', 'ok');
  }

  function urlBase64ToUint8Array(b) {
    const p = '='.repeat((4 - b.length % 4) % 4);
    const s = (b + p).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from([...atob(s)].map(c => c.charCodeAt(0)));
  }

  // Android/Chrome offers a real install prompt; iOS never does.
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

  $('push-btn').addEventListener('click', async () => {
    const btn = $('push-btn');
    try {
      // On iOS, requestPermission() only works from a home-screen app, so installing
      // has to come first — asking here would fail silently and look broken.
      if (isIOS && !isStandalone) {
        track('install_guide');
        $('ios-guide').style.display = 'block';
        btn.style.display = 'none';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Bezig…';
      if (installPrompt) {
        track('install_prompt');
        installPrompt.prompt();
        await installPrompt.userChoice;   // either way, carry on and subscribe
        installPrompt = null;
      }
      await subscribe();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '🔔 Meldingen op mijn telefoon';
      status('❌ ' + (err.message || 'Er ging iets mis'), 'err');
    }
  });

  (async function init() {
    track('bell_view');
    if (!supported) {
      $('push-btn').style.display = 'none';
      status('Deze browser ondersteunt geen meldingen. Kies hieronder een ander kanaal.', 'err');
      return;
    }
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    const existing = reg ? await reg.pushManager.getSubscription() : null;
    if (existing) {
      $('push-btn').style.display = 'none';
      $('push-settings-link').style.display = 'block';
      status('✅ Je krijgt al meldingen op dit apparaat.', 'ok');
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) shareWithWorker(token);
    }
  })();
})();
</script>`;
}

// Wij willen een SpelBel — list locations with verified signups
app.get('/api/locations', async (req, res) => {
    try {
        const { rows: locations } = await pool.query('SELECT id, naam, plaats, lat, lng FROM locations ORDER BY id');
        const { rows: signups } = await pool.query(
            `SELECT location_id, naam, openbaar, verified_at AS tijd
             FROM signups WHERE verified_at IS NOT NULL ORDER BY verified_at DESC`
        );
        const byLocation = {};
        signups.forEach(s => {
            if (!byLocation[s.location_id]) byLocation[s.location_id] = [];
            byLocation[s.location_id].push({
                naam: s.openbaar ? s.naam : 'Anoniem',
                openbaar: s.openbaar,
                tijd: new Date(s.tijd).getTime(),
            });
        });
        const result = locations
            .map(loc => ({ ...loc, mensen: byLocation[loc.id] || [] }))
            .filter(loc => loc.mensen.length > 0);
        res.json(result);
    } catch (err) {
        console.error('[API] /api/locations error:', err.message);
        res.status(500).json({ error: 'Kon locaties niet laden.' });
    }
});

// Wij willen een SpelBel — new signup, triggers verification email
app.post('/api/signups', async (req, res) => {
    try {
        const { naam, email, lat, lng, locationId, plekNaam, openbaar, nieuwsbrief } = req.body || {};
        if (!naam || !email || !email.includes('@')) {
            return res.status(400).json({ error: 'Vul een naam en geldig e-mailadres in.' });
        }
        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return res.status(400).json({ error: 'Kies eerst een locatie op de kaart.' });
        }

        let location;
        if (locationId) {
            const { rows } = await pool.query('SELECT * FROM locations WHERE id = $1', [locationId]);
            location = rows[0];
        }
        if (!location) {
            const { rows } = await pool.query(
                `SELECT * FROM locations WHERE ABS(lat - $1) < $3 AND ABS(lng - $2) < $3 LIMIT 1`,
                [lat, lng, CLUSTER_AFSTAND]
            );
            location = rows[0];
        }
        if (!location) {
            const { rows } = await pool.query(
                'INSERT INTO locations (naam, plaats, lat, lng) VALUES ($1, $2, $3, $4) RETURNING *',
                [plekNaam || 'Nieuwe speelplek', '', lat, lng]
            );
            location = rows[0];
        }

        const existing = await pool.query(
            'SELECT * FROM signups WHERE location_id = $1 AND email = $2',
            [location.id, email]
        );
        if (existing.rows[0] && existing.rows[0].verified_at) {
            return res.status(409).json({ error: 'Dit e-mailadres is al bevestigd voor deze speelplek.' });
        }

        const verifyToken = crypto.randomBytes(24).toString('hex');
        if (existing.rows[0]) {
            await pool.query(
                'UPDATE signups SET naam = $1, openbaar = $2, nieuwsbrief = $3, verify_token = $4 WHERE id = $5',
                [naam, openbaar !== false, nieuwsbrief !== false, verifyToken, existing.rows[0].id]
            );
        } else {
            await pool.query(
                `INSERT INTO signups (location_id, naam, email, openbaar, nieuwsbrief, verify_token)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [location.id, naam, email, openbaar !== false, nieuwsbrief !== false, verifyToken]
            );
        }

        const verifyUrl = `${req.protocol}://${req.get('host')}/api/verify/${verifyToken}`;
        await sendVerificationEmail({ to: email, naam, plekNaam: location.naam, verifyUrl });

        res.json({ pending: true, locationId: location.id });
    } catch (err) {
        console.error('[API] /api/signups error:', err.message);
        res.status(500).json({ error: 'Aanmelden is niet gelukt. Probeer het later opnieuw.' });
    }
});

// Wij willen een SpelBel — email verification link
app.get('/api/verify/:token', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'UPDATE signups SET verified_at = now() WHERE verify_token = $1 AND verified_at IS NULL RETURNING location_id, naam, email, nieuwsbrief',
            [req.params.token]
        );
        if (rows[0]) {
            const { location_id, naam, email, nieuwsbrief } = rows[0];
            if (nieuwsbrief) {
                addToMailingList({ email, naam }).catch(() => {});
                sendWelcomeEmail({ naam, email }).catch(() => {});
            }
            // Send owner notification (fire-and-forget)
            pool.query('SELECT naam, plaats, lat, lng FROM locations WHERE id = $1', [location_id])
                .then(({ rows: locs }) => {
                    const loc = locs[0];
                    const plekNaam = loc?.naam || 'onbekende plek';
                    const mapsUrl = loc ? `https://maps.google.com/maps?q=${loc.lat},${loc.lng}` : null;
                    const mapUrl = `https://www.spelbel.nl/wij-willen-een-spelbel`;
                    sendOwnerNotificationEmail({ naam, email, plekNaam, plaats: loc?.plaats, mapsUrl, mapUrl });
                })
                .catch(() => {});
            return res.redirect(`/wij-willen-een-spelbel?bevestigd=1&locatie=${location_id}`);
        }
        res.redirect('/wij-willen-een-spelbel?bevestigd=0');
    } catch (err) {
        console.error('[API] /api/verify error:', err.message);
        res.redirect('/wij-willen-een-spelbel?bevestigd=0');
    }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

app.listen(PORT, () => console.log(`[SpelBel Site] Running on port ${PORT}`));
