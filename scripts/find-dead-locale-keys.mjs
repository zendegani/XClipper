#!/usr/bin/env node
// Find locale strings defined in en/messages.json but never referenced in src/.
//
// Usage:
//   node scripts/find-dead-locale-keys.mjs          # list dead keys
//   node scripts/find-dead-locale-keys.mjs --ci     # also exit 1 if any are dead
//
// Reference styles understood (all that this codebase uses):
//   chrome.i18n.getMessage('key') / getMessage("key")   → quoted literal
//   data-i18n / data-i18n-tooltip / -placeholder / -aria-label="key"  (HTML)
//   __MSG_key__   (manifest.json, for extensionName / extensionDescription)
// Keys are never built dynamically here, so a static text scan is reliable.
//
// en/messages.json is the canonical key set; this does NOT check the other
// locales for drift (that's a separate key-parity check).

import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const enMessages = join(srcDir, '_locales', 'en', 'messages.json');

const keys = Object.keys(JSON.parse(readFileSync(enMessages, 'utf8')));

// Gather every source file that could reference a key, excluding the locale
// files themselves.
const exts = new Set(['.ts', '.html', '.json', '.mjs', '.js']);
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|\.git|_locales/.test(p)) walk(p);
    } else if (exts.has(extname(entry.name))) {
      files.push(p);
    }
  }
})(srcDir);

const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n');

const isUsed = (key) =>
  key === 'extensionName' || key === 'extensionDescription'
    ? haystack.includes(`__MSG_${key}__`)
    : haystack.includes(JSON.stringify(key)) || // "key"  (incl. data-i18n="key")
      haystack.includes(`'${key}'`) || // 'key'
      haystack.includes(`__MSG_${key}__`);

const dead = keys.filter((key) => !isUsed(key));

if (dead.length === 0) {
  console.log(`✓ No dead locale keys (${keys.length} keys scanned across ${files.length} files).`);
} else {
  console.log(`${dead.length} dead locale key(s) of ${keys.length}:`);
  for (const key of dead) console.log(`  - ${key}`);
  if (process.argv.includes('--ci')) process.exit(1);
}
