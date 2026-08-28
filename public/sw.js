// SpelBel service worker.
//
// Scope and filename must stay '/sw.js': changing either silently unsubscribes every
// device that has already registered. Handlers may evolve, as long as an old payload
// (just { title, body }) still renders — pushes sent by an older server must not break.

const FALLBACK_URL = '/app';

self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'SpelBel 🔔';

    event.waitUntil(
        self.registration.showNotification(title, {
            body: data.body || 'De bel gaat!',
            icon: '/images/icon-192.png',
            badge: '/images/badge-96.png',
            vibrate: [200, 100, 200],
            // One tag per bell: a ring at one playground must not replace the notification
            // from another. Older payloads without a tag keep the shared one.
            tag: data.tag || 'spelbel',
            renotify: true,
            data: { url: data.url || FALLBACK_URL },
            actions: [
                { action: 'snooze2h',  title: '⏰ 2 uur' },
                { action: 'snoozeday', title: '🌙 Vandaag' },
            ],
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const url = event.notification.data?.url || FALLBACK_URL;
    const action = event.action;

    event.waitUntil((async () => {
        // Snoozing straight from the notification: the cheapest possible version of the
        // parent dashboard, and the one most people will actually use.
        if (action === 'snooze2h' || action === 'snoozeday') {
            const token = await readToken();
            if (token) {
                const duration = action === 'snoozeday' ? 'day' : '2h';
                try {
                    await fetch(`${await apiBase()}/webhook/push/snooze`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, duration }),
                    });
                    return;   // handled without opening a window
                } catch { /* fall through to opening the dashboard */ }
            }
        }

        // Focus a dashboard that is already open rather than stacking windows.
        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = clientList.find(c => new URL(c.url).pathname.startsWith('/app'));
        if (existing) {
            await existing.focus();
            return existing.navigate(url);
        }
        return clients.openWindow(url);
    })());
});

// The preference token lives in localStorage, which a service worker cannot read, so it is
// mirrored into a cache entry when the page subscribes.
async function readToken() {
    try {
        const cache = await caches.open('spelbel-prefs');
        const res = await cache.match('token');
        return res ? (await res.text()) : null;
    } catch {
        return null;
    }
}

async function apiBase() {
    try {
        const cache = await caches.open('spelbel-prefs');
        const res = await cache.match('api-base');
        if (res) return await res.text();
    } catch { /* fall through */ }
    return self.location.origin;
}
