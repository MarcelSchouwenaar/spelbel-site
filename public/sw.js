self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Spel Bel 🔔';
    const body  = data.body  || 'De bel gaat!';

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon:    '/images/logo.svg',
            badge:   '/images/logo.svg',
            vibrate: [200, 100, 200],
            tag:     'spelbel',
            renotify: true,
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(clients.openWindow('/'));
});
