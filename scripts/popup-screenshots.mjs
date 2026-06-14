#!/usr/bin/env node
// Capture popup.html screenshots in every locale the extension ships.
//
// Usage:
//   node scripts/popup-screenshots.mjs           # all locales in src/_locales
//   node scripts/popup-screenshots.mjs en de fa  # subset
//
// Output per locale (seven shots):
//   screenshots/popup-<locale>.png            — main view (Single export)
//   screenshots/batch-<locale>.png            — Batch export view
//   screenshots/batch-settings-<locale>.png   — Batch view, Export settings expanded
//   screenshots/batch-fast-<locale>.png       — Batch view, Fast Batch toggle armed
//   screenshots/settings-dl-<locale>.png      — settings, Downloads + Inline open
//   screenshots/settings-obs-<locale>.png     — Obsidian + Frontmatter open, toggle OFF
//   screenshots/settings-obs-on-<locale>.png  — Obsidian + Frontmatter open, toggle ON
//
// We drive *the real extension* (no chrome-API stubs). System Chrome 137+ stable
// silently no-ops `--load-extension`, so we use Chrome for Testing (CfT), which
// keeps the switch enabled for automation. CfT is auto-downloaded into
// .puppeteer-cache/ on first run. Override the binary via CHROME_PATH=… if you
// already have a CfT/Chromium build elsewhere.

import { mkdir, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  install,
  resolveBuildId,
  detectBrowserPlatform,
  computeExecutablePath,
  Browser,
} from '@puppeteer/browsers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SRC_LOCALES = join(ROOT, 'src', '_locales');
const SHOTS = join(ROOT, 'screenshots');
const PROFILE_BASE = join(ROOT, '.tmp-puppeteer-profiles');
const CHROME_CACHE = join(ROOT, '.puppeteer-cache');

const log = (...a) => console.log('[screenshots]', ...a);
const warn = (...a) => console.warn('[screenshots]', ...a);

async function ensureChromeBinary() {
  if (process.env.CHROME_PATH) {
    const p = process.env.CHROME_PATH;
    if (!existsSync(p)) throw new Error(`CHROME_PATH does not exist: ${p}`);
    log(`Using CHROME_PATH override → ${p}`);
    return p;
  }
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Unsupported platform for @puppeteer/browsers.');
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
  const execPath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CHROME_CACHE,
  });
  if (existsSync(execPath)) {
    log(`Chrome for Testing ${buildId} already present.`);
    return execPath;
  }
  log(`Installing Chrome for Testing ${buildId} → ${CHROME_CACHE} (one-time, ~150MB)…`);
  await install({ browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHE });
  log(`Installed → ${execPath}`);
  return execPath;
}

