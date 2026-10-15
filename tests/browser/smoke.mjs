// Optional real-browser smoke test for env-gone.
//
// It drives an actual Chromium/Chrome over the DevTools Protocol against a
// running `wrangler dev` server. It is intentionally NOT part of `npm test`:
// the unit/integration suite must not require a browser download.
//
// Usage:
//   1. In one terminal:  npm run dev
//   2. In another:       npm run test:browser
//
// Environment overrides:
//   ENV_GONE_BASE       base URL (default http://127.0.0.1:8787)
//   CHROME_PATH         path to a Chromium/Chrome binary
//   CHROME_DEBUG_PORT   CDP port (default 9223)
//
// Fake notes only. Nothing here is a real secret.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const BASE = process.env.ENV_GONE_BASE ?? 'http://127.0.0.1:8787';
const PORT = Number(process.env.CHROME_DEBUG_PORT ?? '9223');
const NOTE = 'APP_MODE=production\nFAKE_KEY=not-a-real-secret\n\nLine three.\n';
const MARKUP = '<script>alert(1)</script> **bold** & <img src=x onerror=alert(2)>';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function findChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? 'chrome';
}

async function main() {
  await assertServerUp();

  const profile = await mkdtemp(join(tmpdir(), 'env-gone-chrome-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const target = await waitForTarget();
    await runTests(target.webSocketDebuggerUrl);
  } finally {
    chrome.kill();
    const [tempRoot, profilePath] = await Promise.all([realpath(tmpdir()), realpath(profile)]);
    if (dirname(profilePath) !== tempRoot || !basename(profilePath).startsWith('env-gone-chrome-')) {
      throw new Error('Refusing to remove an unexpected browser profile path');
    }
    await rm(profilePath, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

async function assertServerUp() {
  try {
    const response = await fetch(`${BASE}/`);
    if (response.ok) return;
  } catch {
    /* fall through */
  }
  console.error(`No env-gone server at ${BASE}. Start it first with npm run dev.`);
  process.exit(2);
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('could not reach a Chrome page target');
}

async function runTests(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* transient: execution context was destroyed during navigation */
      }
      await sleep(100);
    }
    return false;
  };

  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete'`, 20000);
  };

  const hardNavigate = async (url) => {
    await navigate('about:blank');
    await navigate(url);
  };

  // A fragment-only navigation in the same tab. Sets a per-document marker first
  // so we can prove the SPA was not reloaded (the marker survives).
  const reopenInSameTab = async (url) => {
    const stamp = Date.now();
    await evaluate(`window.__docStamp = ${stamp}; true`);
    await evaluate(`location.href = ${JSON.stringify(url)}; true`);
    return { stamp, sameDocument: () => evaluate(`window.__docStamp === ${stamp}`) };
  };

  const setNative = (selector, value) =>
    evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);

  const clickButtonContaining = (text) =>
    evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`,
    );

  const storageIsEmpty = async () =>
    (await evaluate(
      `Object.keys(localStorage).length + Object.keys(sessionStorage).length + document.cookie.length`,
    )) === 0;

  const createNote = async (text) => {
    await navigate(`${BASE}/`);
    await waitFor(`!!document.querySelector('#note-input')`);
    await setNative('#note-input', text);
    await setNative('#ttl-select', '3600');
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.type === 'submit').click()`);
    await waitFor(`!!document.querySelector('.link-input')`, 20000);
    return evaluate(`document.querySelector('.link-input').value`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await navigate(`${BASE}/`);
  await waitFor(`!!document.querySelector('#note-input')`);
  check('sharing form needs no creator token', await evaluate(`!document.querySelector('#creator-token') && !document.querySelector('input[type=password]')`));

  // Optional review artifacts; only the empty composer is captured.
  if (process.env.ENV_GONE_SCREENSHOTS) {
    const directory = resolve(process.env.ENV_GONE_SCREENSHOTS);
    await mkdir(directory, { recursive: true });
    await navigate(`${BASE}/`);
    await waitFor(`!!document.querySelector('#note-input')`);
    for (const [name, width, height, mobile] of [
      ['desktop', 1440, 1080, false],
      ['mobile', 390, 844, true],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      const { data } = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: cssContentSize.height, scale: 1 },
      });
      await writeFile(join(directory, `${name}.png`), Buffer.from(data, 'base64'));
      check(`${name} composer has no horizontal overflow`, await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    }
    await send('Emulation.clearDeviceMetricsOverride');
  }

  // ---- Create a note through the real UI ----
  const shareLink = await createNote(NOTE);
  check(
    'share link has the /n/<id>#v=1&k=...&t=... shape',
    /\/n\/[A-Za-z0-9_-]{22}#v=1&k=[A-Za-z0-9_-]{43}&t=[A-Za-z0-9_-]{43}$/.test(shareLink),
    `${shareLink.slice(0, 34)}...`,
  );

  // ---- Open the link: confirmation only, fragment stripped ----
  await hardNavigate(shareLink);
  check(
    'opening the link shows the confirmation shell',
    await waitFor(`document.body.innerText.includes('Read and destroy?')`),
  );
  check(
    'confirmation shell does not reveal note content',
    !(await evaluate(`document.body.innerText.includes('FAKE_KEY')`)),
  );
  check('fragment removed from the address bar', await waitFor(`location.hash === ''`));
  check('no secrets persisted in browser storage', await storageIsEmpty());

  // ---- Same-tab reopening (same-document) while the fragment is stripped ----
  // This is the real regression case: a fragment-only navigation does not
  // remount the SPA, so ReadNote must react to the hashchange itself.
  const reopen1 = await reopenInSameTab(shareLink);
  check(
    'same-tab reopen of the full link shows the confirmation shell again',
    await waitFor(`document.body.innerText.includes('Read and destroy?')`),
  );
  check('same-tab reopen did not reload the document', await reopen1.sameDocument());
  check('same-tab reopen strips the fragment again', await waitFor(`location.hash === ''`));
  check(
    'same-tab reopen does not reveal note content',
    !(await evaluate(`document.body.innerText.includes('FAKE_KEY')`)),
  );

  // ---- Reload after stripping: incomplete, and reopening still works ----
  await send('Page.reload', {});
  await waitFor(`document.readyState === 'complete'`);
  check(
    'reload without the fragment shows the incomplete-link state',
    await waitFor(`document.body.innerText.includes('This link is incomplete')`),
  );
  const reopen2 = await reopenInSameTab(shareLink);
  check(
    'reopening after a reload shows the confirmation shell',
    await waitFor(`document.body.innerText.includes('Read and destroy?')`),
  );
  check('the post-reload reopen was same-document too', await reopen2.sameDocument());

  // A damaged replacement fragment clears the held link without consuming it.
  await reopenInSameTab(`${shareLink.split('#')[0]}#v=1&k=bad&t=bad`);
  check('a damaged same-tab link clears the old confirmation', await waitFor(`document.body.innerText.includes('This link is incomplete')`));
  check('damaged fragments are removed too', await waitFor(`location.hash === ''`));
  await reopenInSameTab(shareLink);
  await waitFor(`document.body.innerText.includes('Read and destroy?')`);

  // ---- Consume: the note survived every reopen above ----
  await clickButtonContaining('Yes, show me the variables');
  check(
    'revealed state shows the exact destroyed warning',
    await waitFor(
      `document.body.innerText.includes('This note was destroyed. If you need to keep it, copy it before closing this window.')`,
    ),
  );
  check(
    'revealed plaintext matches exactly',
    (await evaluate(`document.querySelector('.note-paper').textContent`)) === NOTE,
  );
  check('revealed page keeps no browser-stored secrets', await storageIsEmpty());

  // Leaving and returning must not restore the revealed plaintext from bfcache.
  await navigate(`${BASE}/`);
  await waitFor(`!!document.querySelector('#note-input')`);
  await evaluate(`history.back(); true`);
  check('returning to a read page does not restore plaintext', await waitFor(`document.body.innerText.includes('This link is incomplete') && !document.querySelector('.note-paper')`));

  // ---- Replay is unavailable, and the footer is honest ----
  await hardNavigate(shareLink);
  check(
    'replayed link shows the confirmation shell first',
    await waitFor(`document.body.innerText.includes('Read and destroy?')`),
  );
  await clickButtonContaining('Yes, show me the variables');
  check(
    'replaying the link shows the unavailable state',
    await waitFor(`document.body.innerText.includes('This note is no longer available')`),
  );
  check(
    'unavailable state does not claim the note has not been read',
    !(await evaluate(`document.body.innerText.includes('The note has not been read yet.')`)),
  );

  // ---- Markup-like note content is rendered as inert text ----
  const markupLink = await createNote(MARKUP);
  await hardNavigate(markupLink);
  await waitFor(`document.body.innerText.includes('Read and destroy?')`);
  await clickButtonContaining('Yes, show me the variables');
  await waitFor(`!!document.querySelector('.note-paper')`, 20000);
  check(
    'markup-like note content is shown as inert text',
    (await evaluate(`document.querySelector('.note-paper').textContent`)) === MARKUP,
  );
  check(
    'no script or image element is injected from note content',
    (await evaluate(`document.querySelectorAll('.note-paper script, .note-paper img').length`)) === 0,
  );

  // Hold a real consume response until after pagehide. It must not reveal stale
  // plaintext on restoration, and duplicate synchronous clicks send one POST.
  const delayedLink = await createNote('DELAYED_FAKE_NOTE');
  await hardNavigate(delayedLink);
  await waitFor(`document.body.innerText.includes('Read and destroy?')`);
  await evaluate(`
    window.__consumeCalls = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (String(args[0]).endsWith('/consume')) {
        window.__consumeCalls++;
        const response = await originalFetch(...args);
        await new Promise(resolve => { window.__deliver = resolve; });
        return response;
      }
      return originalFetch(...args);
    };
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Yes, show me the variables'));
    button.click(); button.click(); true
  `);
  await waitFor(`typeof window.__deliver === 'function'`);
  check('duplicate in-flight clicks send only one consume POST', await evaluate(`window.__consumeCalls === 1`));
  await evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})); window.__deliver(); true`);
  await sleep(200);
  check('pagehide invalidates a pending consume response', await evaluate(`!document.querySelector('.note-paper') && !document.body.innerText.includes('DELAYED_FAKE_NOTE')`));

  // A damaged key cannot decrypt, but the successful consume still destroys it.
  const damagedLink = await createNote('DAMAGED_KEY_FAKE_NOTE');
  const damagedUrl = new URL(damagedLink);
  const damagedParams = new URLSearchParams(damagedUrl.hash.slice(1));
  damagedParams.set('k', 'A'.repeat(43));
  damagedUrl.hash = damagedParams.toString();
  await hardNavigate(damagedUrl.href);
  await waitFor(`document.body.innerText.includes('Read and destroy?')`);
  await clickButtonContaining('Yes, show me the variables');
  check('decryption failure reports the already-destroyed note', await waitFor(`document.body.innerText.includes('was destroyed on the server')`));
  check('a destroyed decryption failure offers no retry', !(await evaluate(`document.body.innerText.includes('Try again')`)));

  await hardNavigate(`${BASE}/n/%E0%A4%A`);
  check('a malformed percent escape does not crash the reader', await waitFor(`document.body.innerText.includes('This link is incomplete')`));

  ws.close();
}

main().catch((error) => {
  console.error('BROWSER SMOKE FAILED', error);
  process.exit(1);
});
