/**
 * Tests the capability probe that decides whether a parent is offered browser
 * notifications or the chat channels.
 *
 * The function ships inside the bell page's inline script, so the test lifts it out of
 * src/index.js and runs the real source in a sandbox — no copy to drift out of step.
 *
 * Run with: npm test   (node:test, no dependencies)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function extractClassifier() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const start = src.indexOf('async function classifySupport()');
    assert.ok(start > -1, 'classifySupport not found — did the bell page script change?');

    // Walk braces so the test survives edits to the function body.
    let depth = 0, i = src.indexOf('{', start);
    const from = i;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}

const CLASSIFIER = extractClassifier();

/** Build a browser-ish sandbox. Defaults are a healthy Android Chrome. */
function run(overrides = {}) {
    const env = {
        isSecureContext: true,
        hasServiceWorker: true,
        hasPushManager: true,
        hasNotification: true,
        requestPermission: () => Promise.resolve('granted'),
        permission: 'default',
        isIOS: false,
        isStandalone: false,
        register: () => Promise.resolve({ pushManager: {} }),
        ...overrides,
    };

    const navigator = { userAgent: 'test' };
    if (env.hasServiceWorker) navigator.serviceWorker = { register: env.register };

    const context = {
        window: { isSecureContext: env.isSecureContext },
        navigator,
        isIOS: env.isIOS,
        isStandalone: env.isStandalone,
    };
    if (env.hasPushManager) context.window.PushManager = function () {};
    if (env.hasNotification) {
        context.Notification = { permission: env.permission };
        if (env.requestPermission) context.Notification.requestPermission = env.requestPermission;
        context.window.Notification = context.Notification;
    }
    context.window.navigator = navigator;

    // 'x' in window / 'x' in navigator must see the same objects the code checks.
    vm.createContext(context);
    return vm.runInContext(`${CLASSIFIER}; classifySupport();`, context);
}

test('a healthy Android Chrome is ready to subscribe', async () => {
    assert.equal(await run(), 'ready');
});

test('an installed iOS app is ready', async () => {
    assert.equal(await run({ isIOS: true, isStandalone: true }), 'ready');
});

test('iOS Safari must install first — asking there always fails', async () => {
    assert.equal(await run({ isIOS: true, isStandalone: false }), 'needs-install');
});

test('a browser without PushManager is unsupported', async () => {
    // DuckDuckGo and most in-app webviews land here.
    assert.equal(await run({ hasPushManager: false }), 'unsupported');
});

test('a browser without service workers is unsupported', async () => {
    assert.equal(await run({ hasServiceWorker: false }), 'unsupported');
});

test('a browser without the Notification API is unsupported', async () => {
    assert.equal(await run({ hasNotification: false }), 'unsupported');
});

test('Notification without requestPermission is unsupported', async () => {
    assert.equal(await run({ requestPermission: null }), 'unsupported');
});

test('an insecure context is unsupported', async () => {
    assert.equal(await run({ isSecureContext: false }), 'unsupported');
});

test('a registration that throws is unsupported, not a crash', async () => {
    assert.equal(await run({ register: () => Promise.reject(new Error('denied')) }), 'unsupported');
});

test('a registration without pushManager is unsupported', async () => {
    assert.equal(await run({ register: () => Promise.resolve({}) }), 'unsupported');
});

test('a blocked site is reported as blocked, not unsupported', async () => {
    // Different screen: the parent can fix this one in browser settings.
    assert.equal(await run({ permission: 'denied' }), 'blocked');
});

test('blocked is decided before the iOS install rule', async () => {
    assert.equal(await run({ permission: 'denied', isIOS: true, isStandalone: false }), 'blocked');
});

// ── Install policy ──────────────────────────────────────────────────────────
// Install-first everywhere it is possible, because notifications then arrive under the
// app's own icon and survive clearing browser data. The exceptions are what these cover.

function extractPolicy() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const start = src.indexOf('function installPolicy(env)');
    assert.ok(start > -1, 'installPolicy not found — did the bell page script change?');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}

const POLICY = extractPolicy();

function policy(env) {
    const context = {};
    vm.createContext(context);
    return vm.runInContext(`${POLICY}; installPolicy(${JSON.stringify(env)});`, context);
}

test('an already-installed app subscribes directly', () => {
    assert.equal(policy({ isStandalone: true, isIOS: true, isSafari: true }), 'direct');
});

test('desktop subscribes directly — installing a PWA on a laptop is odd', () => {
    assert.equal(policy({ isDesktop: true }), 'direct');
});

test('iOS Safari is sent to the install guide', () => {
    assert.equal(policy({ isIOS: true, isSafari: true }), 'ios-install');
});

test('Chrome and Firefox on iOS cannot install, so they are never nudged', () => {
    // They cannot add to the home screen at all; a nudge would be a dead end.
    assert.equal(policy({ isIOS: true, isSafari: false }), 'no-install');
});

test('Android with an install prompt gets the one-tap install', () => {
    assert.equal(policy({ canPrompt: true }), 'prompt-install');
});

test('Android without an install prompt gets manual instructions', () => {
    // Firefox on Android supports push and installing, but fires no beforeinstallprompt.
    assert.equal(policy({ canPrompt: false }), 'manual-install');
});

test('standalone wins over every other signal', () => {
    assert.equal(policy({ isStandalone: true, isDesktop: false, canPrompt: true }), 'direct');
});

// ── The generated page script must be valid JavaScript ──────────────────────
// buildPushSection() assembles browser code inside a template literal, so an escape
// sequence meant for the browser can be eaten by Node instead. That happened: a `\/`
// in a regex collapsed to `/`, terminating the literal and killing the whole script —
// invisible to `node --check` on the source, since the source itself was fine.

