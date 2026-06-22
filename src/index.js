require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { render } = require('./lib/render');

const app = express();
const PORT = process.env.PORT || 3001;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const APP_NAME = process.env.APP_NAME || 'Spelbel';

app.use(express.static(path.join(__dirname, '..', 'public')));

// Homepage
app.get('/', (req, res) => {
    const [emailUser, emailDomain] = (process.env.CONTACT_EMAIL || '@').split('@');
    res.send(render('home.html', {
        APP_NAME,
        CONTACT_EMAIL_USER:   emailUser,
        CONTACT_EMAIL_DOMAIN: emailDomain,
    }));
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
        const apiRes = await fetch(`${APP_URL}/webhook/api/public/doorbells/${req.params.id}`);
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
        console.error('[Site] /bel/:id error:', err.message);
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

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

app.listen(PORT, () => console.log(`[Spelbel Site] Running on port ${PORT}`));
