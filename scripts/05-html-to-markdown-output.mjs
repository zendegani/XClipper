#!/usr/bin/env node
// Capture Chrome Web Store markdown promo tile screenshot from store/markdown_promo.html.
//
// Renders the canvas at 2× density for supersampling, then downscales
// via `sips` to the Chrome Web Store target size:
//   assets/Markdown.png  → 1280×800 (no alpha/PNG)
//
// Uses Chrome for Testing (auto-downloaded into .puppeteer-cache/) so we
// don't depend on a system Chrome install. Override the binary with
// CHROME_PATH=… if you already have a CfT/Chromium build elsewhere.

import { existsSync } from 'node:fs';
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
const PROMO_HTML = join(ROOT, 'store/markdown_promo.html');
const OUT_FILE = join(ROOT, 'assets/05-html-to-markdown-output.png');
const CHROME_CACHE = join(ROOT, '.puppeteer-cache');

const TARGET = { id: '#marquee', w: 1280, h: 800 };

const log = (...a) => console.log('[markdown-promo]', ...a);

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
    console.error(`store/markdown_promo.html not found at ${PROMO_HTML}`);
    process.exit(1);
  }

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

    const el = await page.$(TARGET.id);
    if (!el) throw new Error(`element ${TARGET.id} not found in markdown_promo.html`);

    // 2× capture lands here, then sips downsamples to the final file in place.
    const tmpPath = join(ROOT, 'assets/.tmp-markdown.png');
    await el.screenshot({ path: tmpPath, omitBackground: false });

    // sips quirks: -z takes HEIGHT first then WIDTH. Forces exact dimensions,
    // does NOT preserve aspect (which is fine here — source is already the right
    // ratio, we just want the integer-pixel downscale).
    await execFileP('sips', [
      '-z', String(TARGET.h), String(TARGET.w),
      tmpPath, '--out', OUT_FILE,
    ]);
    await unlink(tmpPath);
    log(`✓ ${OUT_FILE}  ${TARGET.w}×${TARGET.h}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
