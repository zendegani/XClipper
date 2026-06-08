#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  install, resolveBuildId, detectBrowserPlatform,
  computeExecutablePath, Browser,
} from '@puppeteer/browsers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHROME_CACHE = join(ROOT, '.puppeteer-cache');

const log = (...a) => console.log('[generate-icons]', ...a);

async function ensureChromeBinary() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Unsupported platform for @puppeteer/browsers.');
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
  const exec = computeExecutablePath({
    browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHE,
  });
  if (existsSync(exec)) {
    return exec;
  }
  log(`Installing Chrome for Testing ${buildId} (one-time)…`);
  await install({ browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHE });
  return exec;
}

const SVG_PATH = join(ROOT, 'assets', 'xclipper-mark.svg');
const SVG_CONTENT = readFileSync(SVG_PATH, 'utf8').replace(
  '<svg ',
  '<svg style="width: 100%; height: 100%; display: block; margin: 0; padding: 0;" ',
);

async function main() {
  const chromePath = await ensureChromeBinary();
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: 'new',
  });

  try {
    const page = await browser.newPage();
    
    // Set standard transparent background
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body, html {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              overflow: hidden;
              background: transparent;
            }
          </style>
        </head>
        <body>
          ${SVG_CONTENT}
        </body>
      </html>
    `);

    const sizes = [16, 32, 48, 128];
    const outDir = join(ROOT, 'src', 'icons');
    mkdirSync(outDir, { recursive: true });

    for (const size of sizes) {
      await page.setViewport({
        width: size,
        height: size,
        deviceScaleFactor: 1,
      });

      // Let rendering settle
      await new Promise((r) => setTimeout(r, 100));

      const outFile = join(outDir, `icon-${size}.png`);
      await page.screenshot({
        path: outFile,
        omitBackground: true,
        type: 'png',
      });
      log(`✓ Generated: ${outFile} (${size}x${size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
