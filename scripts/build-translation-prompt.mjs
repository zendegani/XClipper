#!/usr/bin/env node
// Generate a GPT-5.5 translation prompt for one locale.
//
// Two modes:
//   store (default) — the four Chrome Web Store listing strings
//   keys            — every messages.json key present in en/ but missing from <code>/
//
// Usage:   node scripts/build-translation-prompt.mjs <locale-code> [store|keys]
// Example: node scripts/build-translation-prompt.mjs fr
//          node scripts/build-translation-prompt.mjs fr keys
//          node scripts/build-translation-prompt.mjs fr | pbcopy  (mac, copy to clipboard)
//
// Reads:
//   src/_locales/<code>/messages.json  — for register reference (current strings)
//   src/_locales/en/messages.json      — English source, in keys mode
//   store/locales/<code>.txt           — for register reference (current long body)
//   store/locales/en.txt               — English source to translate, in store mode
// Prints the full prompt to stdout.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALE_NAMES = {
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  ja: 'Japanese',
  zh_CN: 'Simplified Chinese',
};

const MODES = ['store', 'keys'];

const code = process.argv[2];
const mode = process.argv[3] ?? 'store';
if (!code || !LOCALE_NAMES[code] || !MODES.includes(mode)) {
  console.error('Usage: node scripts/build-translation-prompt.mjs <locale-code> [store|keys]');
  console.error('Supported: ' + Object.keys(LOCALE_NAMES).join(', '));
  process.exit(1);
}

const locale = LOCALE_NAMES[code];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const messages = JSON.parse(readFileSync(resolve(ROOT, `src/_locales/${code}/messages.json`), 'utf8'));

if (mode === 'keys') {
  const en = JSON.parse(readFileSync(resolve(ROOT, 'src/_locales/en/messages.json'), 'utf8'));
  const missing = Object.keys(en).filter((k) => !(k in messages));
  if (missing.length === 0) {
    console.error(`${code}: no missing keys`);
    process.exit(1);
  }
  // Short labels sit inside narrow popup controls; captions get a sentence.
  // The model needs to know which budget applies before it starts writing.
  const SHORT = new Set([
    'batch_mode', 'batch_mode_info_label', 'mode_manual', 'mode_auto', 'mode_super',
    'fast_paginate', 'fast_paginate_recent', 'fast_paginate_resume',
    'btn_batch_go_likes', 'opt_zip',
  ]);
  const sources = missing
    .map((k) => `${SHORT.has(k) ? '[SHORT LABEL]' : '[SENTENCE]  '} ${k}\n    ${en[k].message}`)
    .join('\n\n');

  process.stdout.write(`You are translating UI strings from English into ${locale} for XClipper, a Chrome extension that exports x.com (Twitter) posts, threads and X Articles to Markdown, PDF and Obsidian.

OUTPUT FORMAT
Output a single JSON object, no preamble or commentary, mapping each of the ${missing.length} keys below to its ${locale} string:
{
${missing.map((k) => `  "${k}": "..."`).join(',\n')}
}
Do not translate, rename, add or drop keys. Output all ${missing.length}.

LENGTH BUDGET
- [SHORT LABEL] strings sit in narrow popup controls (a three-way selector, a button, a checkbox). Keep them at most as long as the English, and no longer than comparable existing labels in the reference below. No trailing period.
- [SENTENCE] strings are hints and captions. One tight sentence; do not pad. Keep the trailing period where the English has one.

KEEP IN ENGLISH / LATIN SCRIPT (do NOT translate)
- Brand and product names: XClipper, Obsidian, Markdown, X, PDF
- File extensions and formats: .zip, .md
- The mode names Manual / Auto / Super are a parallel set shown side by side in one selector. Translate them only if ${locale} has natural, equally short equivalents that stay visibly parallel; otherwise keep the English.

REGISTER & TERMINOLOGY
- Match the REFERENCE TRANSLATIONS below exactly for register (du vs Sie, tu vs vous, です/ます form, Simplified Chinese Latin/CJK spacing).
- Reuse the existing rendering of: Batch, thread, post, X Article, export, download, media, rate limit, settings.
- Preserve the punctuation that carries meaning — em dashes separating clauses, and the em dash before the trust clause in batch_mode_hint.

REFERENCE TRANSLATIONS (register and terminology only — do NOT copy or re-translate these)
\`\`\`json
${JSON.stringify(messages, null, 2)}
\`\`\`

ENGLISH SOURCES TO TRANSLATE

${sources}

Translate now. Output the JSON object only.
`);
  process.exit(0);
}

