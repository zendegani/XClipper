import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg?.split('=')[1] ?? (process.argv.includes('--firefox') ? 'firefox' : 'chrome');
const isFirefox = target === 'firefox';
const outDir = isFirefox ? 'dist-firefox' : 'dist';

if (!['chrome', 'firefox'].includes(target)) {
  console.error(`Unknown build target "${target}". Expected "chrome" or "firefox".`);
  process.exit(1);
}

const commonOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: isFirefox ? 'firefox121' : 'chrome120',
  logLevel: 'info',
};

function firefoxManifest(manifest) {
  const next = structuredClone(manifest);

  next.permissions = next.permissions.filter((permission) => permission !== 'offscreen');
  next.background = {
    scripts: ['background.js'],
    service_worker: 'background.js',
    type: 'module',
  };
  next.action = {
    ...next.action,
    theme_icons: [
      { size: 16, dark: 'icons/icon-16.png', light: 'icons/icon-16-dark.png' },
      { size: 32, dark: 'icons/icon-32.png', light: 'icons/icon-32-dark.png' },
    ],
  };
  next.browser_specific_settings = {
    gecko: {
      id: 'xclipper@zendegani.github.io',
      strict_min_version: '121.0',
    },
  };

  return next;
}

function writeManifest() {
  const manifestPath = resolve(__dirname, 'src/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const output = isFirefox ? firefoxManifest(manifest) : manifest;
  writeFileSync(
    resolve(__dirname, outDir, 'manifest.json'),
    JSON.stringify(output, null, 2) + '\n'
  );
}

async function build() {
  rmSync(resolve(__dirname, outDir), { recursive: true, force: true });
  mkdirSync(resolve(__dirname, outDir), { recursive: true });

  // Build content script (IIFE — content scripts can't use ES modules)
  const contentBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/content/content.ts')],
    outfile: resolve(__dirname, outDir, 'content.js'),
    format: 'iife',
  });

  // Build injector content script (IIFE)
  const injectorBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/content/injector.ts')],
    outfile: resolve(__dirname, outDir, 'injector.js'),
    format: 'iife',
  });

  // Build background service worker (ESM for MV3)
  const backgroundBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/background/background.ts')],
    outfile: resolve(__dirname, outDir, 'background.js'),
    format: 'esm',
  });

  // Build popup script (IIFE)
  const popupBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/popup/popup.ts')],
    outfile: resolve(__dirname, outDir, 'popup.js'),
    format: 'iife',
  });

  // Build print page (IIFE)
  const printBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/print/print.ts')],
    outfile: resolve(__dirname, outDir, 'print.js'),
    format: 'iife',
  });

  const builds = [contentBuild, injectorBuild, backgroundBuild, popupBuild, printBuild];
  if (!isFirefox) {
    // Build Chrome's offscreen theme watcher (IIFE). Firefox uses manifest
    // `action.theme_icons`, so it does not need this runtime document.
    builds.push(esbuild.build({
      ...commonOptions,
      entryPoints: [resolve(__dirname, 'src/offscreen/offscreen.ts')],
      outfile: resolve(__dirname, outDir, 'offscreen.js'),
      format: 'iife',
    }));
  }

  await Promise.all(builds);

  // Copy static assets
  writeManifest();
  cpSync(resolve(__dirname, 'src/popup/popup.html'), resolve(__dirname, outDir, 'popup.html'));
  cpSync(resolve(__dirname, 'src/popup/popup.css'), resolve(__dirname, outDir, 'popup.css'));
  cpSync(resolve(__dirname, 'src/print/print.html'), resolve(__dirname, outDir, 'print.html'));
  if (!isFirefox) {
    cpSync(resolve(__dirname, 'src/offscreen/offscreen.html'), resolve(__dirname, outDir, 'offscreen.html'));
  }

  // Copy icons
  const iconsDir = resolve(__dirname, 'src/icons');
  const distIconsDir = resolve(__dirname, outDir, 'icons');
  if (existsSync(iconsDir)) {
    mkdirSync(distIconsDir, { recursive: true });
    cpSync(iconsDir, distIconsDir, { recursive: true });
  }

  // Copy _locales for i18n
  const localesDir = resolve(__dirname, 'src/_locales');
  const distLocalesDir = resolve(__dirname, outDir, '_locales');
  if (existsSync(localesDir)) {
    mkdirSync(distLocalesDir, { recursive: true });
    cpSync(localesDir, distLocalesDir, { recursive: true });
  }

  console.log(`✅ Build complete → ${outDir}/`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
