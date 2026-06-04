import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: 'chrome120',
  logLevel: 'info',
};

async function build() {
  // Ensure dist directory exists
  mkdirSync(resolve(__dirname, 'dist'), { recursive: true });

  // Build content script (IIFE — content scripts can't use ES modules)
  const contentBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/content/content.ts')],
    outfile: resolve(__dirname, 'dist/content.js'),
    format: 'iife',
  });

  // Build injector content script (IIFE)
  const injectorBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/content/injector.ts')],
    outfile: resolve(__dirname, 'dist/injector.js'),
    format: 'iife',
  });

  // Build background service worker (ESM for MV3)
  const backgroundBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/background/background.ts')],
    outfile: resolve(__dirname, 'dist/background.js'),
    format: 'esm',
  });

  // Build popup script (IIFE)
  const popupBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/popup/popup.ts')],
    outfile: resolve(__dirname, 'dist/popup.js'),
    format: 'iife',
  });

  // Build offscreen renderer (IIFE — it's a regular extension page script)
  const offscreenBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/offscreen/offscreen.ts')],
    outfile: resolve(__dirname, 'dist/offscreen.js'),
    format: 'iife',
  });

  // Build print page (IIFE)
  const printBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [resolve(__dirname, 'src/print/print.ts')],
    outfile: resolve(__dirname, 'dist/print.js'),
    format: 'iife',
  });

  await Promise.all([contentBuild, injectorBuild, backgroundBuild, popupBuild, offscreenBuild, printBuild]);

  // Copy static assets
  cpSync(resolve(__dirname, 'src/manifest.json'), resolve(__dirname, 'dist/manifest.json'));
  cpSync(resolve(__dirname, 'src/popup/popup.html'), resolve(__dirname, 'dist/popup.html'));
  cpSync(resolve(__dirname, 'src/popup/popup.css'), resolve(__dirname, 'dist/popup.css'));
  cpSync(resolve(__dirname, 'src/offscreen/offscreen.html'), resolve(__dirname, 'dist/offscreen.html'));
  cpSync(resolve(__dirname, 'src/print/print.html'), resolve(__dirname, 'dist/print.html'));

  // Copy icons
  const iconsDir = resolve(__dirname, 'src/icons');
  const distIconsDir = resolve(__dirname, 'dist/icons');
  if (existsSync(iconsDir)) {
    mkdirSync(distIconsDir, { recursive: true });
    cpSync(iconsDir, distIconsDir, { recursive: true });
  }

  // Copy _locales for i18n
  const localesDir = resolve(__dirname, 'src/_locales');
  const distLocalesDir = resolve(__dirname, 'dist/_locales');
  if (existsSync(localesDir)) {
    mkdirSync(distLocalesDir, { recursive: true });
    cpSync(localesDir, distLocalesDir, { recursive: true });
  }

  console.log('✅ Build complete → dist/');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
