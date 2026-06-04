#!/usr/bin/env node
// Capture popup.html screenshots in every locale the extension ships.
//
// Usage:
//   node scripts/popup-screenshots.mjs           # all locales in src/_locales
//   node scripts/popup-screenshots.mjs en de fa  # subset
//
// Output: screenshots/popup-<locale>.png
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
    await page.setViewport({ width: 380, height: 720, deviceScaleFactor: 2 });
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

    const out = join(SHOTS, `popup-${locale}.png`);
    await page.screenshot({ path: out, fullPage: true });
    log(`✓ ${locale} → ${out}`);
  } finally {
    await browser.close();
  }
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
