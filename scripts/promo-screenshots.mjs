#!/usr/bin/env node
// Capture Chrome Web Store promo tile screenshots from store/promo.html.
//
// Renders both canvases at 2× density for supersampling, then downscales
// via `sips` to the Chrome Web Store target sizes:
//   store/promo/Marquee promo tile.png  → 1400×560
//   store/promo/Small_Promo.png          →  440×280
//
// Uses Chrome for Testing (auto-downloaded into .puppeteer-cache/) so we
// don't depend on a system Chrome install. Override the binary with
// CHROME_PATH=… if you already have a CfT/Chromium build elsewhere.

import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer-core';
import {
  install, resolveBuildId, detectBrowserPlatform,
  computeExecutablePath, Browser,
} from '@puppeteer/browsers';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROMO_HTML = join(ROOT, 'store/promo.html');
const OUT_DIR = join(ROOT, 'store/promo');
const CHROME_CACHE = join(ROOT, '.puppeteer-cache');

const TILES = [
  { id: '#marquee', file: 'Marquee promo tile.png', w: 1400, h: 560 },
  { id: '#small',   file: 'Small_Promo.png',         w:  440, h: 280 },
];

const log = (...a) => console.log('[promo]', ...a);

async function ensureChromeBinary() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
    }
    log(`Using CHROME_PATH override → ${process.env.CHROME_PATH}`);
    return process.env.CHROME_PATH;
  }
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Unsupported platform for @puppeteer/browsers.');
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
  const exec = computeExecutablePath({
    browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHE,
  });
  if (existsSync(exec)) {
    log(`Chrome for Testing ${buildId} already present.`);
    return exec;
  }
  log(`Installing Chrome for Testing ${buildId} → ${CHROME_CACHE} (one-time)…`);
  await install({ browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHE });
  return exec;
}

async function main() {
  if (!existsSync(PROMO_HTML)) {
    console.error(`store/promo.html not found at ${PROMO_HTML}`);
    process.exit(1);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const chromePath = await ensureChromeBinary();
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: 'new',
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`file://${PROMO_HTML}`, { waitUntil: 'networkidle0' });
    // Let layout, fonts, and any post-load paints settle before screenshotting.
    await new Promise((r) => setTimeout(r, 300));

    for (const t of TILES) {
      const el = await page.$(t.id);
      if (!el) throw new Error(`element ${t.id} not found in promo.html`);

      // 2× capture lands here, then sips downsamples to the final file in place.
      const tmpPath = join(OUT_DIR, `.tmp-${t.id.slice(1)}.png`);
      await el.screenshot({ path: tmpPath });

      const outPath = join(OUT_DIR, t.file);
      // sips quirks: -z takes HEIGHT first then WIDTH. Forces exact dimensions,
      // does NOT preserve aspect (which is fine here — source is already the right
      // ratio, we just want the integer-pixel downscale).
      await execFileP('sips', [
        '-z', String(t.h), String(t.w),
        tmpPath, '--out', outPath,
      ]);
      await unlink(tmpPath);
      log(`✓ ${t.file}  ${t.w}×${t.h}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
