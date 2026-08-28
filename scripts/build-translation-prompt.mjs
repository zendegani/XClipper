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
//   src/_locales/en/messages.json      — English source (the store strings, and in keys mode every key)
//   store/locales/<code>.txt           — for register reference (current long body)
//   store/locales/en.txt               — English source to translate, in store mode
//
// Every English string comes from those files, so the prompt never goes stale.
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
const en = JSON.parse(readFileSync(resolve(ROOT, 'src/_locales/en/messages.json'), 'utf8'));

if (mode === 'keys') {
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

// The store counts characters, not UTF-16 units — an emoji or an em dash is one.
const len = (s) => [...s].length;
const enName = en.extensionName.message;
const enSummary = en.extensionDescription.message;
const enTagline = en.tagline.message;

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
- Brand names: XClipper, Obsidian, Twitter, X
- File formats and extensions: Markdown, PDF, YAML, .md, .mp4
- Technical terms: Content AST, Dataview, RAG, API, URL, frontmatter, wikilinks, [[@handle]], 720p
- All URLs (github.com/..., etc.) and code-style strings (obsidian://, x.com)

SEO STRATEGY — preserve across locales
- extensionName is FUNCTION-FORWARD (not brand-forward). It leads with the category positioning "X / Twitter Web Clipper" — the words users actually search for. Then a colon, then the content nouns and the three output formats. The brand "XClipper" lives elsewhere (short_name, popup wordmark) and is NOT in the extensionName.
- The English extensionName is ${len(enName)} characters, so your translation has ${75 - len(enName)} characters of headroom at most.
- Translate "Web Clipper" to the natural ${locale} term for that concept (e.g. Web-Clipper in German, ウェブクリッパー in Japanese, 网页剪藏 in Chinese). If the literal translation breaks the budget, drop one of the format names — keep "Markdown" and "PDF", drop "Obsidian" first if needed (it's covered in the summary).
- extensionDescription uses an ACTION VERB (Export → exportieren / exporter / エクスポート / 导出 / etc.) plus the content nouns and the batch range, and closes with a short trust clause. The English is ${len(enSummary)} characters, leaving ${132 - len(enSummary)} of headroom — if ${locale} runs long, shorten the trust clause first, then the batch range. Never drop the content nouns.
- Do NOT chain output formats as a keyword list in the name or the summary. A previous listing was rejected by Chrome Web Store review for keyword spam; the formats belong in the longDescription, in sentences.
- The brand "XClipper" appears in the longDescription's opening sentence and its closing disclaimer. Keep it in both.

REGISTER & TONE
- Match the formality of the REFERENCE TRANSLATIONS below (du vs Sie in German, tu vs vous in French, etc.). Do not paraphrase loosely. Stay close to source meaning. Match line and bullet structure of the English source exactly — same number of lines, same bullet order.

REFERENCE TRANSLATIONS (for register only — content is outdated, do NOT copy strings from these)

extensionName (current): ${messages.extensionName.message}
extensionDescription (current): ${messages.extensionDescription.message}
tagline (current): ${messages.tagline.message}

longDescription (current):
\`\`\`
${refLong}
\`\`\`

ENGLISH SOURCES TO TRANSLATE

extensionName: ${enName}
extensionDescription: ${enSummary}
tagline: ${enTagline}

longDescription:
\`\`\`
${enLong}
\`\`\`

Translate now. Output the JSON object only.
`;

process.stdout.write(prompt);
