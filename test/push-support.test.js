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