async function listLocales() {
  const entries = await readdir(SRC_LOCALES, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function findExtensionId(browser, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = browser.targets();
    const ext = targets.find((t) => {
      const url = t.url();
      return url.startsWith('chrome-extension://') &&
        (t.type() === 'service_worker' || url.includes('background'));
    });
    if (ext) {
      const m = ext.url().match(/^chrome-extension:\/\/([a-p]{32})\//);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  // Help the caller see what Chrome *did* load.
  const seen = browser.targets().map((t) => `${t.type()}\t${t.url()}`).join('\n  ');
  throw new Error(
    `Extension service-worker target did not appear within ${timeoutMs}ms.\n` +
      `This means --load-extension was ignored (Chrome 137+ stable disables it).\n` +
      `Targets visible to puppeteer:\n  ${seen || '(none)'}`,
  );
}

async function screenshotPopup(chromePath, locale) {
  const profile = join(PROFILE_BASE, locale);
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });

  // On macOS, --lang and Local State `intl.app_locale` are both ignored — Chrome
  // resolves its UI language from CFBundlePreferredLanguages. NSUserDefaults
  // parses `-AppleLanguages "(xx)"` from argv before Chromium does, which is
  // the only command-line knob that actually flips chrome.i18n.getUILanguage().
  const chromeLocale = locale.replace(/_/g, '-');

  const args = [
    '-AppleLanguages',
    `(${chromeLocale})`,
    `--load-extension=${DIST}`,
    `--disable-extensions-except=${DIST}`,
    `--disable-features=DisableLoadExtensionCommandLineSwitch`,
    `--user-data-dir=${profile}`,
    `--lang=${chromeLocale}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=460,800',
    '--window-position=0,0',
  ];

  log(`launch ${locale} args: ${args.join(' ')}`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: null,
    args,
  });

  try {
    const version = await browser.version();
    log(`browser: ${version}`);
    const extId = await findExtensionId(browser);
    log(`extension id: ${extId}`);

    const page = await browser.newPage();
    await page.setViewport({ width: 440, height: 800, deviceScaleFactor: 2 });
    page.on('pageerror', (err) => warn(`[popup pageerror][${locale}] ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') warn(`[popup console.error][${locale}] ${msg.text()}`);
    });

    await page.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle0' });
    // Let i18n DOM passes + any post-load fade settle.
    await new Promise((r) => setTimeout(r, 400));

    const i18nInfo = await page.evaluate(() => ({
      uiLang: chrome.i18n.getUILanguage(),
      bidiDir: chrome.i18n.getMessage('@@bidi_dir'),
      uiLocale: chrome.i18n.getMessage('@@ui_locale'),
      sampleTagline: chrome.i18n.getMessage('tagline'),
      htmlLang: document.documentElement.getAttribute('lang'),
      htmlDir: document.documentElement.getAttribute('dir'),
    }));
    log(`popup i18n: ${JSON.stringify(i18nInfo)}`);

    await captureShot(page, join(SHOTS, `popup-${locale}.png`), locale, 'main');

    await setExportTab(page, 'batch');
    await captureShot(page, join(SHOTS, `batch-${locale}.png`), locale, 'batch');

    // Batch collapses Export settings by default (mode.ts) — expand it to show
    // the batch-only Output/Format/Include-reposts controls, then re-collapse.
    await setExportSettingsOpen(page, true);
    await captureShot(page, join(SHOTS, `batch-settings-${locale}.png`), locale, 'batch-settings');
    await setExportSettingsOpen(page, false);

    await setFastBatchArmed(page);
    await captureShot(page, join(SHOTS, `batch-fast-${locale}.png`), locale, 'batch-fast');
    await setFastBatchArmed(page, false);

    await openSettings(page);
    await setOpenSections(page, ['downloads', 'inline']);
    await captureShot(page, join(SHOTS, `settings-dl-${locale}.png`), locale, 'settings-dl');

    await setOpenSections(page, ['obsidian', 'frontmatter']);
    await setObsidianFriendly(page, false);
    await captureShot(page, join(SHOTS, `settings-obs-${locale}.png`), locale, 'settings-obs[off]');

    await setObsidianFriendly(page, true);
    await captureShot(page, join(SHOTS, `settings-obs-on-${locale}.png`), locale, 'settings-obs[on]');
  } finally {
    await browser.close();
  }
}

async function captureShot(page, path, locale, label) {
  await page.screenshot({ path, fullPage: true });
  log(`✓ ${locale} [${label}] → ${path}`);
}

// Flip the Obsidian-friendly toggle to a specific state and fire `change` so the
// popup's own listener runs — which is what swaps the Frontmatter field picker
// to the Obsidian variant and enables the tags template input.
async function setObsidianFriendly(page, enabled) {
  await page.evaluate((want) => {
    const cb = document.getElementById('chk-obsidian-friendly');
    if (!cb || cb.checked === want) return;
    cb.checked = want;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }, enabled);
  await new Promise((r) => setTimeout(r, 50));
}

// Switch the Tier-1 export mode by clicking the Single/Batch tab, so the
// popup's own listener runs (panel swap + persistence) exactly as for a user.
async function setExportTab(page, mode) {
  await page.evaluate((m) => {
    const id = m === 'batch' ? 'tab-mode-batch' : 'tab-mode-single';
    document.getElementById(id)?.click();
  }, mode);
  await new Promise((r) => setTimeout(r, 100));
}