test('the script sent to the browser parses', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const start = src.indexOf('function buildPushSection(');
    assert.ok(start > -1, 'buildPushSection not found');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const factory = src.slice(start, i + 1);

    const context = { JSON };
    vm.createContext(context);
    const html = vm.runInContext(
        `${factory}; buildPushSection('bell-id', 'vapid-key', 'https://app.example', 'Speeltuin Noord');`,
        context
    );

    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length, 'no inline script in the generated markup');
    for (const js of scripts) {
        assert.doesNotThrow(() => new vm.Script(js), 'generated script is not valid JavaScript');
    }
});

test('no unreplaced placeholders survive into the page', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const start = src.indexOf('function buildPushSection(');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const context = { JSON };
    vm.createContext(context);
    const html = vm.runInContext(
        `${src.slice(start, i + 1)}; buildPushSection('b', 'k', 'https://a.example', 'Naam');`,
        context
    );
    assert.equal(html.match(/\{\{[A-Z_]+\}\}/g), null);
    assert.ok(html.includes('https://a.example'), 'appUrl was not interpolated');
});

// ── The fallback must wait for the page to finish parsing ───────────────────
// F-001. The inline script sits inside #push-section, and the channels disclosure is
// emitted *after* it. An inline script blocks parsing while it runs, so the microtask
// that resumes `await classifySupport()` gets there before the parser does: the
// disclosure genuinely does not exist yet, querySelector returns null, and a parent on
// a browser without push is told there is no other way to subscribe while WhatsApp sits
// further down the same page. Staging could not catch it — with no chat credentials
// configured, both branches render the same screen.

/** Extracts the inline script exactly as the browser receives it. */
function shippedScript() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const start = src.indexOf('function buildPushSection(');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const context = { JSON };
    vm.createContext(context);
    const html = vm.runInContext(
        `${src.slice(start, i + 1)}; buildPushSection('bell-1', 'key', 'https://app.example', 'Speeltuin Noord');`,
        context
    );
    const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, 'no inline script in the generated markup');
    return m[1];
}

function element(extra = {}) {
    return {
        style: {}, textContent: '', className: '', open: false, parentNode: null,
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener() {}, setAttribute() {}, appendChild() {},
        insertBefore() {},
        querySelector() { return null; },
        ...extra,
    };
}

/**
 * A DuckDuckGo-shaped browser (no service worker → 'unsupported') on a page that is
 * still parsing. `.other-channels` appears only when DOMContentLoaded fires, which is
 * what the real parser does.
 */
function runPage({ channelsArrive = true } = {}) {
    const summary = element({ textContent: 'Liever via WhatsApp, Telegram of Signal?' });
    const note = element();
    const details = element({
        querySelector: sel => (sel === 'summary' ? summary : sel === '.other-channels-note' ? note : null),
    });

    const byId = {};
    for (const id of ['push-btn', 'push-status', 'push-settings-link', 'push-section',
                      'install-guide', 'install-intro', 'install-steps', 'install-btn', 'install-skip']) {
        byId[id] = element();
    }
    byId['push-section'].parentNode = element();

    let parsed = false;
    const listeners = [];
    const document = {
        readyState: 'loading',
        addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') listeners.push(fn); },
        getElementById: id => byId[id] || element(),
        querySelector: sel => {
            if (sel === '.other-channels') return parsed && channelsArrive ? details : null;
            if (sel === '.push-why') return element();
            return null;
        },
    };

    const window = {
        isSecureContext: true,
        matchMedia: () => ({ matches: false }),
        addEventListener() {},
    };
    const navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 13) DuckDuckGo/5' };

    const context = {
        window, navigator, document, JSON, console,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        localStorage: { getItem: () => null, setItem() {} },
        setTimeout, clearTimeout,
    };
    vm.createContext(context);
    vm.runInContext(shippedScript(), context);

    // Parsing finishes a tick later, exactly as it would in a browser.
    return new Promise(resolve => {
        setImmediate(() => {
            parsed = true;
            document.readyState = 'interactive';
            listeners.forEach(fn => fn());
            setImmediate(() => setImmediate(() => resolve({ details, summary, note, status: byId['push-status'] })));
        });
    });
}

test('a browser without push is offered the chat channels, not a dead end', async () => {
    const { details, summary, status } = await runPage();
    assert.equal(details.open, true, 'the channels disclosure was never opened');
    assert.match(summary.textContent, /Meld je aan via WhatsApp/);
    assert.doesNotMatch(status.textContent, /geen andere kanalen/,
        'told the parent there is no other channel while WhatsApp was on the page');
});

test('a bell with no chat channels still says so', async () => {
    // The message is only correct when it is true — that branch must survive the fix.
    const { status } = await runPage({ channelsArrive: false });
    assert.match(status.textContent, /geen andere kanalen/);
});

// ── Page links must not be built from the API host ──────────────────────────
// F-006. `appUrl` is the API base — the server that receives subscriptions. The pages a
// parent navigates to (/app, /push/settings) are served by *this* site. Building a link
// from appUrl sends them to the API host, which has no such route: a 404 reached by
// clicking the one control that leads to the snooze settings.

test('the settings link points at this site, not the API host', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const start = src.indexOf('function buildPushSection(');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const context = { JSON };
    vm.createContext(context);
    const html = vm.runInContext(
        `${src.slice(start, i + 1)}; buildPushSection('b', 'k', 'https://api.example', 'Naam');`,
        context
    );

    for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
        assert.doesNotMatch(m[1], /^https:\/\/api\.example/,
            `navigable link built from the API host: ${m[1]}`);
    }
    assert.match(html, /id="push-settings-link"/, 'the settings link disappeared');
});
