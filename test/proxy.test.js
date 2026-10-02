/**
 * The parent pages are relayed to the app service (src/proxy.js). Two things must hold:
 * exactly the right paths go to the app — a rule too broad steals a marketing page, one too
 * narrow breaks the bell page — and the app learns who the real client is.
 *
 * Run with: npm test   (node:test, no dependencies)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { parentPagesProxy, isParentRoute } = require('../src/proxy');

test('routes exactly the parent paths to the app', () => {
    const forwarded = ['/bel/abc', '/bel/12', '/app', '/push/settings',
        '/manifest.webmanifest', '/sw.js', '/app-assets/css/parent.css', '/app-assets/images/logo.svg'];
    const kept = ['/', '/privacy', '/push-demo', '/thankyou', '/wij-willen-een-spelbel', '/api/signups',
        '/bel', '/bel/', '/bel/abc/extra', '/apple', '/app/', '/application', '/sw.js.map',
        '/push', '/push/settings/x', '/css/app.css', '/images/logo.svg', '/app-assets'];
    for (const p of forwarded) assert.ok(isParentRoute(p), `${p} should go to the app`);
    for (const p of kept) assert.ok(!isParentRoute(p), `${p} should stay on the site`);
});

// A stub app that echoes what it received.
function upstream() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-From', 'app');
            res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers }));
        }).listen(0, () => resolve(server));
    });
}

function site(target) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(parentPagesProxy(target));
    app.use((_req, res) => res.status(200).send('site'));
    return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

const url = (server, p) => `http://localhost:${server.address().port}${p}`;

test('forwards a parent page with the real client and the www host', async (t) => {
    const app = await upstream();
    const www = await site(url(app, ''));
    t.after(() => { app.close(); www.close(); });

    // http.get, not fetch: fetch will not send a custom Host header.
    const { headers, body } = await new Promise((resolve, reject) => {
        http.get(url(www, '/bel/zs66tp?x=1'), {
            headers: { 'X-Forwarded-For': '203.0.113.9', 'Host': 'www.spelbel.nl' },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ headers: res.headers, body: data }));
        }).on('error', reject);
    });
    assert.strictEqual(headers['x-from'], 'app');
    const seen = JSON.parse(body);
    assert.strictEqual(seen.url, '/bel/zs66tp?x=1');
    assert.strictEqual(seen.headers['x-forwarded-host'], 'www.spelbel.nl');
    assert.strictEqual(seen.headers['x-spelbel-proxy'], '1');
    // One address, the client's — not "client, edge", which would make the app pick the edge.
    assert.strictEqual(seen.headers['x-forwarded-for'], '203.0.113.9');
});

test('leaves marketing pages and non-GET requests to the site', async (t) => {
    const app = await upstream();
    const www = await site(url(app, ''));
    t.after(() => { app.close(); www.close(); });

    assert.strictEqual(await (await fetch(url(www, '/privacy'))).text(), 'site');
    assert.strictEqual(await (await fetch(url(www, '/app'), { method: 'POST' })).text(), 'site');
});

test('answers 502 when the app is down', async (t) => {
    const www = await site('http://localhost:1');
    t.after(() => www.close());
    const res = await fetch(url(www, '/bel/abc'));
    assert.strictEqual(res.status, 502);
});
