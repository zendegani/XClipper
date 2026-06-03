#!/usr/bin/env node
// Capture popup.html screenshots in every locale the extension ships.
//
// Usage:
//   node scripts/popup-screenshots.mjs           # all locales in src/_locales
//   node scripts/popup-screenshots.mjs en de fa  # subset
//
// Output: screenshots/popup-<locale>.png
//
// Requires Google Chrome installed at the macOS default path. Drives it via
// puppeteer-core (devDep) with --load-extension=dist and --lang=<locale>.
// Each locale gets its own fresh user-data-dir so language flips deterministically.

import { mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'screenshots');
const PROFILE_BASE = join(ROOT, '.tmp-puppeteer-profiles');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function findChrome() {
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  throw new Error('Chrome not found. Install Google Chrome or edit CHROME_PATHS.');
}

async function listLocales() {
  const dir = join(ROOT, 'src', '_locales');
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function findExtensionId(browser) {
  // Service-worker target's URL is chrome-extension://<id>/<background-path>.
  // Poll for up to 5s — the worker doesn't always register on the first tick.
  for (let i = 0; i < 50; i++) {
    const targets = browser.targets();
    const ext = targets.find((t) => {
      const url = t.url();
      return url.startsWith('chrome-extension://') && url.includes('background');
    });
    if (ext) {
      const m = ext.url().match(/^chrome-extension:\/\/([a-z]{32})\//);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Extension service worker did not register within 5s.');
}

async function screenshotPopup(locale) {
  const chromePath = findChrome();
  const profile = join(PROFILE_BASE, locale);
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    args: [
      `--load-extension=${DIST}`,
      `--disable-extensions-except=${DIST}`,
      `--user-data-dir=${profile}`,
      `--lang=${locale}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=460,800',
      '--window-position=0,0',
    ],
  });

  try {
    const extId = await findExtensionId(browser);
    const page = await browser.newPage();
    await page.setViewport({ width: 380, height: 720, deviceScaleFactor: 2 });
    await page.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle0' });
    // Let i18n + any post-load fade settle.
    await new Promise((r) => setTimeout(r, 400));
    const out = join(SHOTS, `popup-${locale}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`✓ ${locale} → ${out}`);
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

  const requested = process.argv.slice(2);
  const locales = requested.length > 0 ? requested : await listLocales();

  console.log(`Capturing ${locales.length} locale(s): ${locales.join(', ')}`);
  for (const locale of locales) {
    try {
      await screenshotPopup(locale);
    } catch (err) {
      console.error(`✗ ${locale}: ${err.message}`);
    }
  }

  // Best-effort profile cleanup.
  await rm(PROFILE_BASE, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
