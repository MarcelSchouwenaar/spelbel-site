require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { render } = require('./lib/render');
const { pool, init: initDb } = require('./lib/db');
const { sendVerificationEmail, sendOwnerNotificationEmail } = require('./lib/email');

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
app.get('/push/settings', (req, res) => {
    res.send(render('push-settings.html', { APP_NAME, APP_URL }));
});

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
        const btns = doorbell.channels.map(c =>
            `<a href="${c.url}" class="btn btn-${c.icon}">${c.label}</a>`
        ).join('');
        const empty = doorbell.channels.length === 0
            ? '<p class="empty">Nog geen kanalen beschikbaar. Probeer het later opnieuw.</p>'
            : '';

        const pushSection = doorbell.vapidPublicKey
            ? buildPushSection(doorbell.id, doorbell.vapidPublicKey, APP_URL)
            : '';

        res.send(render('bell.html', {
            APP_NAME,
            DOORBELL_NAME: doorbell.name,
            LOCATION: loc,
            BUTTONS: btns,
            EMPTY: empty,
            PUSH_SECTION: pushSection,
        }));
    } catch (err) {
        console.error('[Site] /bel/:id error:', err.message, err.cause?.code || err.cause?.message || '');
        res.status(502).send('Kon deurbel niet laden. Probeer het later opnieuw.');
    }
});

function buildPushSection(doorbellId, vapidKey, appUrl) {
    return `
<div id="push-section" style="margin-top:8px">
  <button class="btn btn-push" id="push-btn">🔔 Aanmelden via browsermelding</button>
  <a href="${appUrl}/push/settings" id="push-settings-link" style="display:none;margin-top:8px;font-size:.9rem;color:#4a5568;display:none">⚙️ Meldingsinstellingen →</a>
  <div id="push-status" style="display:none;margin-top:8px;font-size:.9rem"></div>
</div>
<script>
(function() {
  const VAPID_KEY = '${vapidKey}';
  const DOORBELL_ID = '${doorbellId}';
  const SUBSCRIBE_URL = '${appUrl}/webhook/subscribe/push';
  const SETTINGS_URL = '${appUrl}/push/settings';
  const TOKEN_KEY = 'spelbel_push_token';

  function urlBase64ToUint8Array(b) {
    const p = '='.repeat((4 - b.length % 4) % 4);
    const s = (b + p).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from([...atob(s)].map(c => c.charCodeAt(0)));
  }

  function showStatus(msg, color) {
    const el = document.getElementById('push-status');
    el.textContent = msg; el.style.color = color; el.style.display = '';
  }

  async function init() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      document.getElementById('push-btn').style.display = 'none';
      document.getElementById('push-settings-link').style.display = '';
      showStatus('✅ Browsermelding ingeschakeld', '#276749');
    }
  }

  document.getElementById('push-btn').addEventListener('click', async () => {
    const btn = document.getElementById('push-btn');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { showStatus('Toestemming geweigerd.', '#c53030'); return; }
      btn.disabled = true; btn.textContent = 'Bezig…';
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) });
      const r = await fetch(SUBSCRIBE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sub.toJSON(), doorbellId: DOORBELL_ID }) });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      btn.style.display = 'none';
      document.getElementById('push-settings-link').style.display = '';
      showStatus('✅ Je ontvangt nu een melding als de bel gaat!', '#276749');
    } catch (err) {
      btn.disabled = false; btn.textContent = '🔔 Aanmelden via browsermelding';
      showStatus('❌ ' + err.message, '#c53030');
    }
  });

  init();
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
            'UPDATE signups SET verified_at = now() WHERE verify_token = $1 AND verified_at IS NULL RETURNING location_id, naam, email',
            [req.params.token]
        );
        if (rows[0]) {
            const { location_id, naam, email } = rows[0];
            // Send owner notification (fire-and-forget)
            pool.query('SELECT naam FROM locations WHERE id = $1', [location_id])
                .then(({ rows: locs }) => {
                    const plekNaam = locs[0]?.naam || 'onbekende plek';
                    const mapUrl = `https://www.spelbel.nl/wij-willen-een-spelbel`;
                    sendOwnerNotificationEmail({ naam, email, plekNaam, mapUrl });
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
