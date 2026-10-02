// The parent pages — the bell page behind the QR code, settings, the PWA manifest and the
// service worker — are rendered by the app service and relayed from here, so they stay on
// www: push subscriptions, the service worker and the printed QR codes all depend on the
// origin. See playbell/docs/11-parent-pages-behind-www.md.
//
// Changes to this file need review from the app team (CODEOWNERS): a broken rule here
// silently stops notifications for every parent.
const http = require('http');
const https = require('https');

const PARENT_ROUTES = [
    /^\/bel\/[^/]+$/,
    /^\/app$/,
    /^\/push\/settings$/,
    /^\/push-demo$/,
    /^\/manifest\.webmanifest$/,
    /^\/sw\.js$/,
    /^\/app-assets\//,
];

const isParentRoute = (p) => PARENT_ROUTES.some((r) => r.test(p));

// Hop-by-hop headers describe one connection and must not be forwarded (RFC 9110 §7.6.1).
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

function parentPagesProxy(target) {
    const base = new URL(target);
    const client = base.protocol === 'https:' ? https : http;

    return (req, res, next) => {
        if (!isParentRoute(req.path) || !['GET', 'HEAD'].includes(req.method)) return next();

        const headers = { ...req.headers };
        for (const h of HOP_BY_HOP) delete headers[h];
        Object.assign(headers, {
            host: base.host,
            'x-forwarded-host': req.get('host'),
            'x-forwarded-proto': req.protocol,
            'x-spelbel-proxy': '1',   // the app renders only what came through here; direct visits go to www
            // Overwrite, never append: the app trusts exactly one hop (us), and an appended
            // chain would hand it Railway's edge address — every parent in one rate-limit bucket.
            'x-forwarded-for': req.ip,
        });

        const upstream = client.request(new URL(req.originalUrl, base), { method: req.method, headers }, (up) => {
            for (const h of HOP_BY_HOP) delete up.headers[h];
            res.writeHead(up.statusCode, up.headers);
            up.pipe(res);
        });
        upstream.setTimeout(10000, () => upstream.destroy(new Error('upstream timeout')));
        upstream.on('error', (err) => {
            console.error('[Proxy]', req.path, err.message);
            if (!res.headersSent) res.status(502).send('Kon pagina niet laden. Probeer het later opnieuw.');
            else res.destroy();
        });
        upstream.end();
    };
}

module.exports = { parentPagesProxy, isParentRoute };
