require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const { render } = require('./lib/render');
const { parentPagesProxy } = require('./proxy');
const { pool, init: initDb, purgeOld } = require('./lib/db');
const { sendVerificationEmail, sendNewsletterVerificationEmail, sendOwnerNotificationEmail, addToMailingList, sendWelcomeEmail } = require('./lib/email');

const app = express();
const PORT = process.env.PORT || 3001;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
// Server-to-server calls to the main app use Railway's private network when available —
// avoids round-tripping through the public edge, which was intermittently dropping
// connections mid-response ("Premature close") under normal traffic.
const INTERNAL_API_URL = (process.env.INTERNAL_API_URL || APP_URL).replace(/\/$/, '');
const APP_NAME = process.env.APP_NAME || 'SpelBel';
const CLUSTER_AFSTAND = 0.003;

// Railway's edge is the one hop in front of us: req.ip is then the real client.
app.set('trust proxy', 1);

// Parent pages — the bell page, settings, manifest, service worker — are rendered by the
// app and relayed from here (src/proxy.js). First, before static files and the staging
// banner: the app adds its own.
if (INTERNAL_API_URL) app.use(parentPagesProxy(INTERNAL_API_URL));
else console.warn('[Site] No INTERNAL_API_URL or APP_URL — the parent pages (/bel, /app, …) will 404 locally.');

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

// What the privacy policy promises about keeping data, done: daily, and once after start-up.
const runPurge = () => purgeOld().catch(err => console.error('[DB] purge failed:', err.message));
setTimeout(runPurge, 30_000);
setInterval(runPurge, 24 * 60 * 60 * 1000).unref();

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
    const [emailUser, emailDomain] = (process.env.CONTACT_EMAIL || '@').split('@');
    res.send(render('privacy.html', { APP_NAME, CONTACT_EMAIL_USER: emailUser, CONTACT_EMAIL_DOMAIN: emailDomain }));
});

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
            pool.query(
                    `SELECT l.naam, l.plaats, l.lat, l.lng,
                            COUNT(s.id) FILTER (WHERE s.verified_at IS NOT NULL) AS aanmeldingen
                     FROM locations l
                     LEFT JOIN signups s ON s.location_id = l.id
                     WHERE l.id = $1
                     GROUP BY l.id`,
                    [location_id]
                )
                .then(({ rows: locs }) => {
                    const loc = locs[0];
                    const plekNaam = loc?.naam || 'onbekende plek';
                    const mapsUrl = loc ? `https://maps.google.com/maps?q=${loc.lat},${loc.lng}` : null;
                    const mapUrl = `https://www.spelbel.nl/wij-willen-een-spelbel`;
                    sendOwnerNotificationEmail({ naam, email, plekNaam, plaats: loc?.plaats, mapsUrl, mapUrl, aanmeldingen: parseInt(loc?.aanmeldingen || 0) });
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

// Newsletter signup from homepage — sends verification email
app.post('/api/newsletter', async (req, res) => {
    const { email } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Ongeldig e-mailadres.' });
    try {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query(
            `INSERT INTO newsletter_tokens (email, token) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [email.toLowerCase(), token]
        );
        const verifyUrl = `${APP_URL}/api/newsletter/verify/${token}`;
        await sendNewsletterVerificationEmail({ email, verifyUrl });
        res.json({ ok: true });
    } catch (err) {
        console.error('[API] /api/newsletter error:', err.message);
        res.status(500).json({ error: 'Aanmelden mislukt.' });
    }
});

// Newsletter verification link
app.get('/api/newsletter/verify/:token', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE newsletter_tokens SET verified_at = now()
             WHERE token = $1 AND verified_at IS NULL RETURNING email`,
            [req.params.token]
        );
        if (rows[0]) {
            await addToMailingList({ email: rows[0].email, naam: '', bron: 'homepage' });
            await sendWelcomeEmail({ naam: '', email: rows[0].email });
        }
        res.redirect('/?nieuwsbrief=bevestigd');
    } catch (err) {
        console.error('[API] /api/newsletter/verify error:', err.message);
        res.redirect('/');
    }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

app.listen(PORT, () => console.log(`[SpelBel Site] Running on port ${PORT}`));