const refLong = readFileSync(resolve(ROOT, `store/locales/${code}.txt`), 'utf8').trim();
const enLong = readFileSync(resolve(ROOT, `store/locales/en.txt`), 'utf8').trim();

const prompt = `You are translating Chrome Web Store SEO copy from English into ${locale} for the XClipper extension. There are FOUR English source strings to translate, all part of one coherent listing.

OUTPUT FORMAT
Output JSON with exactly these four keys, no preamble or commentary:
{
  "extensionName": "...",
  "extensionDescription": "...",
  "tagline": "...",
  "longDescription": "..."
}
- longDescription is multi-line plain text (use \\n for line breaks in the JSON string); the other three are single-line strings.
- HARD LIMITS enforced by the Chrome Web Store:
  - extensionName MUST be ≤ 75 characters total (count every character including spaces and punctuation).
  - extensionDescription MUST be ≤ 132 characters total.
- Before outputting, COUNT the characters in extensionName and extensionDescription. If either exceeds the limit, rewrite it shorter by dropping the least essential word (typically a trailing verb or one of the content nouns). Verify the count again. The store will reject the manifest if exceeded.

KEEP IN ENGLISH / LATIN SCRIPT (do NOT translate)
- Brand names: XClipper, Obsidian, Logseq, Notion, Hugo, NotebookLM, Twitter, X
- File formats: Markdown, PDF, .md, YAML
- Technical terms: Dataview, RAG, API, URL, URI, frontmatter, wikilinked, [[@handle]]
- Placeholders: {date}, {handle}, {slug}, {type}
- All URLs (github.com/..., etc.) and code-style strings (obsidian://, x.com)

SEO STRATEGY — preserve across locales
- extensionName is FUNCTION-FORWARD (not brand-forward). It leads with the category positioning "X / Twitter Web Clipper" — the words users actually search for. Then a colon, then the ACTION VERB + content nouns + three output formats. The brand "XClipper" lives elsewhere (short_name, popup wordmark) and is NOT in the extensionName.
- English source: "X / Twitter Web Clipper: Save Threads & Articles to Markdown, PDF, Obsidian" (75 chars exactly — your translation has no room to grow).
- Translate "Web Clipper" to the natural ${locale} term for that concept (e.g. Web-Clipper in German, ウェブクリッパー in Japanese, 网页剪藏 in Chinese). Translate "Save" to the natural save-as-file verb. If the literal translation breaks the budget, drop the trailing verb or one of the format names — keep "Markdown" and "PDF", drop "Obsidian" first if needed (it's covered in the summary).
- extensionDescription uses a DIFFERENT verb (Export → exportieren / exporter / 書き出す / 导出 / etc.) plus the content nouns and formats, ending with the "Free, no API" trust signal.
- longDescription opens with "XClipper is a free, open-source web clipper for X (Twitter)" — same "web clipper" treatment as above. This is the ONE place the brand "XClipper" appears in the listing text.

LANGUAGE LIST ORDER (inside longDescription, the bullet starting "Multi-language UI:" or its translation)
- Order: ${locale}'s own name FIRST, then the other 11 languages sorted alphabetically using ${locale}'s alphabet/collation rules.
- Translate each language name into ${locale}'s natural rendering.
- "Portuguese (Brazil)" and "Chinese (Simplified)" keep the regional qualifier.

REGISTER & TONE
- Match the formality of the REFERENCE TRANSLATIONS below (du vs Sie in German, tu vs vous in French, etc.). Do not paraphrase loosely. Stay close to source meaning. Match line and bullet structure of the English source exactly.

REFERENCE TRANSLATIONS (for register only — content is outdated, do NOT copy strings from these)

extensionName (current): ${messages.extensionName.message}
extensionDescription (current): ${messages.extensionDescription.message}
tagline (current): ${messages.tagline.message}

longDescription (current):
\`\`\`
${refLong}
\`\`\`

ENGLISH SOURCES TO TRANSLATE

extensionName: X / Twitter Web Clipper: Bookmarks & Threads to Markdown, PDF, Obsidian
extensionDescription: Export X (Twitter) posts, threads, bookmarks & articles to Markdown, PDF or Obsidian — one at a time or in batch. Free, no API.

longDescription:
\`\`\`
${enLong}
\`\`\`

Translate now. Output the JSON object only.
`;

process.stdout.write(prompt);