// Expand/collapse the "Export settings" group (a plain <details>, no popup
// listener) so the batch shot can show the Output/Format/reposts controls.
async function setExportSettingsOpen(page, open) {
  await page.evaluate((want) => {
    const el = document.getElementById('export-settings');
    if (el) el.open = want;
  }, open);
  await new Promise((r) => setTimeout(r, 50));
}

// Arm (or disarm) the Fast Batch toggle for the screenshot. The real toggle
// path calls chrome.permissions.request('webRequest'), which can't be granted
// headlessly, so we set the same armed *visual* state the popup's applyGlow() +
// idle updateFastSteps() produce: checkbox on, red glow, date-range + step
// lights revealed (Reload/Open-tweet shown ready, Fetch/Expand pending).
async function setFastBatchArmed(page, armed = true) {
  await page.evaluate((on) => {
    const cb = document.getElementById('chk-fast-batch');
    if (cb) cb.checked = on;
    document.getElementById('view-main')?.classList.toggle('fast-on', on);
    document.getElementById('fast-date-range')?.classList.toggle('hidden', !on);
    document.getElementById('fast-steps')?.classList.toggle('hidden', !on);
    const setState = (id, state) => {
      const el = document.getElementById(id);
      if (el) el.dataset.state = on ? state : '';
    };
    setState('fast-step-page', 'ready');
    setState('fast-step-tweet', 'ready');
    setState('fast-step-fetch', 'pending');
    setState('fast-step-expand', 'pending');
  }, armed);
  await new Promise((r) => setTimeout(r, 50));
}

async function openSettings(page) {
  // Idempotent: if the settings view is already visible the click is harmless
  // because btn-settings hides itself when settings opens.
  await page.evaluate(() => {
    const btn = document.getElementById('btn-settings');
    if (btn && !btn.classList.contains('hidden')) btn.click();
  });
  // The settings view doesn't animate, but give the toggle one frame.
  await new Promise((r) => setTimeout(r, 50));
}

// Drive the collapsible sections by dispatching real `toggle` events. The
// popup's own listener then runs reconcileSections + persistAll, so we end up
// with the exact same state a clicking user would produce — invariants and all.
async function setOpenSections(page, wantedInOrder) {
  await page.evaluate((wanted) => {
    const all = ['downloads', 'obsidian', 'frontmatter', 'inline'];
    const get = (id) => document.querySelector(`details[data-section-id="${id}"]`);
    // Close anything not wanted first so we don't exceed the open cap mid-flight.
    for (const id of all) {
      const el = get(id);
      if (el && el.open && !wanted.includes(id)) {
        el.open = false;
        el.dispatchEvent(new Event('toggle'));
      }
    }
    // Open wanted sections in the requested order. Re-toggling an already-open
    // section is a no-op in the listener (`if (sectionsSyncing) return`-style
    // guard not needed here — opening an open <details> doesn't fire toggle).
    for (const id of wanted) {
      const el = get(id);
      if (el && !el.open) {
        el.open = true;
        el.dispatchEvent(new Event('toggle'));
      }
    }
  }, wantedInOrder);
  await new Promise((r) => setTimeout(r, 50));
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ missing — run `npm run build` first.');
    process.exit(1);
  }
  await mkdir(SHOTS, { recursive: true });
  await mkdir(PROFILE_BASE, { recursive: true });

  const chromePath = await ensureChromeBinary();

  const requested = process.argv.slice(2);
  const locales = requested.length > 0 ? requested : await listLocales();
  log(`Capturing ${locales.length} locale(s): ${locales.join(', ')}`);

  let failures = 0;
  for (const locale of locales) {
    try {
      await screenshotPopup(chromePath, locale);
    } catch (err) {
      failures += 1;
      console.error(`✗ ${locale}: ${err.message}`);
    }
  }

  await rm(PROFILE_BASE, { recursive: true, force: true });
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
