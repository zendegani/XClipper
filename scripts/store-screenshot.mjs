#!/usr/bin/env node
// Capture a Chrome Web Store promo screenshot from any store/*.html file.
//
// Usage:
//   node scripts/store-screenshot.mjs <html-file> [output-png] [--selector sel] [--width W] [--height H]
//
// Defaults:
//   output   → assets/<basename-without-ext>.png
//   selector → .canvas  (falls back to full-page if not found)
//   width    → 1280
//   height   → 800
//
// Renders at 2× density for supersampling, then downscales via `sips`
// to the target size.
//
// Uses Chrome for Testing (auto-downloaded into .puppeteer-cache/) so we
// don't depend on a system Chrome install. Override the binary with
// CHROME_PATH=… if you already have a CfT/Chromium build elsewhere.

import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer-core';
import {
  install, resolveBuildId, detectBrowserPlatform,
  computeExecutablePath, Browser,
} from '@puppeteer/browsers';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHROME_CACHE = join(ROOT, '.puppeteer-cache');

const log = (...a) => console.log('[store-screenshot]', ...a);

// ── CLI args ────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    selector: { type: 'string', short: 's', default: '.canvas' },
    width:    { type: 'string', short: 'w', default: '1280' },
    height:   { type: 'string', short: 'h', default: '800' },
  },
});

const htmlRel = positionals[0];
if (!htmlRel) {
  console.error('Usage: store-screenshot.mjs <html-file> [output-png] [--selector .canvas] [--width 1280] [--height 800]');
  process.exit(1);
}

const htmlFile = resolve(ROOT, htmlRel);
if (!existsSync(htmlFile)) {
  console.error(`HTML file not found: ${htmlFile}`);
  process.exit(1);
}

const defaultOut = join(ROOT, 'assets', basename(htmlFile, extname(htmlFile)) + '.png');
const outFile    = positionals[1] ? resolve(ROOT, positionals[1]) : defaultOut;
const selector   = values.selector;
const targetW    = Number(values.width);
const targetH    = Number(values.height);

// ── Chrome binary ───────────────────────────────────────────────────
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

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  log(`HTML  : ${htmlFile}`);
  log(`Output: ${outFile}`);
  log(`Size  : ${targetW}×${targetH}  selector: "${selector}"`);

  const chromePath = await ensureChromeBinary();
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: 'new',
  });

  try {
    const page = await browser.newPage();
    // Render at 2× for supersampling.
    await page.setViewport({
      width: targetW, height: targetH, deviceScaleFactor: 2,
    });
    await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle0' });
    // Let layout, fonts, and any post-load paints settle.
    await new Promise((r) => setTimeout(r, 400));

    // Try to screenshot a specific element; fall back to full page.
    const el = await page.$(selector);
    const tmpPath = join(ROOT, 'assets/.tmp-store-screenshot.png');

    if (el) {
      log(`Capturing element "${selector}"`);
      await el.screenshot({ path: tmpPath, omitBackground: false });
    } else {
      log(`Selector "${selector}" not found — capturing full page`);
      await page.screenshot({ path: tmpPath, fullPage: false });
    }

    // sips quirks: -z takes HEIGHT first then WIDTH.
    await execFileP('sips', [
      '-z', String(targetH), String(targetW),
      tmpPath, '--out', outFile,
    ]);
    await unlink(tmpPath);
    log(`✓ ${outFile}  ${targetW}×${targetH}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
